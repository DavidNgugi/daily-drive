use chrono::{Datelike, Local, NaiveDate, Weekday};
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, fs, path::PathBuf, process::Command, sync::Mutex, thread, time::{Duration, Instant}};
use tauri::{Emitter, Manager, WindowEvent};
use tauri_plugin_autostart::ManagerExt;

const START: &str = "2026-09-07";
const END: &str = "2026-11-28";

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct Measurement { weight: Option<f32>, waist: Option<f32> }

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SavedData {
    alarm_time: String,
    completed: Vec<String>,
    measurements: BTreeMap<String, Measurement>,
}

impl Default for SavedData {
    fn default() -> Self { Self { alarm_time: "07:00".into(), completed: vec![], measurements: BTreeMap::new() } }
}

struct AppState { data: Mutex<SavedData>, path: PathBuf, alarm_active: Mutex<bool> }

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Snapshot {
    today: String, alarm_time: String, completed: Vec<String>,
    measurements: BTreeMap<String, Measurement>, alarm_active: bool,
    in_plan: bool, rest_day: bool,
}

fn plan_day(date: NaiveDate) -> bool {
    let start = NaiveDate::parse_from_str(START, "%Y-%m-%d").unwrap();
    let end = NaiveDate::parse_from_str(END, "%Y-%m-%d").unwrap();
    date >= start && date <= end
}

fn snapshot(state: &AppState) -> Snapshot {
    let date = Local::now().date_naive();
    let data = state.data.lock().unwrap().clone();
    Snapshot {
        today: date.to_string(), alarm_time: data.alarm_time,
        completed: data.completed, measurements: data.measurements,
        alarm_active: *state.alarm_active.lock().unwrap(),
        in_plan: plan_day(date), rest_day: date.weekday() == Weekday::Sun,
    }
}

fn save(state: &AppState, data: &SavedData) -> Result<(), String> {
    if let Some(parent) = state.path.parent() { fs::create_dir_all(parent).map_err(|e| e.to_string())?; }
    let temp = state.path.with_extension("tmp");
    fs::write(&temp, serde_json::to_vec_pretty(data).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    fs::rename(temp, &state.path).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_state(state: tauri::State<AppState>) -> Snapshot { snapshot(&state) }

#[tauri::command]
fn set_alarm_time(app: tauri::AppHandle, state: tauri::State<AppState>, time: String) -> Result<Snapshot, String> {
    let valid = time.len() == 5 && time.as_bytes()[2] == b':' &&
        time[..2].parse::<u8>().is_ok_and(|h| h < 24) &&
        time[3..].parse::<u8>().is_ok_and(|m| m < 60);
    if !valid { return Err("Choose a valid time.".into()); }
    let mut data = state.data.lock().unwrap();
    data.alarm_time = time;
    save(&state, &data)?;
    drop(data);
    let result = snapshot(&state);
    let _ = app.emit("state-changed", &result);
    Ok(result)
}

#[tauri::command]
fn complete_today(app: tauri::AppHandle, state: tauri::State<AppState>) -> Result<Snapshot, String> {
    let date = Local::now().date_naive();
    if !plan_day(date) || date.weekday() == Weekday::Sun { return Err("No workout is scheduled today.".into()); }
    let today = date.to_string();
    let mut data = state.data.lock().unwrap();
    if !data.completed.contains(&today) { data.completed.push(today); data.completed.sort(); }
    save(&state, &data)?;
    drop(data);
    *state.alarm_active.lock().unwrap() = false;
    if let Some(window) = app.get_webview_window("main") { let _ = window.set_always_on_top(false); }
    let result = snapshot(&state);
    let _ = app.emit("state-changed", &result);
    Ok(result)
}

#[tauri::command]
fn save_measurement(app: tauri::AppHandle, state: tauri::State<AppState>, date: String, weight: Option<f32>, waist: Option<f32>) -> Result<Snapshot, String> {
    let parsed = NaiveDate::parse_from_str(&date, "%Y-%m-%d").map_err(|_| "Invalid date")?;
    if !plan_day(parsed) || parsed > Local::now().date_naive() { return Err("Choose a date within the plan up to today.".into()); }
    if weight.is_some_and(|v| !(30.0..=300.0).contains(&v)) || waist.is_some_and(|v| !(30.0..=250.0).contains(&v)) { return Err("Check your measurement values.".into()); }
    let mut data = state.data.lock().unwrap();
    data.measurements.insert(date, Measurement { weight, waist });
    save(&state, &data)?;
    drop(data);
    let result = snapshot(&state);
    let _ = app.emit("state-changed", &result);
    Ok(result)
}

#[tauri::command]
fn launch_at_login(app: tauri::AppHandle, enabled: bool) -> Result<bool, String> {
    if enabled { app.autolaunch().enable().map_err(|e| e.to_string())?; }
    else { app.autolaunch().disable().map_err(|e| e.to_string())?; }
    app.autolaunch().is_enabled().map_err(|e| e.to_string())
}

#[tauri::command]
fn login_enabled(app: tauri::AppHandle) -> bool { app.autolaunch().is_enabled().unwrap_or(false) }

fn start_alarm_loop(app: tauri::AppHandle) {
    thread::spawn(move || {
        let mut last_sound = Instant::now() - Duration::from_secs(5);
        let mut last_focus = Instant::now() - Duration::from_secs(30);
        loop {
            let state = app.state::<AppState>();
            let now = Local::now();
            let date = now.date_naive();
            let today = date.to_string();
            let due = {
                let data = state.data.lock().unwrap();
                plan_day(date) && date.weekday() != Weekday::Sun &&
                now.format("%H:%M").to_string() >= data.alarm_time &&
                !data.completed.contains(&today)
            };
            let changed = {
                let mut active = state.alarm_active.lock().unwrap();
                if *active != due { *active = due; true } else { false }
            };
            if changed {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.set_always_on_top(due);
                    if due { let _ = window.show(); let _ = window.unminimize(); let _ = window.set_focus(); }
                }
                let _ = app.emit("state-changed", snapshot(&state));
            }
            if due {
                if last_focus.elapsed() >= Duration::from_secs(30) {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.show(); let _ = window.unminimize(); let _ = window.set_focus();
                    }
                    last_focus = Instant::now();
                }
                if last_sound.elapsed() >= Duration::from_secs(4) {
                    thread::spawn(|| { let _ = Command::new("afplay").arg("/System/Library/Sounds/Sosumi.aiff").status(); });
                    last_sound = Instant::now();
                }
            }
            thread::sleep(Duration::from_secs(1));
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, None))
        .setup(|app| {
            let path = app.path().app_data_dir()?.join("progress.json");
            let login_marker = path.with_file_name("autostart-initialized");
            let data = fs::read(&path).ok().and_then(|bytes| serde_json::from_slice(&bytes).ok()).unwrap_or_default();
            app.manage(AppState { data: Mutex::new(data), path, alarm_active: Mutex::new(false) });
            if !cfg!(debug_assertions) && !login_marker.exists() && app.autolaunch().enable().is_ok() {
                let _ = fs::create_dir_all(login_marker.parent().unwrap());
                let _ = fs::write(login_marker, "initialized");
            }
            start_alarm_loop(app.handle().clone());
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![get_state, set_alarm_time, complete_today, save_measurement, launch_at_login, login_enabled])
        .build(tauri::generate_context!())
        .expect("error while building daily-drive")
        .run(|app, event| {
            if let tauri::RunEvent::Reopen { .. } = event {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        });
}
