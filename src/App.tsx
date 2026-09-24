import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import "./App.css";

type Measurement = { weight: number | null; waist: number | null };
type Plan = { startDate: string; endDate: string; startWeight: number; targetWeight: number };
type MealLog = { breakfast: string; lunch: string; dinner: string; snacks: string };
type Snapshot = {
  today: string; alarmTime: string; trackingSince: string; completed: string[]; measurements: Record<string, Measurement>;
  skipped: Record<string, string>; meals: Record<string, MealLog>; plan: Plan;
  alarmActive: boolean; inPlan: boolean; restDay: boolean;
};

const breakfast = [
  "2 hard-boiled eggs + arrowroot",
  "2 hard-boiled eggs + sweet potato or arrowroot",
  "2 hard-boiled eggs + arrowroot",
  "Tea + bread toast",
  "2 hard-boiled eggs + sweet potato",
  "2 hard-boiled eggs + arrowroot",
  "Tea + bread + egg + nduma",
];
const dinner = [
  "Leftovers, or a smaller portion of roast potatoes + pork / chicken alfredo",
  "Ugali + greens + fish or matumbo · aim for about 1 cup ugali",
  "Rice + ndengu or beans · aim for about 1 cup rice",
  "Ugali + greens + avocado · go light on oil",
  "Matoke + chicken stew, or rice + beans",
  "Pilau or mokimo + stew · moderate portion, extra vegetables",
  "1 chapati + beans or ndengu",
];
const cutNotes = [
  "Leftovers, or smaller portions of the other options.",
  "Choose fish more often; about 1 cup of ugali.",
  "About 1 cup of rice.",
  "Watch the oil in the greens.",
  "Favor chicken stew or rice and beans.",
  "Keep pilau; moderate portion, light oil, extra vegetables.",
  "Keep chapati to one.",
];
const strength = [
  ["Push-ups", "3–4 × 10–15"], ["Dumbbell rows", "3–4 × 10–12 / side"],
  ["Goblet squats", "3–4 × 12–15"], ["Reverse or walking lunges", "3 × 10–12 / leg"],
  ["Dumbbell shoulder press", "3 × 10–12"], ["Glute bridges", "3 × 15"],
  ["Plank", "3 × 30–60 sec"], ["Lying leg raises", "3 × 12–15"],
];
const dateOf = (iso: string) => { const [y, m, d] = iso.split("-").map(Number); return new Date(y, m - 1, d); };
const isoOf = (date: Date) => [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
const pretty = (iso: string) => dateOf(iso).toLocaleDateString("en-KE", { month: "short", day: "numeric" });
const addDays = (date: Date, days: number) => { const next = new Date(date); next.setDate(next.getDate() + days); return next; };
const monday = (date: Date) => addDays(date, -((date.getDay() + 6) % 7));
const dayCount = (start: string, end: string) => Math.round((dateOf(end).getTime() - dateOf(start).getTime()) / 86400000) + 1;
const emptyMeals = (): MealLog => ({ breakfast: "", lunch: "", dinner: "", snacks: "" });
function workoutForDate(date: Date, plan: Plan) {
  const totalWeeks = Math.ceil(dayCount(plan.startDate, plan.endDate) / 7);
  const week = Math.max(1, Math.min(totalWeeks, Math.floor((date.getTime() - dateOf(plan.startDate).getTime()) / 604800000) + 1));
  const phase = totalWeeks <= 2 ? 0 : Math.min(2, Math.floor((week - 1) * 3 / totalWeeks));
  const day = date.getDay();
  return { week, phase, label: day === 0 ? "Rest day" : [1, 3, 5].includes(day) ? "Full-body strength" : day === 6 && phase > 0 ? "Treadmill intervals" : "Incline treadmill" };
}
type WorkoutStatus = "completed" | "skipped" | "missed" | "untracked" | "pending" | "rest" | "future" | "outside" | "inactive";
function workoutStatus(state: Snapshot, iso: string): WorkoutStatus {
  if (iso < state.plan.startDate || iso > state.plan.endDate) return "outside";
  if (dateOf(iso).getDay() === 0) return "rest";
  if (state.completed.includes(iso)) return "completed";
  if (Object.prototype.hasOwnProperty.call(state.skipped, iso)) return "skipped";
  if (iso < state.trackingSince) return "untracked";
  if (iso < state.today) return "missed";
  return iso === state.today ? "pending" : "future";
}
function currentWeight(state: Snapshot): number {
  const latest = Object.entries(state.measurements)
    .filter(([date, item]) => date >= state.plan.startDate && date <= state.today && item.weight != null)
    .sort(([a], [b]) => b.localeCompare(a))[0];
  return latest?.[1].weight ?? state.plan.startWeight;
}

function WeightChart({ state, onLog }: { state: Snapshot; onLog: () => void }) {
  const points = [[state.plan.startDate, state.plan.startWeight] as const,
    ...Object.entries(state.measurements)
      .filter(([date, value]) => date >= state.plan.startDate && date <= state.plan.endDate && date <= state.today && value.weight != null)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, value]) => [date, value.weight!] as const)];
  const values = [...points.map(([, value]) => value), state.plan.targetWeight];
  const low = Math.min(...values) - 1;
  const high = Math.max(...values) + 1;
  const span = Math.max(1, dayCount(state.plan.startDate, state.plan.endDate) - 1);
  const x = (date: string) => 10 + Math.max(0, Math.min(1, (dateOf(date).getTime() - dateOf(state.plan.startDate).getTime()) / 86400000 / span)) * 260;
  const y = (value: number) => 61 - ((value - low) / (high - low)) * 51;
  const line = points.map(([date, value]) => String(x(date)) + "," + String(y(value))).join(" ");
  const last = points[points.length - 1];
  return <div className="chart-card">
    <div className="chart-heading"><span>WEIGHT TREND</span><strong>{currentWeight(state)} <small>kg</small></strong></div>
    <svg className="chart-svg" viewBox="0 0 280 70" preserveAspectRatio="none" role="img" aria-label={points.length > 1 ? "Weight trend from " + state.plan.startWeight + " to " + currentWeight(state) + " kilograms" : "No weight check-in yet"}>
      <line x1="10" y1={y(state.plan.targetWeight)} x2="270" y2={y(state.plan.targetWeight)} stroke="#c7d6b5" strokeDasharray="4 4" />
      {points.length > 1 && <polyline points={line} fill="none" stroke="#446f3d" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />}
      <circle cx={x(last[0])} cy={y(last[1])} r="4.5" fill="#93cb41" stroke="#fff" strokeWidth="2" />
    </svg>
    <div className="chart-foot"><span>Goal {state.plan.targetWeight} kg{points.length > 1 ? " · " + pretty(last[0]) : " · No weigh-ins yet"}</span><button onClick={onLog}>Log weight →</button></div>
  </div>;
}

