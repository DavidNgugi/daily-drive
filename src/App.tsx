import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getVersion } from "@tauri-apps/api/app";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { save } from "@tauri-apps/plugin-dialog";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import "./App.css";

type Measurement = { weight: number | null; waist: number | null };
type Plan = { startDate: string; endDate: string; startWeight: number; targetWeight: number };
type MealLog = { breakfast: string; lunch: string; dinner: string; snacks: string };
type WorkoutItem = { name: string; reps: string };
type PlannedWorkout = { title: string; details: string; items?: WorkoutItem[]; restDay: boolean };
type PlannedMeals = MealLog;
type Schedule = { workouts: PlannedWorkout[]; meals: PlannedMeals[]; workoutOverrides: Record<string, PlannedWorkout>; mealOverrides: Record<string, PlannedMeals> };
type UserProfile = { name: string; goal: string; preferences: string; equipment: string; availability: string };
type ActualWorkout = { title: string; details: string; items?: WorkoutItem[] };
type Snapshot = {
  today: string; alarmTime: string; alarmSound: string; trackingSince: string; completed: string[]; measurements: Record<string, Measurement>;
  skipped: Record<string, string>; meals: Record<string, MealLog>; actualWorkouts: Record<string, ActualWorkout>;
  plan: Plan; schedule: Schedule; profile: UserProfile | null; onboardingComplete: boolean;
  alarmActive: boolean; inPlan: boolean; restDay: boolean;
};

