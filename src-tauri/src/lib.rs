use chrono::{Datelike, Local, NaiveDate};
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, fs, path::PathBuf, process::Command, sync::Mutex, thread, time::{Duration, Instant}};
use tauri::{Emitter, Manager, WindowEvent, menu::{Menu, MenuItem}, tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent}};
use tauri_plugin_autostart::ManagerExt;

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct Measurement { weight: Option<f32>, waist: Option<f32> }

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PlanConfig {
    start_date: String,
    end_date: String,
    start_weight: f32,
    target_weight: f32,
}

impl Default for PlanConfig {
    fn default() -> Self {
        Self {
            start_date: "2026-09-24".into(),
            end_date: "2026-11-28".into(),
            start_weight: 99.0,
            target_weight: 90.0,
        }
    }
}

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct MealLog { breakfast: String, lunch: String, dinner: String, snacks: String }

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct WorkoutItem { name: String, reps: String }

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
struct PlannedWorkout { title: String, details: String, items: Vec<WorkoutItem>, rest_day: bool }

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct PlannedMeals { breakfast: String, lunch: String, dinner: String, snacks: String }

#[derive(Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
struct Schedule { workouts: Vec<PlannedWorkout>, meals: Vec<PlannedMeals>, workout_overrides: BTreeMap<String, PlannedWorkout>, meal_overrides: BTreeMap<String, PlannedMeals> }

impl Default for Schedule {
    fn default() -> Self {
        let workout = |title: &str, details: &str, rest_day: bool| PlannedWorkout { title: title.into(), details: details.into(), items: Vec::new(), rest_day };
        Self {
            workouts: vec![
                workout("Rest & recharge", "Take the day off and recover.", true),
                workout("Full-body strength", "Push-ups · dumbbell rows · goblet squats · lunges · shoulder press · glute bridges · plank · leg raises", false),
                workout("Incline treadmill", "30–45 min · 5.5–6.5 km/h · 6% incline", false),
                workout("Full-body strength", "Push-ups · dumbbell rows · goblet squats · lunges · shoulder press · glute bridges · plank · leg raises", false),
                workout("Incline treadmill", "30–45 min · 5.5–6.5 km/h · 6% incline", false),
                workout("Full-body strength", "Push-ups · dumbbell rows · goblet squats · lunges · shoulder press · glute bridges · plank · leg raises", false),
                workout("Treadmill intervals", "Warm up 5 min · 6–8 rounds of 1 min brisk / 2 min easy · cool down 5 min", false),
            ],
            meals: vec![
                PlannedMeals { breakfast: "2 hard-boiled eggs + arrowroot".into(), dinner: "Leftovers, or a smaller portion of roast potatoes + pork / chicken alfredo".into(), ..Default::default() },
                PlannedMeals { breakfast: "2 hard-boiled eggs + sweet potato or arrowroot".into(), dinner: "Ugali + greens + fish or matumbo · aim for about 1 cup ugali".into(), ..Default::default() },
                PlannedMeals { breakfast: "2 hard-boiled eggs + arrowroot".into(), dinner: "Rice + ndengu or beans · aim for about 1 cup rice".into(), ..Default::default() },
                PlannedMeals { breakfast: "Tea + bread toast".into(), dinner: "Ugali + greens + avocado · go light on oil".into(), ..Default::default() },
                PlannedMeals { breakfast: "2 hard-boiled eggs + sweet potato".into(), dinner: "Matoke + chicken stew, or rice + beans".into(), ..Default::default() },
                PlannedMeals { breakfast: "2 hard-boiled eggs + arrowroot".into(), dinner: "Pilau or mokimo + stew · moderate portion, extra vegetables".into(), ..Default::default() },
                PlannedMeals { breakfast: "Tea + bread + egg + nduma".into(), dinner: "1 chapati + beans or ndengu".into(), ..Default::default() },
            ],
            workout_overrides: BTreeMap::new(), meal_overrides: BTreeMap::new(),
        }
    }
}

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
struct UserProfile { name: String, goal: String, preferences: String, equipment: String, availability: String }

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
struct ActualWorkout { title: String, details: String, items: Vec<WorkoutItem> }