function CircularProgress({ state }: { state: Snapshot }) {
  const scheduled = Array.from({ length: dayCount(state.plan.startDate, state.plan.endDate) }, (_, i) => isoOf(addDays(dateOf(state.plan.startDate), i)))
    .filter(date => dateOf(date).getDay() !== 0);
  const completed = scheduled.filter(date => state.completed.includes(date)).length;
  const percent = scheduled.length ? Math.round(completed / scheduled.length * 100) : 0;
  const radius = 27;
  const circumference = 2 * Math.PI * radius;
  return <div className="chart-card donut-card">
    <div className="chart-heading"><span>CHALLENGE PROGRESS</span><span>WORKOUTS</span></div>
    <div className="donut-body">
      <svg viewBox="0 0 80 80" role="img" aria-label={percent + " percent of scheduled workouts completed"}>
        <circle cx="40" cy="40" r={radius} fill="none" stroke="#dbe7cf" strokeWidth="8" />
        <circle cx="40" cy="40" r={radius} fill="none" stroke="#91c943" strokeWidth="8" strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={circumference * (1 - percent / 100)} transform="rotate(-90 40 40)" />
        <text x="40" y="44" textAnchor="middle" className="donut-percent">{percent}%</text>
      </svg>
      <div><strong>{completed} of {scheduled.length}</strong><span>planned sessions done</span><small>{Object.keys(state.skipped).filter(date => scheduled.includes(date)).length} skipped · {scheduled.filter(date => workoutStatus(state, date) === "missed").length} missed</small></div>
    </div>
  </div>;
}