const dateOf = (iso: string) => { const [y, m, d] = iso.split("-").map(Number); return new Date(y, m - 1, d); };
const isoOf = (date: Date) => [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
const pretty = (iso: string) => dateOf(iso).toLocaleDateString("en-KE", { month: "short", day: "numeric" });
const addDays = (date: Date, days: number) => { const next = new Date(date); next.setDate(next.getDate() + days); return next; };
const monday = (date: Date) => addDays(date, -((date.getDay() + 6) % 7));
const dayCount = (start: string, end: string) => Math.round((dateOf(end).getTime() - dateOf(start).getTime()) / 86400000) + 1;
const emptyMeals = (): MealLog => ({ breakfast: "", lunch: "", dinner: "", snacks: "" });
const exerciseSuggestions = ["Push-ups", "Incline push-ups", "Dumbbell rows", "Goblet squats", "Bodyweight squats", "Lunges", "Reverse lunges", "Shoulder press", "Glute bridges", "Plank", "Leg raises", "Deadlift", "Bench press", "Bicep curls", "Tricep dips", "Pull-ups", "Jumping jacks", "Treadmill walk", "Outdoor walk", "Running", "Cycling", "Stretching"];
const parseWorkoutDetails = (details = ""): WorkoutItem[] => details.split(/\s*[·•,]\s*/).map(name => name.trim()).filter(Boolean).map(name => ({ name, reps: "" }));
const itemsForWorkout = (workout: Pick<PlannedWorkout, "title" | "items" | "details"> | Pick<ActualWorkout, "title" | "items" | "details">): WorkoutItem[] => {
  if (workout.items?.length) return workout.items;
  const parts = parseWorkoutDetails(workout.details);
  if (/interval/i.test(workout.title) && parts.length >= 3) return [
    { name: "Warm-up", reps: parts[0].name.replace(/^warm\s*up\s*/i, "") || "5 min" },
    { name: "Intervals", reps: parts[1].name.replace(/^(?:\d+[–-]?\d*\s+rounds?\s+of\s+)?/i, "") },
    { name: "Cool-down", reps: parts.slice(2).map(item => item.name.replace(/^cool\s*down\s*/i, "")).join(" · ") },
  ];
  if (/(treadmill|steady cardio|brisk walk)/i.test(workout.title) && workout.details.trim()) return [{ name: workout.title, reps: workout.details.trim() }];
  return parts;
};
function WorkoutExerciseRows({ items, onChange, idPrefix }: { items: WorkoutItem[]; onChange: (items: WorkoutItem[]) => void; idPrefix: string }) {
  const [dragging, setDragging] = useState<number | null>(null);
  const [dropTarget, setDropTarget] = useState<{ index: number; edge: "before" | "after" } | null>(null);
  const move = (from: number, to: number) => { if (to < 0 || to >= items.length || from === to) return; const next = [...items]; const [item] = next.splice(from, 1); next.splice(to, 0, item); onChange(next); };
  return <div className="exercise-editor" aria-label="Workout exercises">
    {items.map((item, index) => <div className={`exercise-row${dragging === index ? " dragging" : ""}${dropTarget?.index === index ? ` drop-${dropTarget.edge}` : ""}`} key={`${idPrefix}-${index}`} onDragOver={e => { e.preventDefault(); const rect = e.currentTarget.getBoundingClientRect(); setDropTarget({ index, edge: e.clientY < rect.top + rect.height / 2 ? "before" : "after" }); }} onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropTarget(current => current?.index === index ? null : current); }} onDrop={e => { e.preventDefault(); if (dragging !== null) { const insertAfter = dropTarget?.index === index && dropTarget.edge === "after"; const target = index + (insertAfter ? 1 : 0); const next = [...items]; const [moved] = next.splice(dragging, 1); const destination = Math.max(0, Math.min(next.length, target - (dragging < target ? 1 : 0))); next.splice(destination, 0, moved); onChange(next); } setDragging(null); setDropTarget(null); }}>
      <button type="button" className="drag-handle" draggable aria-label={`Reorder ${item.name || `exercise ${index + 1}`}`} title="Drag to reorder" onDragStart={e => { setDragging(index); setDropTarget(null); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", String(index)); }} onDragEnd={() => { setDragging(null); setDropTarget(null); }}>⠿</button>
      <label className="exercise-name"><span className="visually-hidden">Exercise {index + 1}</span><input list={`${idPrefix}-suggestions`} value={item.name} maxLength={100} placeholder="Search or add an exercise" onChange={e => onChange(items.map((current, i) => i === index ? { ...current, name: e.target.value } : current))} /></label>
      <label className="exercise-reps"><span className="visually-hidden">Sets, reps, or duration</span><input value={item.reps} maxLength={60} placeholder="3 × 10" onChange={e => onChange(items.map((current, i) => i === index ? { ...current, reps: e.target.value } : current))} /></label>
      <div className="exercise-row-actions"><button type="button" aria-label="Move exercise up" disabled={index === 0} onClick={() => move(index, index - 1)}>↑</button><button type="button" aria-label="Move exercise down" disabled={index === items.length - 1} onClick={() => move(index, index + 1)}>↓</button><button type="button" className="exercise-delete" aria-label={`Delete ${item.name || `exercise ${index + 1}`}`} onClick={() => onChange(items.filter((_, i) => i !== index))}>×</button></div>
    </div>)}
    <datalist id={`${idPrefix}-suggestions`}>{exerciseSuggestions.map(name => <option key={name} value={name} />)}</datalist>
    <button type="button" className="add-exercise-button" onClick={() => onChange([...items, { name: "", reps: "" }])}>＋ Add exercise</button>
  </div>;
}
function WorkoutItemList({ items, empty = "No exercises added yet." }: { items: WorkoutItem[]; empty?: string }) {
  if (!items.length) return <span className="workout-items-empty">{empty}</span>;
  return <ul className="workout-item-list">{items.map((item, i) => <li key={`${item.name}-${i}`}><span>{item.name}</span>{item.reps && <small>{item.reps}</small>}</li>)}</ul>;
}
const starterSchedule = (): Schedule => ({
  workouts: [
    { title: "Rest & recharge", details: "", items: [], restDay: true },
    { title: "Full-body strength", details: "", items: [{ name: "Push-ups", reps: "3 × 8–12" }, { name: "Dumbbell rows", reps: "3 × 10 each side" }, { name: "Goblet squats", reps: "3 × 10–12" }, { name: "Lunges", reps: "3 × 10 each side" }, { name: "Shoulder press", reps: "3 × 10" }, { name: "Glute bridges", reps: "3 × 12" }, { name: "Plank", reps: "3 × 30 sec" }, { name: "Leg raises", reps: "3 × 10" }], restDay: false },
    { title: "Incline treadmill", details: "", items: [{ name: "Incline treadmill", reps: "30–45 min · 5.5–6.5 km/h · 6% incline" }], restDay: false },
    { title: "Full-body strength", details: "", items: [{ name: "Push-ups", reps: "3 × 8–12" }, { name: "Dumbbell rows", reps: "3 × 10 each side" }, { name: "Goblet squats", reps: "3 × 10–12" }, { name: "Lunges", reps: "3 × 10 each side" }, { name: "Shoulder press", reps: "3 × 10" }, { name: "Glute bridges", reps: "3 × 12" }, { name: "Plank", reps: "3 × 30 sec" }, { name: "Leg raises", reps: "3 × 10" }], restDay: false },
    { title: "Incline treadmill", details: "", items: [{ name: "Incline treadmill", reps: "30–45 min · 5.5–6.5 km/h · 6% incline" }], restDay: false },
    { title: "Full-body strength", details: "", items: [{ name: "Push-ups", reps: "3 × 8–12" }, { name: "Dumbbell rows", reps: "3 × 10 each side" }, { name: "Goblet squats", reps: "3 × 10–12" }, { name: "Lunges", reps: "3 × 10 each side" }, { name: "Shoulder press", reps: "3 × 10" }, { name: "Glute bridges", reps: "3 × 12" }, { name: "Plank", reps: "3 × 30 sec" }, { name: "Leg raises", reps: "3 × 10" }], restDay: false },
    { title: "Treadmill intervals", details: "", items: [{ name: "Warm-up walk", reps: "5 min" }, { name: "Brisk / easy intervals", reps: "6–8 rounds · 1 min brisk / 2 min easy" }, { name: "Cool-down walk", reps: "5 min" }], restDay: false },
  ],
  meals: [
    { breakfast: "2 hard-boiled eggs + arrowroot", lunch: "", dinner: "Leftovers, or a smaller portion of roast potatoes + pork / chicken alfredo", snacks: "" },
    { breakfast: "2 hard-boiled eggs + sweet potato or arrowroot", lunch: "", dinner: "Ugali + greens + fish or matumbo · aim for about 1 cup ugali", snacks: "" },
    { breakfast: "2 hard-boiled eggs + arrowroot", lunch: "", dinner: "Rice + ndengu or beans · aim for about 1 cup rice", snacks: "" },
    { breakfast: "Tea + bread toast", lunch: "", dinner: "Ugali + greens + avocado · go light on oil", snacks: "" },
    { breakfast: "2 hard-boiled eggs + sweet potato", lunch: "", dinner: "Matoke + chicken stew, or rice + beans", snacks: "" },
    { breakfast: "2 hard-boiled eggs + arrowroot", lunch: "", dinner: "Pilau or mokimo + stew · moderate portion, extra vegetables", snacks: "" },
    { breakfast: "Tea + bread + egg + nduma", lunch: "", dinner: "1 chapati + beans or ndengu", snacks: "" },
  ], workoutOverrides: {}, mealOverrides: {},
});
function workoutForDate(date: Date, plan: Plan, schedule: Schedule) {
  const totalWeeks = Math.ceil(dayCount(plan.startDate, plan.endDate) / 7);
  const week = Math.max(1, Math.min(totalWeeks, Math.floor((date.getTime() - dateOf(plan.startDate).getTime()) / 604800000) + 1));
  const item = schedule.workoutOverrides[isoOf(date)] ?? schedule.workouts[date.getDay()] ?? starterSchedule().workouts[date.getDay()];
  return { week, ...item, label: item.restDay ? "Rest day" : item.title };
}
type WorkoutStatus = "completed" | "skipped" | "missed" | "untracked" | "pending" | "rest" | "future" | "outside" | "inactive";
function workoutStatus(state: Snapshot, iso: string): WorkoutStatus {
  if (iso < state.plan.startDate || iso > state.plan.endDate) return "outside";
  if (state.completed.includes(iso)) return "completed";
  if (Object.prototype.hasOwnProperty.call(state.skipped, iso)) return "skipped";
  if (workoutForDate(dateOf(iso), state.plan, state.schedule).restDay) return "rest";
  if (iso < state.trackingSince) return "untracked";
  if (iso < state.today) return "missed";
  return iso === state.today ? "pending" : "future";
}
function mealsForDate(date: Date, schedule: Schedule): PlannedMeals {
  return schedule.mealOverrides[isoOf(date)] ?? schedule.meals[date.getDay()] ?? emptyMeals();
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
    .filter(date => workoutStatus(state, date) !== "rest");
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

const weekdayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const isMacOS = typeof navigator !== "undefined" && /Mac/.test(navigator.userAgent);
const alarmSoundChoices = isMacOS ? ["Basso", "Blow", "Bottle", "Frog", "Funk", "Glass", "Hero", "Morse", "Ping", "Pop", "Purr", "Sosumi", "Submarine", "Tink"] : ["System alert"];

function SetupWizard({ initialPlan, onFinish, saving, error }: { initialPlan: Plan; onFinish: (profile: UserProfile, plan: Plan, schedule: Schedule) => void; saving: boolean; error: string }) {
  const [step, setStep] = useState(0);
  const [profile, setProfile] = useState<UserProfile>({ name: "", goal: "Build a consistent fitness routine", preferences: "", equipment: "", availability: "1,2,3,4,5,6" });
  const [plan, setPlan] = useState<Plan>(() => ({ ...initialPlan, startDate: isoOf(new Date()), endDate: isoOf(addDays(new Date(), 89)), startWeight: 0, targetWeight: 0 }));
  const [schedule, setSchedule] = useState<Schedule>(starterSchedule);
  const [suggestionsApplied, setSuggestionsApplied] = useState(false);
  const steps = ["You", "Timeline", "Preferences", "Workouts", "Meals", "Review"];
  const datesChanged = (days: number) => setPlan(p => ({ ...p, startDate: isoOf(new Date()), endDate: isoOf(addDays(new Date(), days - 1)) }));
  function changeWorkout(index: number, update: Partial<PlannedWorkout>) {
    setSchedule(s => ({ ...s, workouts: s.workouts.map((w, i) => i === index ? { ...w, ...update } : w) }));
  }
  function changeMeal(index: number, field: keyof PlannedMeals, value: string) {
    setSchedule(s => ({ ...s, meals: s.meals.map((m, i) => i === index ? { ...m, [field]: value } : m) }));
  }
  function tailorSuggestions() {
    const available = new Set(profile.availability.split(",").filter(Boolean).map(Number));
    const noTreadmill = !/treadmill/i.test(profile.equipment);
    const noWeights = !/dumbbell|weight|gym/i.test(profile.equipment);
    const goal = profile.goal.toLowerCase();
    let workouts = schedule.workouts.map((w, i) => {
      if (!available.has(i)) return { title: "Rest day", details: "Take the day off and recover.", items: [], restDay: true };
      if (w.restDay) return { title: "Full-body strength", details: "", items: [{ name: "Bodyweight squats", reps: "3 × 12" }, { name: "Push-ups", reps: "3 × 10" }, { name: "Glute bridges", reps: "3 × 12" }, { name: "Plank", reps: "3 × 30 sec" }], restDay: false };
      if (/mobility|flexibility|stretch/.test(goal)) return { title: "Mobility & movement", details: "", items: [{ name: "Stretching", reps: "15 min" }], restDay: false };
      if (/run|running|endurance|cardio/.test(goal) && /treadmill|incline/i.test(w.title)) return { title: "Steady cardio", details: "", items: [{ name: "Outdoor walk", reps: "30–45 min" }], restDay: false };
      if (noTreadmill && /treadmill/i.test(w.title)) return { title: "Brisk walk", details: "", items: [{ name: "Outdoor walk", reps: "30–45 min" }], restDay: false };
      if (noWeights && /strength/i.test(w.title)) return { ...w, details: "", items: [{ name: "Bodyweight squats", reps: "3 × 12" }, { name: "Incline push-ups", reps: "3 × 10" }, { name: "Glute bridges", reps: "3 × 12" }, { name: "Reverse lunges", reps: "3 × 10 each" }, { name: "Plank", reps: "3 × 30 sec" }] };
      return w;
    });
    if (!available.size) workouts = starterSchedule().workouts;
    const preferences = profile.preferences.toLowerCase();
    const meals = /vegan/.test(preferences)
      ? schedule.meals.map(m => ({ ...m, breakfast: /egg/i.test(m.breakfast) ? "Oats with fruit" : m.breakfast, dinner: /fish|chicken|pork|matumbo/i.test(m.dinner) ? "Beans or ndengu with greens and ugali or rice" : m.dinner }))
      : /vegetarian|no meat|no fish/.test(preferences)
        ? schedule.meals.map(m => ({ ...m, dinner: /fish|chicken|pork|matumbo/i.test(m.dinner) ? "Beans or ndengu with greens and ugali or rice" : m.dinner }))
        : schedule.meals;
    setSchedule(s => ({ ...s, workouts, meals }));
    setSuggestionsApplied(true);
  }
  const durations = [{ label: "1 month", days: 30 }, { label: "3 months", days: 90 }, { label: "6 months", days: 180 }, { label: "1 year", days: 365 }];
  function next() {
    if (step === 0 && (!profile.name.trim() || !profile.goal.trim() || !(plan.startWeight >= 30 && plan.startWeight <= 300) || !(plan.targetWeight >= 30 && plan.targetWeight <= 300))) return;
    if (step === 1 && (plan.endDate < plan.startDate || dayCount(plan.startDate, plan.endDate) > 366)) return;
    if (step === 2 && !suggestionsApplied) tailorSuggestions();
    setStep(s => Math.min(steps.length - 1, s + 1));
  }
  return <div className="setup-shell">
    <div className="setup-orbit orbit-one" /><div className="setup-orbit orbit-two" />
    <header className="setup-brand"><div className="brand"><div className="brand-mark">D</div><span>DAILY DRIVE</span></div><span>YOUR PLAN, YOUR PACE</span></header>
    <section className="setup-card" aria-live="polite">
      <div className="setup-progress"><div className="setup-step-label"><span>LET'S SET YOU UP</span><b>{String(step + 1).padStart(2, "0")} <i>/</i> {String(steps.length).padStart(2, "0")}</b></div><div className="setup-progress-track"><span style={{ width: `${(step + 1) / steps.length * 100}%` }} /></div><div className="setup-step-names">{steps.map((name, i) => <span className={i === step ? "current" : i < step ? "passed" : ""} key={name}>{name}</span>)}</div></div>
      <div className="setup-content" key={step}>
        {step === 0 && <>
          <div className="eyebrow">A GOOD PLACE TO BEGIN</div><h1>Let’s make this yours.</h1><p className="intro">A few details help shape a plan that fits your life.</p>
          <div className="setup-fields"><label>Your name<input autoFocus value={profile.name} onChange={e => setProfile({ ...profile, name: e.target.value })} placeholder="What should we call you?" maxLength={80} /></label><label>What would you like to achieve?<textarea value={profile.goal} onChange={e => setProfile({ ...profile, goal: e.target.value })} maxLength={240} placeholder="Build strength, feel fitter, lose weight…" /></label><div className="setup-field-pair"><label>Current weight (kg)<input type="number" min="30" max="300" step="0.1" value={plan.startWeight || ""} onChange={e => setPlan({ ...plan, startWeight: Number(e.target.value) })} placeholder="e.g. 82" /></label><label>Target weight (kg)<input type="number" min="30" max="300" step="0.1" value={plan.targetWeight || ""} onChange={e => setPlan({ ...plan, targetWeight: Number(e.target.value) })} placeholder="e.g. 75" /></label></div></div>
        </>}
        {step === 1 && <>
          <div className="eyebrow">A TIMELINE THAT WORKS FOR YOU</div><h1>Choose your runway.</h1><p className="intro">You can change your dates any time.</p>
          <div className="duration-grid">{durations.map(item => <button type="button" className={dayCount(plan.startDate, plan.endDate) >= item.days - 1 && dayCount(plan.startDate, plan.endDate) <= item.days + 1 ? "duration-option selected" : "duration-option"} key={item.label} onClick={() => datesChanged(item.days)}><strong>{item.label}</strong><small>{item.days} days</small></button>)}</div>
          <div className="setup-field-pair dates-pair"><label>Start date<input type="date" value={plan.startDate} onChange={e => setPlan({ ...plan, startDate: e.target.value })} /></label><label>End date<input type="date" value={plan.endDate} onChange={e => setPlan({ ...plan, endDate: e.target.value })} /></label></div>
        </>}
        {step === 2 && <>
          <div className="eyebrow">MAKE THE SUGGESTIONS FIT</div><h1>Your real-world details.</h1><p className="intro">Your workout days are selected. Equipment and food preferences are optional.</p>
          <div className="setup-fields"><fieldset className="availability-picker"><legend>Which days usually work for a workout?</legend><div>{weekdayNames.map((name, i) => { const selected = profile.availability.split(",").includes(String(i)); return <button type="button" aria-pressed={selected} className={selected ? "selected" : ""} key={name} onClick={() => { const days = new Set(profile.availability.split(",").filter(Boolean)); if (selected) days.delete(String(i)); else days.add(String(i)); setProfile({ ...profile, availability: [...days].sort((a, b) => Number(a) - Number(b)).join(",") }); }}>{name.slice(0, 3)}</button>; })}</div></fieldset><label>What equipment can you use?<textarea value={profile.equipment} onChange={e => setProfile({ ...profile, equipment: e.target.value })} maxLength={250} placeholder="Dumbbells, treadmill, a nearby park…" /></label><label>Food preferences or restrictions<textarea value={profile.preferences} onChange={e => setProfile({ ...profile, preferences: e.target.value })} maxLength={500} placeholder="Vegetarian, foods to avoid, meals you enjoy…" /></label><div className="availability-note"><span>✳</span><p>We’ll tailor an editable first week to your selected days and preferences.</p></div></div>
        </>}
        {step === 3 && <>
          <div className="eyebrow">YOUR WEEKLY RHYTHM</div><h1>Shape your workouts.</h1><p className="intro">A suggested starting week, ready for you to change.</p>
          <div className="setup-plan-list">{weekdayNames.map((name, i) => { const workout = schedule.workouts[i]; return <article className="setup-plan-row" key={name}><div className="setup-day-label"><span>{name.slice(0, 3).toUpperCase()}</span><small>{i === new Date().getDay() ? "TODAY" : ""}</small></div><div className="setup-plan-inputs"><input aria-label={`${name} workout name`} value={workout?.title ?? ""} disabled={workout?.restDay} onChange={e => changeWorkout(i, { title: e.target.value })} placeholder="Workout name" maxLength={80} /><label className="rest-toggle"><input type="checkbox" checked={workout?.restDay ?? false} onChange={e => changeWorkout(i, { restDay: e.target.checked, title: e.target.checked ? "Rest day" : "New workout", items: e.target.checked || workout?.restDay ? [] : itemsForWorkout(workout ?? starterSchedule().workouts[i]), details: "" })} /><span>Rest</span></label>{!workout?.restDay && <details className="exercise-accordion" open={i === new Date().getDay()}><summary>Exercises · {itemsForWorkout(workout ?? starterSchedule().workouts[i]).length}</summary><WorkoutExerciseRows items={itemsForWorkout(workout ?? starterSchedule().workouts[i])} idPrefix={`setup-${i}`} onChange={items => changeWorkout(i, { items, details: "" })} /></details>}</div></article>; })}</div>
        </>}
        {step === 4 && <>
          <div className="eyebrow">A MENU THAT FEELS LIKE YOURS</div><h1>Plan your meals.</h1><p className="intro">Add the meals you want to plan. Leave anything open.</p>
          <div className="setup-meal-grid">{weekdayNames.map((name, i) => <div className="setup-meal-day" key={name}><span>{name}</span>{(["breakfast", "lunch", "dinner", "snacks"] as const).map(field => <label key={field}>{field}<input value={schedule.meals[i]?.[field] ?? ""} maxLength={250} onChange={e => changeMeal(i, field, e.target.value)} placeholder={field === "lunch" || field === "snacks" ? "Optional" : `Add ${field}`} /></label>)}</div>)}</div>
        </>}
        {step === 5 && <>
          <div className="eyebrow">READY WHEN YOU ARE</div><h1>Your first week.</h1><p className="intro">Everything is editable later from your Plan.</p>
          <div className="setup-review"><div className="review-profile"><span className="review-avatar">{profile.name.trim().charAt(0).toUpperCase() || "D"}</span><div><strong>{profile.name}</strong><small>{profile.goal}</small></div></div><div className="review-dates"><span>CHALLENGE</span><strong>{pretty(plan.startDate)} – {pretty(plan.endDate)}</strong><small>{dayCount(plan.startDate, plan.endDate)} days · {plan.startWeight} → {plan.targetWeight} kg</small></div><div className="review-schedule"><div><span>WORKOUTS</span><b>{schedule.workouts.filter(w => !w.restDay).length} training days each week</b></div><div><span>MEALS</span><b>{schedule.meals.reduce((n, m) => n + [m.breakfast, m.lunch, m.dinner, m.snacks].filter(Boolean).length, 0)} planned meal entries</b></div></div></div>
        </>}
        {error && <div className="error setup-error" role="alert">{error}</div>}
      </div>
      <footer className="setup-footer"><span>{step < 5 ? "YOUR PLAN CAN EVOLVE WITH YOU" : "YOU CAN CHANGE ANYTHING LATER"}</span><div>{step > 0 && <button className="setup-back" disabled={saving} onClick={() => setStep(s => Math.max(0, s - 1))}>Back</button>}{step < 5 ? <button className="setup-next" onClick={next} disabled={(step === 0 && (!profile.name.trim() || !profile.goal.trim() || !(plan.startWeight >= 30 && plan.startWeight <= 300) || !(plan.targetWeight >= 30 && plan.targetWeight <= 300))) || (step === 1 && (!plan.startDate || !plan.endDate || plan.endDate < plan.startDate || dayCount(plan.startDate, plan.endDate) > 366))}>Continue <span>→</span></button> : <button className="setup-next" disabled={saving} onClick={() => onFinish(profile, plan, schedule)}>{saving ? "Saving…" : "Start my plan"} <span>→</span></button>}</div></footer>
    </section><p className="setup-footnote">A steady rhythm, built around you.</p>
  </div>;
}

function App() {
  const [theme, setTheme] = useState<"dark" | "system">(() => {
    try { return localStorage.getItem("daily-drive-theme") === "dark" ? "dark" : "system"; }
    catch { return "system"; }
  });
  const [systemDark, setSystemDark] = useState(() => window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false);
  const [state, setState] = useState<Snapshot | null>(null);
  const [tab, setTab] = useState<"today" | "calendar" | "plan" | "meals" | "progress" | "settings">("today");
  const [alarmInput, setAlarmInput] = useState("07:00");
  const [alarmSoundInput, setAlarmSoundInput] = useState(alarmSoundChoices[0]);
  const [login, setLogin] = useState(false);
  const [weight, setWeight] = useState("");
  const [waist, setWaist] = useState("");
  const [measurementDate, setMeasurementDate] = useState("");
  const [planInput, setPlanInput] = useState<Plan | null>(null);
  const [scheduleInput, setScheduleInput] = useState<Schedule>(starterSchedule);
  const [planEditorSection, setPlanEditorSection] = useState<"workouts" | "meals" | "dates">("workouts");
  const [planDateInput, setPlanDateInput] = useState("");
  const [workoutEditorDate, setWorkoutEditorDate] = useState("");
  const [workoutEditorInput, setWorkoutEditorInput] = useState<ActualWorkout>({ title: "", details: "", items: [] });
  const [workoutEditorOpen, setWorkoutEditorOpen] = useState(false);
  const [mealInput, setMealInput] = useState<MealLog>(emptyMeals());
  const [mealEditor, setMealEditor] = useState(false);
  const [mealDate, setMealDate] = useState("");
  const [skipEditor, setSkipEditor] = useState(false);
  const [skipReason, setSkipReason] = useState("");
  const [calendarMonth, setCalendarMonth] = useState("2026-09");
  const [selectedDate, setSelectedDate] = useState("2026-09-24");
  const [mealWeekOffset, setMealWeekOffset] = useState(0);
  const [error, setError] = useState("");
  const [profileName, setProfileName] = useState("");
  const [toast, setToast] = useState<{ kind: "success" | "error"; message: string; id: number } | null>(null);
  const toastId = useRef(0);
  const notify = (kind: "success" | "error", message: string) => setToast({ kind, message, id: ++toastId.current });
  const [appVersion, setAppVersion] = useState("0.1.0");
  const [releaseStatus, setReleaseStatus] = useState("");
  const [checkingRelease, setCheckingRelease] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportStage, setExportStage] = useState("");
  const [exportMessage, setExportMessage] = useState("");
  const [exportPath, setExportPath] = useState("");
  const [busy, setBusy] = useState(false);
  const notificationSentFor = useRef("");
  const importFileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (toast) { const id = window.setTimeout(() => setToast(current => current?.id === toast.id ? null : current), 3800); return () => window.clearTimeout(id); } }, [toast]);
  useEffect(() => {
    if (!mealEditor && !workoutEditorOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") { setMealEditor(false); setWorkoutEditorOpen(false); } };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [mealEditor, workoutEditorOpen]);

  useEffect(() => {
    getVersion().then(setAppVersion).catch(() => {});
    try { localStorage.setItem("daily-drive-theme", theme); } catch { /* Keep the current session usable if storage is unavailable. */ }
  }, [theme]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setSystemDark(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  async function checkForUpdates() {
    setCheckingRelease(true);
    setReleaseStatus("");
    try {
      const update = await check();
      if (!update) { setReleaseStatus(`You're up to date · v${appVersion}`); notify("success", "Daily Drive is up to date"); }
      else {
        setReleaseStatus(`Downloading version ${update.version}…`);
        await update.downloadAndInstall();
        setReleaseStatus("Update installed. Restarting Daily Drive…");
        notify("success", "Update installed. Restarting…");
        await relaunch();
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : "Could not check for updates. Try again later.";
      setReleaseStatus(message); notify("error", message);
    } finally {
      setCheckingRelease(false);
    }
  }

  useEffect(() => {
    document.documentElement.classList.toggle("dark-theme", theme === "dark" || (theme === "system" && systemDark));
  }, [theme, systemDark]);

  useEffect(() => {
    invoke<Snapshot>("get_state").then(s => { setState(s); setProfileName(s.profile?.name ?? ""); setAlarmInput(s.alarmTime); setAlarmSoundInput(alarmSoundChoices.includes(s.alarmSound) ? s.alarmSound : alarmSoundChoices[0]); setPlanInput(s.plan); setScheduleInput(s.schedule); setMealDate(s.today); setPlanDateInput(s.today); setMeasurementDate(s.today); setSelectedDate(s.today); setCalendarMonth(s.today.slice(0, 7)); }).catch(e => { setError(String(e)); notify("error", String(e)); });
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
  const start = state ? dateOf(state.plan.startDate) : new Date(2026, 8, 7);
  const totalWeeks = state ? Math.ceil(dayCount(state.plan.startDate, state.plan.endDate) / 7) : 12;
  const week = Math.max(1, Math.min(totalWeeks, Math.floor((today.getTime() - start.getTime()) / 604800000) + 1));
  const done = !!state?.completed.includes(state.today);
  const skipped = !!state && Object.prototype.hasOwnProperty.call(state.skipped, state.today);
  const todayWorkout = state ? workoutForDate(today, state.plan, state.schedule) : null;
  const todayMeals = state ? mealsForDate(today, state.schedule) : emptyMeals();
  const logged = useMemo(() => state?.measurements[measurementDate], [state, measurementDate]);

  useEffect(() => { setWeight(logged?.weight?.toString() ?? ""); setWaist(logged?.waist?.toString() ?? ""); }, [logged?.weight, logged?.waist]);
  useEffect(() => { if (state && !mealEditor) setMealInput(state.meals[mealDate || state.today] ?? emptyMeals()); }, [state?.today, state?.meals, mealDate, mealEditor]);
  useEffect(() => { if (state) { setPlanInput(state.plan); setScheduleInput(state.schedule); } }, [state?.plan, state?.schedule]);
  useEffect(() => { if (state) setAlarmSoundInput(alarmSoundChoices.includes(state.alarmSound) ? state.alarmSound : alarmSoundChoices[0]); }, [state?.alarmSound]);

  async function act<T>(command: string, args?: Record<string, unknown>, after?: (value: T) => void, successMessage?: string) {
    setBusy(true); setError("");
    try { const value = await invoke<T>(command, args); after?.(value); notify("success", successMessage ?? ({ save_schedule: "Workout and meal plan saved", save_actual_workout: "Workout log saved", save_profile: "Your name has been updated", save_plan: "Goal saved", save_measurement: "Check-in saved", save_meals: "Food log saved", set_alarm_time: "Alarm time saved", set_alarm_sound: "Alarm sound saved", complete_today: "Workout marked complete", set_workout_status: "Workout status updated", finish_setup: "Your plan is ready", import_data: "Your data was imported", snooze_alarm: "Alarm snoozed", launch_at_login: "Startup preference saved", preview_alarm_sound: "Alarm preview started" } as Record<string, string>)[command] ?? "Saved successfully"); }
    catch (e) { const message = String(e); setError(message); notify("error", message); }
    finally { setBusy(false); }
  }

  function updateWeeklyWorkout(index: number, update: Partial<PlannedWorkout>) {
    setScheduleInput(s => ({ ...s, workouts: s.workouts.map((w, i) => i === index ? { ...w, ...update } : w) }));
  }
  function updateWeeklyMeal(index: number, field: keyof PlannedMeals, value: string) {
    setScheduleInput(s => ({ ...s, meals: s.meals.map((m, i) => i === index ? { ...m, [field]: value } : m) }));
  }
  function saveDatePlan() {
    if (!planDateInput) return;
    const workout = workoutForDate(dateOf(planDateInput), state!.plan, scheduleInput);
    const meals = mealsForDate(dateOf(planDateInput), scheduleInput);
    const next: Schedule = { ...scheduleInput, workoutOverrides: { ...scheduleInput.workoutOverrides, [planDateInput]: { title: workout.title, details: workout.details, items: itemsForWorkout(workout), restDay: workout.restDay } }, mealOverrides: { ...scheduleInput.mealOverrides, [planDateInput]: meals } };
    act<Snapshot>("save_schedule", { schedule: next }, s => { setState(s); setScheduleInput(s.schedule); });
  }
  function clearDatePlan() {
    const workoutOverrides = { ...scheduleInput.workoutOverrides }; delete workoutOverrides[planDateInput];
    const mealOverrides = { ...scheduleInput.mealOverrides }; delete mealOverrides[planDateInput];
    const next = { ...scheduleInput, workoutOverrides, mealOverrides };
    act<Snapshot>("save_schedule", { schedule: next }, s => { setState(s); setScheduleInput(s.schedule); });
  }
  function applyScheduleToRemaining(kind: "workouts" | "meals") {
    const schedule = { ...scheduleInput };
    if (kind === "workouts") schedule.workoutOverrides = Object.fromEntries(Object.entries(schedule.workoutOverrides).filter(([date]) => date < (state?.today ?? "")));
    else schedule.mealOverrides = Object.fromEntries(Object.entries(schedule.mealOverrides).filter(([date]) => date < (state?.today ?? "")));
    act<Snapshot>("save_schedule", { schedule }, s => { setState(s); setScheduleInput(s.schedule); });
  }
  function changeDateWorkout(update: Partial<PlannedWorkout>) {
    if (!planDateInput || !state) return;
    const current = workoutForDate(dateOf(planDateInput), state.plan, scheduleInput);
    setScheduleInput(s => ({ ...s, workoutOverrides: { ...s.workoutOverrides, [planDateInput]: { title: current.title, details: current.details, items: itemsForWorkout(current), restDay: current.restDay, ...update } } }));
  }
  function changeDateMeal(field: keyof PlannedMeals, value: string) {
    if (!planDateInput) return;
    const current = mealsForDate(dateOf(planDateInput), scheduleInput);
    setScheduleInput(s => ({ ...s, mealOverrides: { ...s.mealOverrides, [planDateInput]: { ...current, [field]: value } } }));
  }
  function saveSetup(profile: UserProfile, plan: Plan, schedule: Schedule) {
    act<Snapshot>("finish_setup", { profile, plan, schedule }, s => { setState(s); setScheduleInput(s.schedule); setPlanInput(s.plan); setTab("today"); });
  }

  async function exportData() {
    setError("");
    setExportMessage("");
    setExportPath("");
    setExporting(true);
    setExportStage("Choose a save location…");
    try {
      const path = await save({
        defaultPath: `daily-drive-${new Date().toISOString().slice(0, 10)}.json`,
        filters: [{ name: "Daily Drive backup", extensions: ["json"] }],
      });
      if (!path) return;
      setExportStage("Saving your backup…");
      const contents = await invoke<string>("export_data");
      await invoke("write_export_file", { path, contents });
      setExportPath(path);
      notify("success", "Your backup was exported");
      setExportMessage("Export complete. Opening the saved file location…");
      try {
        await invoke("reveal_export_file", { path });
        setExportMessage("Export complete. The saved file is selected.");
      } catch (e) {
        console.warn("Export saved but Finder could not reveal it", e);
        setExportMessage(`Export saved, but the file location could not open: ${String(e)}`); notify("error", `Export saved, but the file location could not open: ${String(e)}`);
      }
      try {
        let permitted = await isPermissionGranted();
        if (!permitted) permitted = (await requestPermission()) === "granted";
        if (permitted) sendNotification({ title: "Daily Drive backup saved", body: path.split(/[\\/]/).pop() ?? path });
      } catch (e) { console.warn("Could not send export notification", e); }
    } catch (e) { setError(String(e)); notify("error", String(e)); }
    finally {
      setExporting(false);
      setExportStage("");
    }
  }

  async function showExportInFinder(path: string) {
    try { await invoke("reveal_export_file", { path }); notify("success", "Opened the export location"); }
    catch (e) {
      console.warn("Could not open the export location", e);
      setExportMessage(`Export saved, but the file location could not open: ${String(e)}`); notify("error", `Export saved, but the file location could not open: ${String(e)}`);
    }
  }

  async function importData(file?: File) {
    if (!file) return;
    setBusy(true); setError("");
    try {
      const contents = await file.text();
      const imported = await invoke<Snapshot>("import_data", { contents });
      setState(imported);
      setAlarmInput(imported.alarmTime);
      setAlarmSoundInput(alarmSoundChoices.includes(imported.alarmSound) ? imported.alarmSound : alarmSoundChoices[0]);
      setPlanInput(imported.plan);
      setScheduleInput(imported.schedule);
      setMeasurementDate(imported.today);
      setMealDate(imported.today);
      setProfileName(imported.profile?.name ?? "");
      notify("success", "Your data was imported");
    } catch (e) { setError(String(e)); notify("error", String(e)); }
    finally {
      setBusy(false);
      if (importFileRef.current) importFileRef.current.value = "";
    }
  }

  const dates = Array.from({ length: totalWeeks }, (_, i) => addDays(start, i * 7));
  const recentDays = Array.from({ length: Math.min(7, Math.max(0, dayCount(state?.plan.startDate ?? "2026-09-24", state?.today ?? "2026-09-24"))) }, (_, i) => addDays(today, -i));
  const actualMeals = state?.meals[state.today];
  const hasActualMeals = !!actualMeals && Object.values(actualMeals).some(Boolean);
  const selected = dateOf(selectedDate);
  const selectedStatus = state ? workoutStatus(state, selectedDate) : "outside";
  const selectedWorkout = state ? workoutForDate(selected, state.plan, state.schedule) : null;
  const selectedMeals = state ? mealsForDate(selected, state.schedule) : emptyMeals();
  const dateWorkout = state && planDateInput ? workoutForDate(dateOf(planDateInput), state.plan, scheduleInput) : null;
  const dateMeals = state && planDateInput ? mealsForDate(dateOf(planDateInput), scheduleInput) : emptyMeals();
  const monthStart = dateOf(calendarMonth + "-01");
  const calendarStart = monday(monthStart);
  const nextMonth = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 1);
  const gridCount = ((monthStart.getDay() + 6) % 7) + new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0).getDate() > 35 ? 42 : 35;
  const calendarDates = Array.from({ length: gridCount }, (_, i) => addDays(calendarStart, i));
  const mealWeekStart = addDays(monday(today), mealWeekOffset * 7);
  const mealWeekDays = Array.from({ length: 7 }, (_, i) => addDays(mealWeekStart, i));

  if (state && !state.onboardingComplete) return <SetupWizard initialPlan={state.plan} onFinish={saveSetup} saving={busy} error={error} />;

  return (
    <div className={state?.alarmActive ? "app alarm-on" : "app"}>
      {toast && <div key={toast.id} className={`toast-notice ${toast.kind}`} role={toast.kind === "error" ? "alert" : "status"} aria-live={toast.kind === "error" ? "assertive" : "polite"}><span className="toast-mark">{toast.kind === "success" ? "✓" : "!"}</span><span>{toast.message}</span><button onClick={() => setToast(null)} aria-label="Dismiss notification">×</button></div>}
      <header className="topbar">
        <div className="brand"><div className="brand-mark">D</div><span>DAILY DRIVE</span></div>
        <div className="top-right"><span className="anniversary">GOAL · {state ? pretty(state.plan.endDate).toUpperCase() : "NOV 28"}</span><span className="date-pill">{state ? today.toLocaleDateString("en-KE", { weekday: "short", month: "short", day: "numeric" }) : "Loading…"}</span></div>
      </header>
      <div className="shell">
        <aside className="sidebar">
          <div className="side-label">YOUR PLAN</div>
          <button className={tab === "today" ? "nav active" : "nav"} onClick={() => setTab("today")}><span>◉</span> Today</button>
          <button className={tab === "calendar" ? "nav active" : "nav"} onClick={() => setTab("calendar")}><span>▦</span> Calendar</button>
          <button className={tab === "plan" ? "nav active" : "nav"} onClick={() => setTab("plan")}><span>✳</span> Plan</button>
          <button className={tab === "meals" ? "nav active" : "nav"} onClick={() => setTab("meals")}><span>♢</span> Meal plan</button>
          <button className={tab === "progress" ? "nav active" : "nav"} onClick={() => setTab("progress")}><span>▥</span> Progress</button>
          <button className={tab === "settings" ? "nav active" : "nav"} onClick={() => setTab("settings")}><span>⚙</span> Settings</button>
          <div className="side-bottom"><div className="mini-label">THE GOAL</div><div className="goal-numbers">{state?.plan.startWeight ?? 99} <span>→</span> {state?.plan.targetWeight ?? 90} <small>kg</small></div><p>{totalWeeks} weeks, one day at a time.</p></div>
        </aside>
        <main className={`content ${tab}-view`}>
          {!state ? <div className="loading">Loading your plan…</div> : <>
            {state.alarmActive && <div className="alarm-banner"><span className="alarm-dot" /> IT'S WORKOUT TIME <span className="alarm-sub">The alarm keeps sounding until you complete today's session.</span><button className="snooze-button" disabled={busy} onClick={() => act<Snapshot>("snooze_alarm", {}, setState)}>Snooze 10 min</button></div>}
            {tab === "today" && <>
              <div className="eyebrow">WEEK {week} OF {totalWeeks} <span>·</span> YOUR RHYTHM</div>
              <h1>{done ? "You showed up today." : skipped ? "Tomorrow is another chance." : state.restDay ? "Rest is part of the plan." : "Let's get moving."}</h1>
              <p className="intro">{state.profile?.name ? `${state.profile.name}, ` : ""}{state.inPlan ? "your daily check-in for the challenge." : "Your plan runs " + pretty(state.plan.startDate) + " – " + pretty(state.plan.endDate) + "."}</p>
              <div className="charts-row"><CircularProgress state={state} /><WeightChart state={state} onLog={() => setTab("progress")} /></div>
              <WorkoutHeatmap state={state} />
              <div className="hero-card">
                <div className="hero-top"><span className="section-kicker">TODAY'S WORKOUT</span><div className="hero-tools"><span className={done ? "status done" : "status"}>{done ? "✓ Completed" : skipped ? "↷ Skipped" : state.restDay ? "Rest day" : "● To do"}</span>{state.inPlan && <button className="hero-edit-plan" onClick={() => { setPlanDateInput(state.today); setPlanEditorSection("dates"); setTab("plan"); }}>Edit today’s plan</button>}</div></div>
                <div className="hero-title">{todayWorkout?.label}</div>
                <div className="hero-desc">{skipped && state.skipped[state.today] ? "Skipped: " + state.skipped[state.today] : todayWorkout?.restDay ? "A little recovery belongs in every plan." : `${itemsForWorkout(todayWorkout!).length} exercises planned · see your session below`}</div>
                {state.inPlan && !state.restDay && <div className="hero-actions">
                  <button className="complete-button" disabled={done || busy} onClick={() => act<Snapshot>("complete_today", {}, setState)}>{done ? "✓ Workout complete" : "✓ I completed this workout"}</button>
                  {!done && <button className="skip-button" disabled={busy} onClick={() => skipped ? act<Snapshot>("set_workout_status", { date: state.today, status: "clear", reason: null }, setState) : setSkipEditor(true)}>{skipped ? "Undo skip" : "Skip today"}</button>}
                </div>}
              </div>
              {skipEditor && <div className="inline-editor"><label>Skip reason (optional)<input value={skipReason} onChange={e => setSkipReason(e.target.value)} maxLength={160} placeholder="Rest, travel, sick day…" /></label><button onClick={() => act<Snapshot>("set_workout_status", { date: state.today, status: "skipped", reason: skipReason }, s => { setState(s); setSkipEditor(false); })}>Save skip</button><button className="quiet-button" onClick={() => setSkipEditor(false)}>Cancel</button></div>}
              <div className="two-col">
                <section className="panel workout-panel"><div className="panel-heading"><span>THE SESSION</span><button className="text-action" onClick={() => { setWorkoutEditorDate(state.today); setWorkoutEditorInput(state.actualWorkouts[state.today] ?? { title: "", details: "", items: [] }); setWorkoutEditorOpen(true); }}>{state.actualWorkouts[state.today] ? "Edit actual" : "Log actual"}</button></div>
                  {todayWorkout?.restDay ? <p className="panel-copy">A recovery day. You can change this in your Plan at any time.</p> : <WorkoutItemList items={itemsForWorkout(todayWorkout!)} empty="No exercises yet. Add some in your Plan." />}
                  {state.actualWorkouts[state.today] && <div className="actual-session"><small>WHAT YOU DID</small><strong>{state.actualWorkouts[state.today].title}</strong><WorkoutItemList items={itemsForWorkout(state.actualWorkouts[state.today])} empty="No exercise details recorded." /></div>}
                </section>
                <section className="panel meal-panel"><div className="panel-heading"><span>TODAY'S FOOD</span><span className="panel-icon">♢</span></div>
                  <div className="meal"><small>BREAKFAST · {actualMeals?.breakfast ? "ACTUAL" : "PLAN"}</small><p>{actualMeals?.breakfast || todayMeals.breakfast || "Not planned"}</p></div>
                  <div className="meal"><small>DINNER · {actualMeals?.dinner ? "ACTUAL" : "PLAN"}</small><p>{actualMeals?.dinner || todayMeals.dinner || "Not planned"}</p></div>
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
                      const workout = workoutForDate(date, state.plan, state.schedule);
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
                    <div className="detail-block"><small>WORKOUT DETAILS</small><WorkoutItemList items={itemsForWorkout(selectedWorkout!)} empty="No exercises planned" /></div>
                    <div className="detail-block"><small>BREAKFAST PLAN</small><span>{selectedMeals.breakfast || "Not planned"}</span></div>
                    <div className="detail-block"><small>DINNER PLAN</small><span>{selectedMeals.dinner || "Not planned"}</span></div>
                    {state.actualWorkouts[selectedDate] && <div className="detail-block actual"><small>WHAT YOU DID</small><span><b>{state.actualWorkouts[selectedDate].title}</b></span><WorkoutItemList items={itemsForWorkout(state.actualWorkouts[selectedDate])} /></div>}
                    {state.meals[selectedDate] && <div className="detail-block actual"><small>WHAT YOU ATE</small><span>{Object.entries(state.meals[selectedDate]).filter(([, value]) => value).map(([key, value]) => key + ": " + value).join(" · ")}</span></div>}
                    <div className="detail-actions">
                      {!["rest", "future"].includes(selectedStatus) && selectedDate <= state.today && selectedStatus !== "completed" && <button onClick={() => act<Snapshot>("set_workout_status", { date: selectedDate, status: "completed", reason: null }, setState)}>Mark done</button>}
                      {!["rest", "future", "skipped"].includes(selectedStatus) && selectedDate <= state.today && <button className="secondary" onClick={() => act<Snapshot>("set_workout_status", { date: selectedDate, status: "skipped", reason: "" }, setState)}>Skip</button>}
                      {["completed", "skipped"].includes(selectedStatus) && <button className="secondary" onClick={() => act<Snapshot>("set_workout_status", { date: selectedDate, status: "clear", reason: null }, setState)}>Undo status</button>}
                      <button className="secondary" onClick={() => { setPlanDateInput(selectedDate); setPlanEditorSection("dates"); setTab("plan"); }}>Edit day’s plan</button>
                      {selectedDate <= state.today && <button className="secondary" onClick={() => { setWorkoutEditorDate(selectedDate); setWorkoutEditorInput(state.actualWorkouts[selectedDate] ?? { title: "", details: "", items: [] }); setWorkoutEditorOpen(true); }}>Log workout</button>}
                      {selectedDate <= state.today && <button className="secondary" onClick={() => { setMealDate(selectedDate); setMealInput(state.meals[selectedDate] ?? emptyMeals()); setMealEditor(true); }}>Log food</button>}
                    </div>
                  </>}
                </section>
              </div>
            </>}
            {tab === "plan" && <>
              <div className="eyebrow">BUILT AROUND YOUR WEEK</div><h1>Your plan.</h1><p className="intro">Edit your weekly rhythm or make a one-day change. What you actually do stays in your log.</p>
              <div className="plan-switcher" role="group" aria-label="Plan sections">
                <button aria-pressed={planEditorSection === "workouts"} className={planEditorSection === "workouts" ? "active" : ""} onClick={() => setPlanEditorSection("workouts")}>Workouts</button>
                <button aria-pressed={planEditorSection === "meals"} className={planEditorSection === "meals" ? "active" : ""} onClick={() => setPlanEditorSection("meals")}>Meals</button>
                <button aria-pressed={planEditorSection === "dates"} className={planEditorSection === "dates" ? "active" : ""} onClick={() => setPlanEditorSection("dates")}>Date changes</button>
              </div>
              {planEditorSection === "workouts" && <section className="panel plan-editor-panel"><div className="plan-editor-heading"><div><span className="section-kicker">REPEATS EACH WEEK</span><h2>Your workout schedule</h2></div><span>01 — 07</span></div>
                <div className="weekly-workout-list">{weekdayNames.map((name, i) => { const workout = scheduleInput.workouts[i] ?? starterSchedule().workouts[i]; return <article className="weekly-workout-row" key={name}><div className="weekly-day"><strong>{name.slice(0, 3)}</strong><small>{name}</small></div><div className="weekly-workout-fields"><label className="workout-title-field"><span>Session</span><input aria-label={`${name} workout name`} value={workout.title} disabled={workout.restDay} onChange={e => updateWeeklyWorkout(i, { title: e.target.value })} placeholder="Workout name" maxLength={80} /></label><label className="rest-toggle"><input type="checkbox" checked={workout.restDay} onChange={e => updateWeeklyWorkout(i, { restDay: e.target.checked, title: e.target.checked ? "Rest day" : "New workout", items: e.target.checked || workout.restDay ? [] : itemsForWorkout(workout), details: "" })} /><span>Rest day</span></label>{!workout.restDay && <details className="exercise-accordion" open={i === today.getDay()}><summary>Exercises · {itemsForWorkout(workout).length}</summary><WorkoutExerciseRows items={itemsForWorkout(workout)} idPrefix={`weekly-${i}`} onChange={items => updateWeeklyWorkout(i, { items, details: "" })} /></details>}</div></article>; })}</div>
                <div className="plan-save-row"><span>Save the weekly pattern or replace all upcoming one-day workout changes.</span><div><button className="quiet-button" disabled={busy} onClick={() => act<Snapshot>("save_schedule", { schedule: scheduleInput }, s => { setState(s); setScheduleInput(s.schedule); })}>Save weekly pattern</button><button className="save-button" disabled={busy} onClick={() => applyScheduleToRemaining("workouts")}>Apply to remaining days</button></div></div>
              </section>}
              {planEditorSection === "meals" && <section className="panel plan-editor-panel"><div className="plan-editor-heading"><div><span className="section-kicker">REPEATS EACH WEEK</span><h2>Your meal schedule</h2></div><span>01 — 07</span></div>
                <div className="weekly-meal-list">{weekdayNames.map((name, i) => { const meal = scheduleInput.meals[i] ?? emptyMeals(); return <div className="weekly-meal-row" key={name}><strong>{name}</strong>{(["breakfast", "lunch", "dinner", "snacks"] as const).map(field => <label key={field}>{field}<input value={meal[field]} maxLength={250} onChange={e => updateWeeklyMeal(i, field, e.target.value)} placeholder="Optional" /></label>)}</div>; })}</div>
                <div className="plan-save-row"><span>Leave a meal blank if you prefer it open.</span><div><button className="quiet-button" disabled={busy} onClick={() => act<Snapshot>("save_schedule", { schedule: scheduleInput }, s => { setState(s); setScheduleInput(s.schedule); })}>Save weekly menu</button><button className="save-button" disabled={busy} onClick={() => applyScheduleToRemaining("meals")}>Apply to remaining days</button></div></div>
              </section>}
              {planEditorSection === "dates" && <section className="panel plan-editor-panel date-plan-panel"><div className="plan-editor-heading"><div><span className="section-kicker">A CHANGE OF PLANS</span><h2>Adjust a specific day</h2></div><span>ONE DAY</span></div><label className="date-plan-picker">Choose a date<input type="date" min={state.today < state.plan.startDate ? state.plan.startDate : state.today} max={state.plan.endDate} value={planDateInput} onChange={e => setPlanDateInput(e.target.value)} /></label>
                {dateWorkout && <><h3 className="editor-subhead">Workout · {planDateInput && dateOf(planDateInput).toLocaleDateString("en-KE", { weekday: "long", month: "short", day: "numeric" })}</h3><div className="date-workout-fields"><label className="rest-toggle"><input type="checkbox" checked={dateWorkout.restDay} onChange={e => changeDateWorkout({ restDay: e.target.checked, title: e.target.checked ? "Rest day" : "New workout", items: e.target.checked || dateWorkout.restDay ? [] : itemsForWorkout(dateWorkout), details: "" })} /><span>Rest day</span></label><label className="workout-title-field"><span>Session</span><input value={dateWorkout.title} disabled={dateWorkout.restDay} onChange={e => changeDateWorkout({ title: e.target.value })} maxLength={80} placeholder="Workout name" /></label>{!dateWorkout.restDay && <WorkoutExerciseRows items={itemsForWorkout(dateWorkout)} idPrefix="date-plan" onChange={items => changeDateWorkout({ items, details: "" })} />}</div><h3 className="editor-subhead">Meals</h3><div className="date-meal-fields">{(["breakfast", "lunch", "dinner", "snacks"] as const).map(field => <label key={field}>{field}<input value={dateMeals[field]} maxLength={250} onChange={e => changeDateMeal(field, e.target.value)} placeholder="Optional" /></label>)}</div><div className="plan-save-row"><span>This date can differ from your repeating week.</span><div><button className="quiet-button" disabled={busy || !scheduleInput.workoutOverrides[planDateInput] && !scheduleInput.mealOverrides[planDateInput]} onClick={clearDatePlan}>Use weekly schedule</button><button className="save-button" disabled={busy || !planDateInput || planDateInput < state.today} onClick={saveDatePlan}>Save this day</button></div></div></>}
              </section>}
            </>}
            {tab === "meals" && <>
              <div className="eyebrow">YOUR HOUSEHOLD MENU</div><h1>Weekly meal plan.</h1><p className="intro">Breakfast and dinner follow your plan. Lunch is open—log what you actually eat.</p>
              <section className="panel meals-plan-panel">
                <div className="meal-week-toolbar"><button onClick={() => setMealWeekOffset(mealWeekOffset - 1)} aria-label="Previous week">‹</button><strong>{pretty(isoOf(mealWeekStart))} – {pretty(isoOf(addDays(mealWeekStart, 6)))}</strong><button onClick={() => setMealWeekOffset(mealWeekOffset + 1)} aria-label="Next week">›</button><button className="this-week" onClick={() => setMealWeekOffset(0)}>This week</button></div>
                <div className="meal-plan-head"><span>DAY</span><span>BREAKFAST</span><span>DINNER + PORTION NOTE</span><span>ACTUAL</span><span>PLAN</span></div>
                {mealWeekDays.map(date => {
                  const iso = isoOf(date); const planned = mealsForDate(date, state.schedule); const logged = state.meals[iso]; const canLog = iso >= state.plan.startDate && iso <= state.plan.endDate && iso <= state.today;
                  return <div className={"meal-plan-row" + (iso === state.today ? " current" : "")} key={iso}>
                    <div className="meal-day"><strong>{date.toLocaleDateString("en-KE", { weekday: "short" })}</strong><small>{pretty(iso)}</small></div>
                    <div>{planned.breakfast || "—"}</div>
                    <div><strong>{planned.dinner || "—"}</strong><small>{planned.lunch && `Lunch: ${planned.lunch}`}{planned.snacks && ` · Snacks: ${planned.snacks}`}</small></div>
                    <div className="meal-actual">{canLog ? <button onClick={() => { setMealDate(iso); setMealInput(logged ?? emptyMeals()); setMealEditor(true); }}>{logged ? "Edit log" : "+ Log food"}</button> : <span>—</span>}</div>
                    <div className="plan-day-action"><button disabled={iso < state.today} onClick={() => { setPlanDateInput(iso); setPlanEditorSection("dates"); setTab("plan"); }}>Edit plan</button></div>
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
                  return <div className="history-row" key={iso}><span>{date.toLocaleDateString("en-KE", { weekday: "short", month: "short", day: "numeric" })}{state.actualWorkouts[iso] && <small className="history-actual"> · {state.actualWorkouts[iso].title}</small>}</span><span className={"history-status " + status}>{status}</span><div className="history-actions">
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
              <h2 className="settings-subhead">Your profile</h2>
              <section className="panel settings-panel"><div className="setting-row"><div><h3>Display name</h3><p>This is how Daily Drive addresses you in the app.</p></div><div className="profile-name-control"><input value={profileName} maxLength={80} aria-label="Display name" onChange={e => setProfileName(e.target.value)} placeholder="Your name" /><button className="save-button" disabled={busy || !profileName.trim() || profileName.trim() === (state.profile?.name ?? "")} onClick={() => act<Snapshot>("save_profile", { name: profileName }, s => { setState(s); setProfileName(s.profile?.name ?? ""); })}>Save name</button></div></div></section>
              <h2 className="settings-subhead">Appearance</h2>
              <section className="panel settings-panel"><div className="setting-row"><div><h3>Theme</h3><p>Choose a dark appearance or follow your device’s system setting.</p></div><select className="theme-select" value={theme} onChange={e => { setTheme(e.target.value as "dark" | "system"); notify("success", "Appearance updated"); }} aria-label="Theme"><option value="dark">Dark</option><option value="system">System</option></select></div></section>
              <h2 className="settings-subhead">Your data</h2>
              <section className="panel settings-panel"><div className="setting-row"><div><h3>Export or import</h3><p>Export your plan and history. Imports keep all dates; imported entries replace matches.</p>{exportStage && <p className="export-status" role="status" aria-live="polite"><span className="export-spinner" />{exportStage}</p>}{exportMessage && <div className="export-status success" role="status" aria-live="polite"><span>{exportMessage}</span>{exportPath && <><small className="export-path">{exportPath}</small><button className="show-export" onClick={() => void showExportInFinder(exportPath)}>Show in folder</button></>}</div>}</div><div className="data-actions"><button className="data-button secondary" disabled={busy || exporting} onClick={exportData}>{exporting ? "Exporting…" : "Export data"}</button><button className="data-button" disabled={busy || exporting} onClick={() => importFileRef.current?.click()}>Import data</button><input ref={importFileRef} className="visually-hidden" type="file" accept=".json,application/json" aria-label="Choose Daily Drive export file" onChange={e => void importData(e.target.files?.[0])} /></div></div></section>
              <h2 className="settings-subhead">Daily alarm</h2>
              <section className="panel settings-panel"><div className="setting-row"><div><h3>Workout time</h3><p>On your scheduled workout days, within your challenge dates.</p></div><div className="time-control"><input type="time" value={alarmInput} onChange={e => setAlarmInput(e.target.value)} aria-label="Workout alarm time" /><button disabled={busy || alarmInput === state.alarmTime} onClick={() => act<Snapshot>("set_alarm_time", { time: alarmInput }, setState)}>Save</button></div></div>
                <div className="setting-row"><div><h3>Alarm sound</h3><p>{isMacOS ? "Choose and preview the sound you hear when the alarm rings." : "Preview your system alert tone."}</p></div><div className="sound-control"><select value={alarmSoundInput} onChange={e => setAlarmSoundInput(e.target.value)} aria-label="Alarm sound">{alarmSoundChoices.map(sound => <option key={sound} value={sound}>{sound}</option>)}</select><button disabled={busy} onClick={() => act<void>("preview_alarm_sound", { sound: alarmSoundInput })}>Preview</button><button disabled={busy || alarmSoundInput === state.alarmSound} onClick={() => act<Snapshot>("set_alarm_sound", { sound: alarmSoundInput }, setState)}>Save</button></div></div>
                <div className="setting-row"><div><h3>Launch at login</h3><p>Keep the app ready for your daily alarm.</p></div><button className={login ? "toggle on" : "toggle"} role="switch" aria-checked={login} aria-label="Launch at login" onClick={() => act<boolean>("launch_at_login", { enabled: !login }, setLogin)}><span /></button></div>
              </section>
              <p className="settings-note">Your computer must be awake and this app must be running. Closing the window keeps it running; use Quit to stop it. The alarm follows your system volume.</p>
              <h2 className="settings-subhead">App updates</h2>
              <section className="panel settings-panel version-panel"><div className="setting-row"><div><h3>Daily Drive <span className="version-number">v{appVersion}</span></h3><p>Check for and install signed updates from GitHub.</p>{releaseStatus && <p className="release-status" role="status">{releaseStatus}</p>}</div><button className="save-button" disabled={checkingRelease} onClick={() => void checkForUpdates()}>{checkingRelease ? "Checking…" : "Check for updates"}</button></div></section>
            </>}
          </>}
        </main>
      </div>
      {mealEditor && state && <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) setMealEditor(false); }}>
        <form className="meal-modal" role="dialog" aria-modal="true" aria-labelledby="meal-log-title" onSubmit={e => { e.preventDefault(); act<Snapshot>("save_meals", { date: mealDate, meals: mealInput }, s => { setState(s); setMealEditor(false); }); }}>
          <div className="modal-heading"><div><div className="eyebrow">{pretty(mealDate).toUpperCase()}</div><h2 id="meal-log-title">What did you eat?</h2></div><button type="button" className="modal-close" onClick={() => setMealEditor(false)} aria-label="Close">×</button></div>
          <p>Use the menu as a guide. Log what actually happened, without changing your workout progress.</p>
          <div className="meal-fields">
            {(["breakfast", "lunch", "dinner", "snacks"] as const).map(key => <label key={key}>{key}<input value={mealInput[key]} maxLength={250} onChange={e => setMealInput({ ...mealInput, [key]: e.target.value })} placeholder={mealsForDate(dateOf(mealDate), state.schedule)[key] || "Optional"} /></label>)}
          </div>
          <div className="modal-actions"><button type="button" className="quiet-button" onClick={() => setMealEditor(false)}>Cancel</button><button className="save-button" type="submit" disabled={busy}>Save food log</button></div>
        </form>
      </div>}
      {workoutEditorOpen && state && <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) setWorkoutEditorOpen(false); }}>
        <form className="meal-modal workout-log-modal" role="dialog" aria-modal="true" aria-labelledby="workout-log-title" onSubmit={e => { e.preventDefault(); act<Snapshot>("save_actual_workout", { date: workoutEditorDate, workout: workoutEditorInput }, s => { setState(s); setWorkoutEditorOpen(false); }); }}>
          <div className="modal-heading"><div><div className="eyebrow">{pretty(workoutEditorDate).toUpperCase()}</div><h2 id="workout-log-title">What did you do?</h2></div><button type="button" className="modal-close" onClick={() => setWorkoutEditorOpen(false)} aria-label="Close">×</button></div>
          <p>Log what actually happened. This won’t change your planned workout.</p>
          <div className="meal-fields"><label>Session name<input autoFocus value={workoutEditorInput.title} maxLength={80} onChange={e => setWorkoutEditorInput({ ...workoutEditorInput, title: e.target.value })} placeholder="Strength session, a walk, yoga…" /></label></div><div className="actual-exercises"><div className="exercise-column-head"><span>EXERCISE</span><span>SETS, REPS OR TIME</span><span /></div><WorkoutExerciseRows items={itemsForWorkout(workoutEditorInput)} idPrefix="actual" onChange={items => setWorkoutEditorInput({ ...workoutEditorInput, items, details: "" })} /></div>
          <div className="modal-actions"><button type="button" className="quiet-button" onClick={() => setWorkoutEditorOpen(false)}>Cancel</button><button className="save-button" type="submit" disabled={busy || !workoutEditorInput.title.trim()}>Save actual workout</button></div>
        </form>
      </div>}
    </div>
  );
}

export default App;