#[derive(Clone, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
struct SavedData {
    alarm_time: String,
    alarm_sound: String,
    tracking_since: String,
    completed: Vec<String>,
    skipped: BTreeMap<String, String>,
    measurements: BTreeMap<String, Measurement>,
    meals: BTreeMap<String, MealLog>,
    plan: PlanConfig,
    #[serde(default)] schedule: Schedule,
    #[serde(default)] profile: Option<UserProfile>,
    #[serde(default)] onboarding_complete: Option<bool>,
    #[serde(default)] actual_workouts: BTreeMap<String, ActualWorkout>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ImportFile { format: String, version: u8, data: SavedData }

impl Default for SavedData {
    fn default() -> Self {
        Self {
            alarm_time: "07:00".into(), alarm_sound: "Sosumi".into(), tracking_since: Local::now().date_naive().to_string(),
            completed: vec![], skipped: BTreeMap::new(),
            measurements: BTreeMap::new(), meals: BTreeMap::new(), plan: PlanConfig::default(),
            schedule: Schedule::default(), profile: None, onboarding_complete: Some(false), actual_workouts: BTreeMap::new(),
        }
    }
}

struct AppState { data: Mutex<SavedData>, path: PathBuf, alarm_active: Mutex<bool>, snooze_until: Mutex<Option<Instant>> }

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Snapshot {
    today: String, alarm_time: String, alarm_sound: String, tracking_since: String, completed: Vec<String>,
    skipped: BTreeMap<String, String>, measurements: BTreeMap<String, Measurement>,
    meals: BTreeMap<String, MealLog>, plan: PlanConfig, schedule: Schedule,
    profile: Option<UserProfile>, onboarding_complete: bool, actual_workouts: BTreeMap<String, ActualWorkout>, alarm_active: bool,
    in_plan: bool, rest_day: bool,
}

fn plan_day(date: NaiveDate, plan: &PlanConfig) -> bool {
    date.to_string() >= plan.start_date && date.to_string() <= plan.end_date
}

fn planned_workout(date: NaiveDate, schedule: &Schedule) -> PlannedWorkout {
    schedule.workout_overrides.get(&date.to_string()).cloned()
        .or_else(|| schedule.workouts.get(date.weekday().num_days_from_sunday() as usize).cloned())
        .unwrap_or_else(|| Schedule::default().workouts[date.weekday().num_days_from_sunday() as usize].clone())
}

fn planned_meals(date: NaiveDate, schedule: &Schedule) -> PlannedMeals {
    schedule.meal_overrides.get(&date.to_string()).cloned()
        .or_else(|| schedule.meals.get(date.weekday().num_days_from_sunday() as usize).cloned())
        .unwrap_or_else(|| Schedule::default().meals[date.weekday().num_days_from_sunday() as usize].clone())
}

fn workout_day(date: NaiveDate, plan: &PlanConfig, schedule: &Schedule) -> bool {
    plan_day(date, plan) && !planned_workout(date, schedule).rest_day
}

fn snapshot(state: &AppState) -> Snapshot {
    let date = Local::now().date_naive();
    let data = state.data.lock().unwrap().clone();
    Snapshot {
        today: date.to_string(), alarm_time: data.alarm_time, alarm_sound: data.alarm_sound, tracking_since: data.tracking_since,
        completed: data.completed, skipped: data.skipped, measurements: data.measurements,
        meals: data.meals, plan: data.plan.clone(), schedule: data.schedule.clone(), profile: data.profile.clone(),
        onboarding_complete: data.onboarding_complete.unwrap_or(true), actual_workouts: data.actual_workouts.clone(),
        alarm_active: *state.alarm_active.lock().unwrap(),
        in_plan: plan_day(date, &data.plan), rest_day: planned_workout(date, &data.schedule).rest_day,
    }
}

fn save(state: &AppState, data: &SavedData) -> Result<(), String> {
    if let Some(parent) = state.path.parent() { fs::create_dir_all(parent).map_err(|e| e.to_string())?; }
    let temp = state.path.with_extension("tmp");
    fs::write(&temp, serde_json::to_vec_pretty(data).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    fs::rename(temp, &state.path).map_err(|e| e.to_string())
}

fn validate_schedule(schedule: &Schedule) -> Result<(), String> {
    if schedule.workouts.len() != 7 || schedule.meals.len() != 7 {
        return Err("A weekly plan must include all seven days.".into());
    }
    let valid_workout = |w: &PlannedWorkout| w.title.chars().count() <= 80 && w.details.chars().count() <= 500 && w.items.len() <= 60 && w.items.iter().all(|item| item.name.chars().count() <= 100 && item.reps.chars().count() <= 60) && (w.rest_day || !w.title.trim().is_empty());
    let valid_meals = |m: &PlannedMeals| [&m.breakfast, &m.lunch, &m.dinner, &m.snacks].iter().all(|v| v.chars().count() <= 250);
    if schedule.workouts.iter().any(|w| !valid_workout(w)) || schedule.workout_overrides.values().any(|w| !valid_workout(w)) {
        return Err("Check workout names and exercise rows (names up to 100 characters, sets or reps up to 60).".into());
    }
    if schedule.meals.iter().any(|m| !valid_meals(m)) || schedule.meal_overrides.values().any(|m| !valid_meals(m)) {
        return Err("Keep each planned meal under 250 characters.".into());
    }
    for date in schedule.workout_overrides.keys().chain(schedule.meal_overrides.keys()) {
        NaiveDate::parse_from_str(date, "%Y-%m-%d").map_err(|_| "The plan contains an invalid date.")?;
    }
    Ok(())
}

fn validate_plan(plan: &PlanConfig) -> Result<(), String> {
    let start = NaiveDate::parse_from_str(&plan.start_date, "%Y-%m-%d").map_err(|_| "Invalid start date")?;
    let end = NaiveDate::parse_from_str(&plan.end_date, "%Y-%m-%d").map_err(|_| "Invalid end date")?;
    if end < start || (end - start).num_days() > 365 { return Err("Choose a challenge period of up to one year.".into()); }
    if !(30.0..=300.0).contains(&plan.start_weight) || !(30.0..=300.0).contains(&plan.target_weight) {
        return Err("Weight values must be between 30 and 300 kg.".into());
    }
    Ok(())
}

#[tauri::command]
fn finish_setup(app: tauri::AppHandle, state: tauri::State<AppState>, profile: UserProfile, plan: PlanConfig, schedule: Schedule) -> Result<Snapshot, String> {
    if profile.name.trim().is_empty() || profile.name.chars().count() > 80 || profile.goal.trim().is_empty() || profile.goal.chars().count() > 240 {
        return Err("Add your name and a short description of your goal.".into());
    }
    validate_plan(&plan)?;
    validate_schedule(&schedule)?;
    let mut data = state.data.lock().map_err(|e| e.to_string())?;
    data.profile = Some(UserProfile { name: profile.name.trim().into(), goal: profile.goal.trim().chars().take(240).collect(), preferences: profile.preferences.trim().chars().take(500).collect(), equipment: profile.equipment.trim().chars().take(250).collect(), availability: profile.availability.trim().chars().take(40).collect() });
    data.plan = plan;
    data.schedule = schedule;
    data.onboarding_complete = Some(true);
    data.tracking_since = Local::now().date_naive().to_string();
    save(&state, &data)?;
    drop(data);
    let result = snapshot(&state);
    let _ = app.emit("state-changed", &result);
    Ok(result)
}

#[tauri::command]
fn save_schedule(app: tauri::AppHandle, state: tauri::State<AppState>, schedule: Schedule) -> Result<Snapshot, String> {
    validate_schedule(&schedule)?;
    let mut data = state.data.lock().map_err(|e| e.to_string())?;
    let today = Local::now().date_naive();
    let start = NaiveDate::parse_from_str(&data.plan.start_date, "%Y-%m-%d").map_err(|_| "Invalid plan start date")?;
    let end = NaiveDate::parse_from_str(&data.plan.end_date, "%Y-%m-%d").map_err(|_| "Invalid plan end date")?;
    let last_past = std::cmp::min(end, today - chrono::Duration::days(1));
    let mut updated = schedule;
    if last_past >= start {
        let mut date = start;
        while date <= last_past {
            let key = date.to_string();
            updated.workout_overrides.entry(key.clone()).or_insert_with(|| planned_workout(date, &data.schedule));
            updated.meal_overrides.entry(key).or_insert_with(|| planned_meals(date, &data.schedule));
            date += chrono::Duration::days(1);
        }
    }
    data.schedule = updated;
    save(&state, &data)?;
    drop(data);
    let result = snapshot(&state);
    let _ = app.emit("state-changed", &result);
    Ok(result)
}

#[tauri::command]
fn save_actual_workout(app: tauri::AppHandle, state: tauri::State<AppState>, date: String, workout: ActualWorkout) -> Result<Snapshot, String> {
    let parsed = NaiveDate::parse_from_str(&date, "%Y-%m-%d").map_err(|_| "Invalid date")?;
    if workout.title.chars().count() > 80 || workout.details.chars().count() > 500 || workout.items.len() > 60 || workout.items.iter().any(|item| item.name.chars().count() > 100 || item.reps.chars().count() > 60) { return Err("Check the workout name and exercise rows (names up to 100 characters, sets or reps up to 60).".into()); }
    let mut data = state.data.lock().map_err(|e| e.to_string())?;
    if !plan_day(parsed, &data.plan) || parsed > Local::now().date_naive() { return Err("Choose a date within the plan up to today.".into()); }
    let title = workout.title.trim();
    if title.is_empty() { data.actual_workouts.remove(&date); }
    else {
        data.actual_workouts.insert(date.clone(), ActualWorkout { title: title.into(), details: workout.details.trim().into(), items: workout.items.into_iter().filter(|item| !item.name.trim().is_empty()).map(|mut item| { item.name = item.name.trim().into(); item.reps = item.reps.trim().into(); item }).collect() });
        data.completed.retain(|d| d != &date);
        data.completed.push(date.clone());
        data.completed.sort();
        data.skipped.remove(&date);
    }
    save(&state, &data)?;
    drop(data);
    let result = snapshot(&state);
    let _ = app.emit("state-changed", &result);
    Ok(result)
}

#[tauri::command]
fn save_profile(app: tauri::AppHandle, state: tauri::State<AppState>, name: String) -> Result<Snapshot, String> {
    let name = name.trim();
    if name.is_empty() || name.chars().count() > 80 { return Err("Enter a name between 1 and 80 characters.".into()); }
    let mut data = state.data.lock().map_err(|e| e.to_string())?;
    let profile = data.profile.get_or_insert_with(UserProfile::default);
    profile.name = name.to_string();
    save(&state, &data)?;
    drop(data);
    let result = snapshot(&state);
    let _ = app.emit("state-changed", &result);
    Ok(result)
}

#[tauri::command]
fn get_state(state: tauri::State<AppState>) -> Snapshot { snapshot(&state) }

#[tauri::command]
fn export_data(state: tauri::State<AppState>) -> Result<String, String> {
    let data = state.data.lock().map_err(|e| e.to_string())?;
    serde_json::to_string_pretty(&serde_json::json!({ "format": "daily-drive", "version": 1, "data": &*data }))
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn write_export_file(path: String, contents: String) -> Result<(), String> {
    fs::write(path, contents).map_err(|e| format!("Could not save the export: {e}"))
}

#[tauri::command]
fn reveal_export_file(path: String) -> Result<(), String> {
    let path = fs::canonicalize(path).map_err(|e| format!("Could not find the exported file: {e}"))?;
    if !path.is_file() { return Err("The export path is not a file.".into()); }
    #[cfg(target_os = "macos")]
    let status = Command::new("open").arg("-R").arg(&path).status();
    #[cfg(target_os = "windows")]
    let status = Command::new("explorer").arg(format!("/select,{}", path.display())).status();
    #[cfg(target_os = "linux")]
    let status = Command::new("xdg-open").arg(path.parent().unwrap_or_else(|| std::path::Path::new("."))).status();
    let status = status.map_err(|e| format!("Could not open the file location: {e}"))?;
    if status.success() { Ok(()) } else { Err(format!("The file browser exited with {status}.")) }
}

#[tauri::command]
fn import_data(app: tauri::AppHandle, state: tauri::State<AppState>, contents: String) -> Result<Snapshot, String> {
    let imported: ImportFile = serde_json::from_str(&contents).map_err(|_| "This file is not a valid Daily Drive export.".to_string())?;
    if imported.format != "daily-drive" || imported.version != 1 { return Err("This Daily Drive export version is not supported.".into()); }
    let start = NaiveDate::parse_from_str(&imported.data.plan.start_date, "%Y-%m-%d").map_err(|_| "The export contains an invalid plan date.")?;
    let end = NaiveDate::parse_from_str(&imported.data.plan.end_date, "%Y-%m-%d").map_err(|_| "The export contains an invalid plan date.")?;
    if end < start || (end - start).num_days() > 365 || !(30.0..=300.0).contains(&imported.data.plan.start_weight) || !(30.0..=300.0).contains(&imported.data.plan.target_weight) {
        return Err("The export contains an invalid challenge plan.".into());
    }
    validate_schedule(&imported.data.schedule)?;
    alarm_sound_path(&imported.data.alarm_sound)?;
    let time = &imported.data.alarm_time;
    if time.len() != 5 || time.as_bytes().get(2) != Some(&b':') || !time[..2].parse::<u8>().is_ok_and(|h| h < 24) || !time[3..].parse::<u8>().is_ok_and(|m| m < 60) {
        return Err("The export contains an invalid alarm time.".into());
    }
    for date in imported.data.completed.iter().chain(imported.data.skipped.keys()).chain(imported.data.measurements.keys()).chain(imported.data.meals.keys()).chain(imported.data.actual_workouts.keys()) {
        NaiveDate::parse_from_str(date, "%Y-%m-%d").map_err(|_| "The export contains an invalid history date.")?;
    }

    let mut current = state.data.lock().map_err(|e| e.to_string())?;
    let mut merged = current.clone();
    merged.alarm_time = imported.data.alarm_time;
    merged.alarm_sound = imported.data.alarm_sound;
    merged.tracking_since = merged.tracking_since.min(imported.data.tracking_since);
    merged.completed.extend(imported.data.completed);
    merged.completed.sort();
    merged.completed.dedup();
    merged.skipped.extend(imported.data.skipped);
    merged.measurements.extend(imported.data.measurements);
    merged.meals.extend(imported.data.meals);
    merged.plan = imported.data.plan;
    merged.schedule = imported.data.schedule;
    merged.profile = imported.data.profile;
    merged.onboarding_complete = Some(imported.data.onboarding_complete.unwrap_or(true));
    merged.actual_workouts.extend(imported.data.actual_workouts);

    let backup = state.path.with_file_name(format!("progress.backup-import-{}.json", Local::now().format("%Y%m%d-%H%M%S-%3f")));
    if state.path.exists() { fs::copy(&state.path, backup).map_err(|e| format!("Could not back up current history: {e}"))?; }
    save(&state, &merged)?;
    *current = merged;
    drop(current);
    let result = snapshot(&state);
    let _ = app.emit("state-changed", &result);
    Ok(result)
}

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

const ALARM_SOUNDS: &[&str] = &["Basso", "Blow", "Bottle", "Frog", "Funk", "Glass", "Hero", "Morse", "Ping", "Pop", "Purr", "Sosumi", "Submarine", "Tink"];

fn alarm_sound_path(sound: &str) -> Result<String, String> {
    #[cfg(target_os = "macos")]
    { if !ALARM_SOUNDS.contains(&sound) { return Err("Choose an available alarm sound.".into()); } Ok(format!("/System/Library/Sounds/{sound}.aiff")) }
    #[cfg(not(target_os = "macos"))]
    { if sound == "System alert" || ALARM_SOUNDS.contains(&sound) { Ok(sound.to_string()) } else { Err("Choose an available alarm sound.".into()) } }
}

fn play_alarm_sound(sound: &str) -> Result<(), String> {
    let path = alarm_sound_path(sound)?;
    #[cfg(target_os = "macos")]
    let mut command = { let mut c = Command::new("afplay"); c.arg(path); c };
    #[cfg(target_os = "windows")]
    let mut command = { let mut c = Command::new("powershell"); c.args(["-NoProfile", "-NonInteractive", "-Command", "[console]::beep(880,500)"]); c };
    #[cfg(target_os = "linux")]
    let mut command = { let mut c = Command::new("canberra-gtk-play"); c.args(["--description=Daily Drive workout alarm", "--id=bell" ]); c };
    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    return Err("Alarm audio is not supported on this platform.".into());
    command.spawn().map(|_| ()).map_err(|e| format!("Could not play the alarm sound: {e}"))
}

#[tauri::command]
fn set_alarm_sound(app: tauri::AppHandle, state: tauri::State<AppState>, sound: String) -> Result<Snapshot, String> {
    alarm_sound_path(&sound)?;
    let mut data = state.data.lock().unwrap();
    data.alarm_sound = sound;
    save(&state, &data)?;
    drop(data);
    let result = snapshot(&state);
    let _ = app.emit("state-changed", &result);
    Ok(result)
}

#[tauri::command]
fn preview_alarm_sound(sound: String) -> Result<(), String> {
    play_alarm_sound(&sound)
}

#[tauri::command]
fn complete_today(app: tauri::AppHandle, state: tauri::State<AppState>) -> Result<Snapshot, String> {
    set_workout_status(app, state, Local::now().date_naive().to_string(), "completed".into(), None)
}

#[tauri::command]
fn snooze_alarm(app: tauri::AppHandle, state: tauri::State<AppState>) -> Result<Snapshot, String> {
    if !*state.alarm_active.lock().unwrap() { return Err("The alarm is not active.".into()); }
    *state.snooze_until.lock().unwrap() = Some(Instant::now() + Duration::from_secs(10 * 60));
    *state.alarm_active.lock().unwrap() = false;
    if let Some(window) = app.get_webview_window("main") { let _ = window.set_always_on_top(false); }
    let result = snapshot(&state);
    let _ = app.emit("state-changed", &result);
    Ok(result)
}

#[tauri::command]
fn set_workout_status(app: tauri::AppHandle, state: tauri::State<AppState>, date: String, status: String, reason: Option<String>) -> Result<Snapshot, String> {
    let parsed = NaiveDate::parse_from_str(&date, "%Y-%m-%d").map_err(|_| "Invalid date")?;
    let mut data = state.data.lock().unwrap();
    if !plan_day(parsed, &data.plan) || parsed > Local::now().date_naive() || (status != "clear" && !workout_day(parsed, &data.plan, &data.schedule)) {
        return Err("Choose a scheduled workout day up to today.".into());
    }
    if !matches!(status.as_str(), "completed" | "skipped" | "clear") {
        return Err("Invalid workout status.".into());
    }
    data.completed.retain(|d| d != &date);
    data.skipped.remove(&date);
    match status.as_str() {
        "completed" => { data.completed.push(date); data.completed.sort(); }
        "skipped" => {
            let note = reason.unwrap_or_default().trim().chars().take(160).collect();
            data.skipped.insert(date, note);
        }
        "clear" => {}
        _ => unreachable!(),
    }
    save(&state, &data)?;
    drop(data);
    *state.alarm_active.lock().unwrap() = false;
    *state.snooze_until.lock().unwrap() = None;
    if let Some(window) = app.get_webview_window("main") { let _ = window.set_always_on_top(false); }
    let result = snapshot(&state);
    let _ = app.emit("state-changed", &result);
    Ok(result)
}

#[tauri::command]
fn save_plan(app: tauri::AppHandle, state: tauri::State<AppState>, plan: PlanConfig) -> Result<Snapshot, String> {
    validate_plan(&plan)?;
    let mut data = state.data.lock().unwrap();
    data.plan = plan;
    save(&state, &data)?;
    drop(data);
    let result = snapshot(&state);
    let _ = app.emit("state-changed", &result);
    Ok(result)
}

#[tauri::command]
fn save_measurement(app: tauri::AppHandle, state: tauri::State<AppState>, date: String, weight: Option<f32>, waist: Option<f32>) -> Result<Snapshot, String> {
    let parsed = NaiveDate::parse_from_str(&date, "%Y-%m-%d").map_err(|_| "Invalid date")?;
    if weight.is_some_and(|v| !(30.0..=300.0).contains(&v)) || waist.is_some_and(|v| !(30.0..=250.0).contains(&v)) { return Err("Check your measurement values.".into()); }
    let mut data = state.data.lock().unwrap();
    if !plan_day(parsed, &data.plan) || parsed > Local::now().date_naive() { return Err("Choose a date within the plan up to today.".into()); }
    data.measurements.insert(date, Measurement { weight, waist });
    save(&state, &data)?;
    drop(data);
    let result = snapshot(&state);
    let _ = app.emit("state-changed", &result);
    Ok(result)
}

#[tauri::command]
fn save_meals(app: tauri::AppHandle, state: tauri::State<AppState>, date: String, meals: MealLog) -> Result<Snapshot, String> {
    let parsed = NaiveDate::parse_from_str(&date, "%Y-%m-%d").map_err(|_| "Invalid date")?;
    if [&meals.breakfast, &meals.lunch, &meals.dinner, &meals.snacks].iter().any(|v| v.chars().count() > 250) {
        return Err("Keep each meal entry under 250 characters.".into());
    }
    let mut data = state.data.lock().unwrap();
    if !plan_day(parsed, &data.plan) || parsed > Local::now().date_naive() { return Err("Choose a date within the plan up to today.".into()); }
    let cleaned = MealLog {
        breakfast: meals.breakfast.trim().into(), lunch: meals.lunch.trim().into(),
        dinner: meals.dinner.trim().into(), snacks: meals.snacks.trim().into(),
    };
    if cleaned.breakfast.is_empty() && cleaned.lunch.is_empty() && cleaned.dinner.is_empty() && cleaned.snacks.is_empty() {
        data.meals.remove(&date);
    } else {
        data.meals.insert(date, cleaned);
    }
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
        let mut last_date = Local::now().date_naive();
        loop {
            let state = app.state::<AppState>();
            let now = Local::now();
            let date = now.date_naive();
            let today = date.to_string();
            let due = {
                let data = state.data.lock().unwrap();
                data.onboarding_complete.unwrap_or(true) && workout_day(date, &data.plan, &data.schedule) &&
                now.format("%H:%M").to_string() >= data.alarm_time &&
                !data.completed.contains(&today) && !data.skipped.contains_key(&today)
            } && {
                let mut snooze = state.snooze_until.lock().unwrap();
                if snooze.is_some_and(|until| Instant::now() < until) { false }
                else { *snooze = None; true }
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
            }
            if changed || date != last_date {
                let _ = app.emit("state-changed", snapshot(&state));
            }
            last_date = date;
            if due {
                if last_focus.elapsed() >= Duration::from_secs(30) {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.show(); let _ = window.unminimize(); let _ = window.set_focus();
                    }
                    last_focus = Instant::now();
                }
                if last_sound.elapsed() >= Duration::from_secs(4) {
                    let sound = state.data.lock().unwrap().alarm_sound.clone();
                    thread::spawn(move || { let _ = play_alarm_sound(&sound); });
                    last_sound = Instant::now();
                }
            }
            thread::sleep(Duration::from_secs(1));
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.show();
            let _ = window.unminimize();
            let _ = window.set_focus();
        }
    }));
    builder
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, None))
        .setup(|app| {
            let show_item = MenuItem::with_id(app, "open", "Open Daily Drive", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &quit_item])?;
            let tray_builder = TrayIconBuilder::new();
            #[cfg(target_os = "macos")]
            let tray_builder = tray_builder
                .icon(tauri::image::Image::from_bytes(include_bytes!("../icons/tray-icon.png"))?)
                .icon_as_template(true);
            #[cfg(not(target_os = "macos"))]
            let tray_builder = tray_builder.icon(app.default_window_icon().expect("default app icon").clone());
            let _tray = tray_builder
                .menu(&menu)
                .tooltip("Daily Drive")
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => if let Some(window) = app.get_webview_window("main") { let _ = window.show(); let _ = window.unminimize(); let _ = window.set_focus(); },
                    "quit" => app.exit(0),
                    _ => (),
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                        if let Some(window) = tray.app_handle().get_webview_window("main") { let _ = window.show(); let _ = window.unminimize(); let _ = window.set_focus(); }
                    }
                })
                .build(app)?;
            let path = app.path().app_data_dir()?.join("progress.json");
            let login_marker = path.with_file_name("autostart-initialized");
            let had_saved_data = path.exists();
            let mut data: SavedData = fs::read(&path).ok().and_then(|bytes| serde_json::from_slice(&bytes).ok()).unwrap_or_default();
            if data.onboarding_complete.is_none() { data.onboarding_complete = Some(had_saved_data); }
            app.manage(AppState { data: Mutex::new(data), path, alarm_active: Mutex::new(false), snooze_until: Mutex::new(None) });
            {
                let state = app.state::<AppState>();
                let data = state.data.lock().unwrap();
                let _ = save(&state, &data);
            }
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
        .invoke_handler(tauri::generate_handler![get_state, export_data, write_export_file, reveal_export_file, import_data, finish_setup, save_schedule, save_actual_workout, save_profile, set_alarm_time, set_alarm_sound, preview_alarm_sound, complete_today, snooze_alarm, set_workout_status, save_plan, save_measurement, save_meals, launch_at_login, login_enabled])
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn existing_progress_loads_with_new_defaults() {
        let old = r#"{"alarmTime":"07:00","completed":["2026-09-21"],"measurements":{"2026-09-21":{"weight":96.5,"waist":null}}}"#;
        let saved: SavedData = serde_json::from_str(old).unwrap();
        assert_eq!(saved.completed, ["2026-09-21"]);
        assert_eq!(saved.measurements["2026-09-21"].weight, Some(96.5));
        assert_eq!(saved.plan.start_weight, 99.0);
        assert_eq!(saved.plan.start_date, "2026-09-24");
        assert!(!saved.tracking_since.is_empty());
        assert!(saved.skipped.is_empty());
        assert!(saved.meals.is_empty());
    }

    #[test]
    fn workout_days_follow_edited_plan_and_exclude_sundays() {
        let plan = PlanConfig {
            start_date: "2026-09-14".into(),
            end_date: "2026-09-26".into(),
            ..PlanConfig::default()
        };
        let schedule = Schedule::default();
        assert!(!workout_day(NaiveDate::from_ymd_opt(2026, 9, 12).unwrap(), &plan, &schedule));
        assert!(workout_day(NaiveDate::from_ymd_opt(2026, 9, 14).unwrap(), &plan, &schedule));
        assert!(!workout_day(NaiveDate::from_ymd_opt(2026, 9, 20).unwrap(), &plan, &schedule));
        assert!(workout_day(NaiveDate::from_ymd_opt(2026, 9, 26).unwrap(), &plan, &schedule));
    }
}