function WorkoutHeatmap({ state }: { state: Snapshot }) {
  const year = dateOf(state.today).getFullYear();
  const yearStart = new Date(year, 0, 1);
  const yearEnd = new Date(year, 11, 31);
  const first = monday(yearStart);
  const weeks = Math.ceil((yearEnd.getTime() - first.getTime()) / 604800000) + 1;
  const columns = Array.from({ length: weeks }, (_, week) => Array.from({ length: 7 }, (_, day) => {
    const date = isoOf(addDays(first, week * 7 + day));
    const inYear = date.slice(0, 4) === String(year);
    const status = inYear ? workoutStatus(state, date) : "outside";
    return { date, status: status === "outside" && inYear ? "inactive" as WorkoutStatus : status as WorkoutStatus };
  }));
  const all = columns.flat();
  const count = (status: WorkoutStatus) => all.filter(day => day.status === status).length;
  const monthLabels = columns.map(() => "");
  for (let month = 0; month < 12; month++) {
    const monthMonday = monday(new Date(year, month, 1));
    const column = Math.floor((monthMonday.getTime() - first.getTime()) / 604800000);
    monthLabels[column] = new Date(year, month, 1).toLocaleDateString("en-KE", { month: "short" });
  }
  const dayLabels = ["Mon", "", "Wed", "", "Fri", "", ""];
  return <div className="heatmap-card">
    <div className="heatmap-heading"><span>YEAR AT A GLANCE</span><small>{year}</small></div>
    <div className="heatmap-content">
      <div className="heatmap-grid" style={{ gridTemplateColumns: `24px repeat(${weeks}, minmax(0, 1fr))` }} role="img" aria-label={year + " workout calendar: " + count("completed") + " completed, " + count("skipped") + " skipped, " + count("missed") + " missed"}>
        {monthLabels.map((label, i) => label && <span className="heatmap-month" key={"month-" + i} style={{ gridColumn: i + 2, gridRow: 1 }}>{label}</span>)}
        {dayLabels.map((label, i) => label && <span className="heatmap-day-label" key={"day-" + i} style={{ gridColumn: 1, gridRow: i + 2 }}>{label}</span>)}
        {columns.map((column, week) => column.map(({ date, status }, day) => <span key={date} className={"heatmap-square " + status} style={{ gridColumn: week + 2, gridRow: day + 2 }} title={pretty(date) + ": " + status} />))}
      </div>
      <div className="heatmap-side">
        <div className="heatmap-summary"><b>{count("completed")} done</b><span>{count("skipped")} skipped · {count("missed")} missed</span></div>
        <div className="heatmap-legend"><span className="legend-swatch completed" /><span>Done</span><span className="legend-swatch skipped" /><span>Skipped</span><span className="legend-swatch missed" /><span>Missed</span></div>
      </div>
    </div>
  </div>;
}

function App() {
  const [state, setState] = useState<Snapshot | null>(null);
  const [tab, setTab] = useState<"today" | "calendar" | "meals" | "progress" | "settings">("today");
  const [alarmInput, setAlarmInput] = useState("07:00");
  const [login, setLogin] = useState(false);
  const [weight, setWeight] = useState("");
  const [waist, setWaist] = useState("");
  const [measurementDate, setMeasurementDate] = useState("");
  const [planInput, setPlanInput] = useState<Plan | null>(null);
  const [mealInput, setMealInput] = useState<MealLog>(emptyMeals());
  const [mealEditor, setMealEditor] = useState(false);
  const [mealDate, setMealDate] = useState("");
  const [skipEditor, setSkipEditor] = useState(false);
  const [skipReason, setSkipReason] = useState("");
  const [calendarMonth, setCalendarMonth] = useState("2026-09");
  const [selectedDate, setSelectedDate] = useState("2026-09-24");
  const [mealWeekOffset, setMealWeekOffset] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const notificationSentFor = useRef("");

  useEffect(() => {
    invoke<Snapshot>("get_state").then(s => { setState(s); setAlarmInput(s.alarmTime); setPlanInput(s.plan); setMealDate(s.today); setMeasurementDate(s.today); setSelectedDate(s.today); setCalendarMonth(s.today.slice(0, 7)); }).catch(e => setError(String(e)));
    invoke<boolean>("login_enabled").then(setLogin).catch(() => {});
    let stop: (() => void) | undefined;
    listen<Snapshot>("state-changed", e => setState(e.payload)).then(fn => { stop = fn; });
    return () => stop?.();
  }, []);

  useEffect(() => {
    if (!state?.alarmActive || notificationSentFor.current === state.today) return;
    notificationSentFor.current = state.today;
    let cancelled = false;
    void (async () => {
      try {
        let permitted = await isPermissionGranted();
        if (!permitted) permitted = (await requestPermission()) === "granted";
        if (permitted && !cancelled) sendNotification({ title: "Daily Drive", body: "Workout time. Your daily session is ready." });
      } catch (e) { console.warn("Could not send alarm notification", e); }
    })();
    return () => { cancelled = true; };
  }, [state?.alarmActive]);

  const today = state ? dateOf(state.today) : new Date();
  const day = today.getDay();
  const start = state ? dateOf(state.plan.startDate) : new Date(2026, 8, 7);
  const totalWeeks = state ? Math.ceil(dayCount(state.plan.startDate, state.plan.endDate) / 7) : 12;
  const week = Math.max(1, Math.min(totalWeeks, Math.floor((today.getTime() - start.getTime()) / 604800000) + 1));
  const phaseIndex = totalWeeks <= 2 ? 0 : Math.min(2, Math.floor((week - 1) * 3 / totalWeeks));
  const phase = ["Foundation", "Build", "Finish strong"][phaseIndex];
  const done = !!state?.completed.includes(state.today);
  const skipped = !!state && Object.prototype.hasOwnProperty.call(state.skipped, state.today);
  const isStrength = [1, 3, 5].includes(day);
  const intervals = phase !== "Foundation" && day === 6;
  const workoutName = day === 0 ? "Rest & recharge" : isStrength ? "Full-body strength" : intervals ? "Treadmill intervals" : "Incline treadmill";
  const logged = useMemo(() => state?.measurements[measurementDate], [state, measurementDate]);

  useEffect(() => { setWeight(logged?.weight?.toString() ?? ""); setWaist(logged?.waist?.toString() ?? ""); }, [logged?.weight, logged?.waist]);
  useEffect(() => { if (state && !mealEditor) setMealInput(state.meals[mealDate || state.today] ?? emptyMeals()); }, [state?.today, state?.meals, mealDate, mealEditor]);
  useEffect(() => { if (state) setPlanInput(state.plan); }, [state?.plan]);

  async function act<T>(command: string, args?: Record<string, unknown>, after?: (value: T) => void) {
    setBusy(true); setError("");
    try { const value = await invoke<T>(command, args); after?.(value); }
    catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  }

  const dates = Array.from({ length: totalWeeks }, (_, i) => addDays(start, i * 7));
  const recentDays = Array.from({ length: Math.min(7, Math.max(0, dayCount(state?.plan.startDate ?? "2026-09-24", state?.today ?? "2026-09-24"))) }, (_, i) => addDays(today, -i));
  const actualMeals = state?.meals[state.today];
  const hasActualMeals = !!actualMeals && Object.values(actualMeals).some(Boolean);
  const selected = dateOf(selectedDate);
  const selectedStatus = state ? workoutStatus(state, selectedDate) : "outside";
  const selectedWorkout = state ? workoutForDate(selected, state.plan) : null;
  const monthStart = dateOf(calendarMonth + "-01");
  const calendarStart = monday(monthStart);
  const nextMonth = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 1);
  const gridCount = ((monthStart.getDay() + 6) % 7) + new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0).getDate() > 35 ? 42 : 35;
  const calendarDates = Array.from({ length: gridCount }, (_, i) => addDays(calendarStart, i));
  const mealWeekStart = addDays(monday(today), mealWeekOffset * 7);
  const mealWeekDays = Array.from({ length: 7 }, (_, i) => addDays(mealWeekStart, i));

  return (
    <div className={state?.alarmActive ? "app alarm-on" : "app"}>
      <header className="topbar">
        <div className="brand"><div className="brand-mark">D</div><span>DAILY DRIVE</span></div>
        <div className="top-right"><span className="anniversary">GOAL · {state ? pretty(state.plan.endDate).toUpperCase() : "NOV 28"}</span><span className="date-pill">{state ? today.toLocaleDateString("en-KE", { weekday: "short", month: "short", day: "numeric" }) : "Loading…"}</span></div>
      </header>
      <div className="shell">
        <aside className="sidebar">
          <div className="side-label">YOUR PLAN</div>
          <button className={tab === "today" ? "nav active" : "nav"} onClick={() => setTab("today")}><span>◉</span> Today</button>
          <button className={tab === "calendar" ? "nav active" : "nav"} onClick={() => setTab("calendar")}><span>▦</span> Calendar</button>
          <button className={tab === "meals" ? "nav active" : "nav"} onClick={() => setTab("meals")}><span>♢</span> Meal plan</button>
          <button className={tab === "progress" ? "nav active" : "nav"} onClick={() => setTab("progress")}><span>▥</span> Progress</button>
          <button className={tab === "settings" ? "nav active" : "nav"} onClick={() => setTab("settings")}><span>⚙</span> Settings</button>
          <div className="side-bottom"><div className="mini-label">THE GOAL</div><div className="goal-numbers">{state?.plan.startWeight ?? 99} <span>→</span> {state?.plan.targetWeight ?? 90} <small>kg</small></div><p>{totalWeeks} weeks, one day at a time.</p></div>
        </aside>
        <main className={`content ${tab}-view`}>
          {!state ? <div className="loading">Loading your plan…</div> : <>
            {state.alarmActive && <div className="alarm-banner"><span className="alarm-dot" /> IT'S WORKOUT TIME <span className="alarm-sub">The alarm keeps sounding until you complete today's session.</span><button className="snooze-button" disabled={busy} onClick={() => act<Snapshot>("snooze_alarm", {}, setState)}>Snooze 10 min</button></div>}
            {error && <div className="error" role="alert">{error}</div>}
            {tab === "today" && <>
              <div className="eyebrow">WEEK {week} OF {totalWeeks} <span>·</span> {phase.toUpperCase()}</div>
              <h1>{done ? "You showed up today." : skipped ? "Tomorrow is another chance." : state.restDay ? "Rest is part of the plan." : "Let's get moving."}</h1>
              <p className="intro">{state.inPlan ? "Your daily check-in for the challenge." : "Your plan runs " + pretty(state.plan.startDate) + " – " + pretty(state.plan.endDate) + "."}</p>
              <div className="charts-row"><CircularProgress state={state} /><WeightChart state={state} onLog={() => setTab("progress")} /></div>
              <WorkoutHeatmap state={state} />
              <div className="hero-card">
                <div className="hero-top"><span className="section-kicker">TODAY'S WORKOUT</span><span className={done ? "status done" : "status"}>{done ? "✓ Completed" : skipped ? "↷ Skipped" : state.restDay ? "Rest day" : "● To do"}</span></div>
                <div className="hero-title">{workoutName}</div>
                <div className="hero-desc">{skipped && state.skipped[state.today] ? "Skipped: " + state.skipped[state.today] : isStrength ? "Monday · Wednesday · Friday" : intervals ? "Saturday · interval day" : day === 0 ? "Take the day off and recover." : "Build endurance at a sustainable pace."}</div>
                {state.inPlan && !state.restDay && <div className="hero-actions">
                  <button className="complete-button" disabled={done || busy} onClick={() => act<Snapshot>("complete_today", {}, setState)}>{done ? "✓ Workout complete" : "✓ I completed this workout"}</button>
                  {!done && <button className="skip-button" disabled={busy} onClick={() => skipped ? act<Snapshot>("set_workout_status", { date: state.today, status: "clear", reason: null }, setState) : setSkipEditor(true)}>{skipped ? "Undo skip" : "Skip today"}</button>}
                </div>}
              </div>
              {skipEditor && <div className="inline-editor"><label>Skip reason (optional)<input value={skipReason} onChange={e => setSkipReason(e.target.value)} maxLength={160} placeholder="Rest, travel, sick day…" /></label><button onClick={() => act<Snapshot>("set_workout_status", { date: state.today, status: "skipped", reason: skipReason }, s => { setState(s); setSkipEditor(false); })}>Save skip</button><button className="quiet-button" onClick={() => setSkipEditor(false)}>Cancel</button></div>}
              <div className="two-col">
                <section className="panel workout-panel"><div className="panel-heading"><span>THE SESSION</span><span className="panel-icon">↗</span></div>
                  {isStrength ? <div className="exercise-list">{strength.map(([name, reps]) => <div className="exercise" key={name}><span>{name}</span><strong>{reps}</strong></div>)}</div>
                    : day === 0 ? <p className="panel-copy">No workout today. Hydrate, sleep well, and get ready for Monday.</p>
                    : intervals ? <div className="steps"><p><b>Warm up</b> 5 min flat · 5–6 km/h</p><p><b>Intervals</b> 6–8 rounds: 1 min at 8–9 km/h, 2 min at 5 km/h</p><p><b>Cool down</b> 5 min easy</p><p className="muted">Aim for 150–160 bpm at the peak.</p></div>
                    : <div className="steps"><p><b>Speed</b> 5.5–6.5 km/h</p><p><b>Incline</b> {phase === "Foundation" ? "6%" : phase === "Build" ? "8%" : "10–12%"}</p><p><b>Duration</b> 30–45 min</p><p className="muted">Target heart rate: 113–132 bpm.</p></div>}
                </section>
                <section className="panel meal-panel"><div className="panel-heading"><span>TODAY'S FOOD</span><span className="panel-icon">♢</span></div>
                  <div className="meal"><small>BREAKFAST · {actualMeals?.breakfast ? "ACTUAL" : "PLAN"}</small><p>{actualMeals?.breakfast || breakfast[day]}</p></div>
                  <div className="meal"><small>DINNER · {actualMeals?.dinner ? "ACTUAL" : "PLAN"}</small><p>{actualMeals?.dinner || dinner[day]}</p></div>
                  {(actualMeals?.lunch || actualMeals?.snacks) && <p className="extra-meals">{actualMeals.lunch ? "Lunch: " + actualMeals.lunch : ""}{actualMeals.lunch && actualMeals.snacks ? " · " : ""}{actualMeals.snacks ? "Snacks: " + actualMeals.snacks : ""}</p>}
                  <button className="log-food-button" onClick={() => { setMealDate(state.today); setMealInput(state.meals[state.today] ?? emptyMeals()); setMealEditor(true); }}>{hasActualMeals ? "Edit what I ate" : "+ Log what I ate"}</button>
                </section>
              </div>
            </>}
            {tab === "calendar" && <>
              <div className="eyebrow">THE FULL CHALLENGE</div><h1>Calendar.</h1><p className="intro">Select a day to see its workout, meals, and logged status.</p>
              <div className="calendar-layout">
                <section className="panel calendar-panel">
                  <div className="calendar-toolbar"><button onClick={() => setCalendarMonth(isoOf(addDays(monthStart, -1)).slice(0, 7))} aria-label="Previous month">‹</button><strong>{monthStart.toLocaleDateString("en-KE", { month: "long", year: "numeric" })}</strong><button onClick={() => setCalendarMonth(isoOf(nextMonth).slice(0, 7))} aria-label="Next month">›</button></div>
                  <div className="calendar-grid">{["M", "T", "W", "T", "F", "S", "S"].map((label, i) => <span className="calendar-weekday" key={i}>{label}</span>)}
                    {calendarDates.map(date => {
                      const iso = isoOf(date); const status = workoutStatus(state, iso); const inMonth = date.getMonth() === monthStart.getMonth();
                      const workout = workoutForDate(date, state.plan);
                      return <button key={iso} className={"calendar-cell " + status + (inMonth ? "" : " other-month") + (iso === selectedDate ? " selected" : "")} onClick={() => setSelectedDate(iso)} title={pretty(iso) + " · " + status}>
                        <b>{date.getDate()}</b><small>{status === "outside" ? "" : workout.label === "Full-body strength" ? "Strength" : workout.label === "Rest day" ? "Rest" : workout.label === "Treadmill intervals" ? "Intervals" : "Treadmill"}</small>
                      </button>;
                    })}
                  </div>
                </section>
                <section className="panel calendar-detail">
                  <div className="panel-heading"><span>SELECTED DAY</span><span className={"history-status " + selectedStatus}>{selectedStatus}</span></div>
                  <h2>{selected.toLocaleDateString("en-KE", { weekday: "long", month: "long", day: "numeric" })}</h2>
                  {selectedStatus === "outside" ? <p className="calendar-copy">Outside your challenge dates.</p> : <>
                    <div className="detail-block"><small>WORKOUT · WEEK {selectedWorkout?.week}</small><strong>{selectedWorkout?.label}</strong></div>
                    <div className="detail-block"><small>BREAKFAST PLAN</small><span>{breakfast[selected.getDay()]}</span></div>
                    <div className="detail-block"><small>DINNER PLAN</small><span>{dinner[selected.getDay()]}</span></div>
                    {state.meals[selectedDate] && <div className="detail-block actual"><small>WHAT YOU ATE</small><span>{Object.entries(state.meals[selectedDate]).filter(([, value]) => value).map(([key, value]) => key + ": " + value).join(" · ")}</span></div>}
                    <div className="detail-actions">
                      {!["rest", "future"].includes(selectedStatus) && selectedDate <= state.today && selectedStatus !== "completed" && <button onClick={() => act<Snapshot>("set_workout_status", { date: selectedDate, status: "completed", reason: null }, setState)}>Mark done</button>}
                      {!["rest", "future", "skipped"].includes(selectedStatus) && selectedDate <= state.today && <button className="secondary" onClick={() => act<Snapshot>("set_workout_status", { date: selectedDate, status: "skipped", reason: "" }, setState)}>Skip</button>}
                      {["completed", "skipped"].includes(selectedStatus) && <button className="secondary" onClick={() => act<Snapshot>("set_workout_status", { date: selectedDate, status: "clear", reason: null }, setState)}>Undo status</button>}
                      {selectedDate <= state.today && <button className="secondary" onClick={() => { setMealDate(selectedDate); setMealInput(state.meals[selectedDate] ?? emptyMeals()); setMealEditor(true); }}>Log food</button>}
                    </div>
                  </>}
                </section>
              </div>
            </>}
            {tab === "meals" && <>
              <div className="eyebrow">YOUR HOUSEHOLD MENU</div><h1>Weekly meal plan.</h1><p className="intro">Breakfast and dinner follow your plan. Lunch is open—log what you actually eat.</p>
              <section className="panel meals-plan-panel">
                <div className="meal-week-toolbar"><button onClick={() => setMealWeekOffset(mealWeekOffset - 1)} aria-label="Previous week">‹</button><strong>{pretty(isoOf(mealWeekStart))} – {pretty(isoOf(addDays(mealWeekStart, 6)))}</strong><button onClick={() => setMealWeekOffset(mealWeekOffset + 1)} aria-label="Next week">›</button><button className="this-week" onClick={() => setMealWeekOffset(0)}>This week</button></div>
                <div className="meal-plan-head"><span>DAY</span><span>BREAKFAST</span><span>DINNER + PORTION NOTE</span><span>ACTUAL</span></div>
                {mealWeekDays.map(date => {
                  const iso = isoOf(date); const weekday = date.getDay(); const logged = state.meals[iso]; const canLog = iso >= state.plan.startDate && iso <= state.plan.endDate && iso <= state.today;
                  return <div className={"meal-plan-row" + (iso === state.today ? " current" : "")} key={iso}>
                    <div className="meal-day"><strong>{date.toLocaleDateString("en-KE", { weekday: "short" })}</strong><small>{pretty(iso)}</small></div>
                    <div>{breakfast[weekday]}</div>
                    <div><strong>{dinner[weekday]}</strong><small>{cutNotes[weekday]}</small></div>
                    <div className="meal-actual">{canLog ? <button onClick={() => { setMealDate(iso); setMealInput(logged ?? emptyMeals()); setMealEditor(true); }}>{logged ? "Edit log" : "+ Log food"}</button> : <span>—</span>}</div>
                  </div>;
                })}
              </section>
            </>}
            {tab === "progress" && <>
              <div className="eyebrow">YOUR JOURNEY</div><h1>Progress, week by week.</h1><p className="intro">Log your weight and waist once a week. Small changes add up.</p>
              <section className="panel log-panel"><div className="panel-heading"><span>WEIGH-IN</span><span>WEEK {week}</span></div>
                <div className="form-row"><label>Date<input type="date" min={state.plan.startDate} max={state.today < state.plan.endDate ? state.today : state.plan.endDate} value={measurementDate} onChange={e => setMeasurementDate(e.target.value)} /></label><label>Weight (kg)<input type="number" step="0.1" min="30" max="300" value={weight} onChange={e => setWeight(e.target.value)} placeholder="e.g. 96.5" /></label><label>Waist (cm)<input type="number" step="0.1" min="30" max="250" value={waist} onChange={e => setWaist(e.target.value)} placeholder="e.g. 101" /></label><button className="save-button" disabled={busy || !measurementDate} onClick={() => act<Snapshot>("save_measurement", { date: measurementDate, weight: weight ? Number(weight) : null, waist: waist ? Number(waist) : null }, setState)}>Save check-in</button></div>
              </section>
              <div className="progress-columns">
              <section className="panel timeline"><div className="panel-heading"><span>RECENT WORKOUTS</span><span>Unlogged days since {pretty(state.trackingSince)} count as missed</span></div>
                {recentDays.map(date => {
                  const iso = isoOf(date); const status = workoutStatus(state, iso);
                  if (status === "outside") return null;
                  return <div className="history-row" key={iso}><span>{date.toLocaleDateString("en-KE", { weekday: "short", month: "short", day: "numeric" })}</span><span className={"history-status " + status}>{status}</span><div className="history-actions">
                    {!["rest", "future"].includes(status) && status !== "completed" && <button disabled={busy} onClick={() => act<Snapshot>("set_workout_status", { date: iso, status: "completed", reason: null }, setState)}>Mark done</button>}
                    {!["rest", "future", "skipped"].includes(status) && <button disabled={busy} onClick={() => act<Snapshot>("set_workout_status", { date: iso, status: "skipped", reason: "" }, setState)}>Skip</button>}
                    {["completed", "skipped"].includes(status) && <button disabled={busy} onClick={() => act<Snapshot>("set_workout_status", { date: iso, status: "clear", reason: null }, setState)}>Undo</button>}
                    <button onClick={() => { setMealDate(iso); setMealInput(state.meals[iso] ?? emptyMeals()); setMealEditor(true); }}>{state.meals[iso] ? "Edit food" : "Log food"}</button>
                  </div></div>;
                })}
              </section>
              <section className="panel timeline"><div className="panel-heading"><span>WEEKLY TRACKER</span><span>{state.completed.length} workouts done</span></div>
                {dates.map((date, i) => {
                  const iso = isoOf(date); const next = addDays(date, 7); const nextIso = isoOf(next);
                  const days = Array.from({ length: 7 }, (_, n) => isoOf(addDays(date, n))).filter(d => d <= state.plan.endDate);
                  const count = days.filter(d => workoutStatus(state, d) === "completed").length;
                  const skippedCount = days.filter(d => workoutStatus(state, d) === "skipped").length;
                  const missedCount = days.filter(d => workoutStatus(state, d) === "missed").length;
                  const measure = Object.entries(state.measurements).filter(([d]) => d >= iso && d < nextIso).sort(([a], [b]) => b.localeCompare(a))[0]?.[1];
                  return <div className="week-row" key={iso}><span className="week-no">{String(i + 1).padStart(2, "0")}</span><span className="week-date">{pretty(iso)}{i === totalWeeks - 1 ? " · Goal week" : ""}</span><span className="week-count">{count} done · {skippedCount} skip · {missedCount} missed</span><span className="week-measure">{measure?.weight ? String(measure.weight) + " kg" : "—"} <i>·</i> {measure?.waist ? String(measure.waist) + " cm" : "—"}</span></div>;
                })}
              </section>
              </div>
            </>}
            {tab === "settings" && <>
              <div className="eyebrow">MAKE IT YOURS</div><h1>Shape your plan.</h1><p className="intro">Update your goal and dates as life changes. Your logged history stays saved.</p>
              {planInput && <section className="panel plan-settings"><div className="panel-heading"><span>YOUR CHALLENGE</span><span>EDITABLE</span></div>
                <div className="plan-form">
                  <label>Starting weight (kg)<input type="number" min="30" max="300" step="0.1" value={planInput.startWeight} onChange={e => setPlanInput({ ...planInput, startWeight: Number(e.target.value) })} /></label>
                  <label>Target weight (kg)<input type="number" min="30" max="300" step="0.1" value={planInput.targetWeight} onChange={e => setPlanInput({ ...planInput, targetWeight: Number(e.target.value) })} /></label>
                  <label>Start date<input type="date" value={planInput.startDate} onChange={e => setPlanInput({ ...planInput, startDate: e.target.value })} /></label>
                  <label>Goal date<input type="date" value={planInput.endDate} onChange={e => setPlanInput({ ...planInput, endDate: e.target.value })} /></label>
                </div>
                <button className="save-button" disabled={busy} onClick={() => act<Snapshot>("save_plan", { plan: planInput }, s => { setState(s); setMeasurementDate(s.today < s.plan.startDate ? s.plan.startDate : s.today > s.plan.endDate ? s.plan.endDate : s.today); })}>Save plan</button>
              </section>}
              <h2 className="settings-subhead">Daily alarm</h2>
              <section className="panel settings-panel"><div className="setting-row"><div><h3>Workout time</h3><p>Monday–Saturday, within your challenge dates.</p></div><div className="time-control"><input type="time" value={alarmInput} onChange={e => setAlarmInput(e.target.value)} aria-label="Workout alarm time" /><button disabled={busy || alarmInput === state.alarmTime} onClick={() => act<Snapshot>("set_alarm_time", { time: alarmInput }, setState)}>Save</button></div></div>
                <div className="setting-row"><div><h3>Launch at login</h3><p>Keep the app ready for your daily alarm.</p></div><button className={login ? "toggle on" : "toggle"} role="switch" aria-checked={login} aria-label="Launch at login" onClick={() => act<boolean>("launch_at_login", { enabled: !login }, setLogin)}><span /></button></div>
              </section>
              <p className="settings-note">The Mac must be awake and this app must be running. Closing the window keeps it running; use Quit to stop it. The sound follows your Mac's volume.</p>
            </>}
          </>}
        </main>
      </div>
      {mealEditor && state && <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) setMealEditor(false); }}>
        <form className="meal-modal" onSubmit={e => { e.preventDefault(); act<Snapshot>("save_meals", { date: mealDate, meals: mealInput }, s => { setState(s); setMealEditor(false); }); }}>
          <div className="modal-heading"><div><div className="eyebrow">{pretty(mealDate).toUpperCase()}</div><h2>What did you eat?</h2></div><button type="button" className="modal-close" onClick={() => setMealEditor(false)} aria-label="Close">×</button></div>
          <p>Use the menu as a guide. Log what actually happened, without changing your workout progress.</p>
          <div className="meal-fields">
            {(["breakfast", "lunch", "dinner", "snacks"] as const).map(key => <label key={key}>{key}<input value={mealInput[key]} maxLength={250} onChange={e => setMealInput({ ...mealInput, [key]: e.target.value })} placeholder={key === "breakfast" ? breakfast[dateOf(mealDate).getDay()] : key === "dinner" ? dinner[dateOf(mealDate).getDay()] : "Optional"} /></label>)}
          </div>
          <div className="modal-actions"><button type="button" className="quiet-button" onClick={() => setMealEditor(false)}>Cancel</button><button className="save-button" type="submit" disabled={busy}>Save food log</button></div>
        </form>
      </div>}
    </div>
  );
}

export default App;
