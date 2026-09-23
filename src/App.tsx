import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import "./App.css";

type Measurement = { weight: number | null; waist: number | null };
type Snapshot = {
  today: string; alarmTime: string; completed: string[]; measurements: Record<string, Measurement>;
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
const strength = [
  ["Push-ups", "3–4 × 10–15"], ["Dumbbell rows", "3–4 × 10–12 / side"],
  ["Goblet squats", "3–4 × 12–15"], ["Reverse or walking lunges", "3 × 10–12 / leg"],
  ["Dumbbell shoulder press", "3 × 10–12"], ["Glute bridges", "3 × 15"],
  ["Plank", "3 × 30–60 sec"], ["Lying leg raises", "3 × 12–15"],
];
const start = new Date(2026, 8, 7);
const dateOf = (iso: string) => { const [y, m, d] = iso.split("-").map(Number); return new Date(y, m - 1, d); };
const isoOf = (date: Date) => [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
const pretty = (iso: string) => dateOf(iso).toLocaleDateString("en-KE", { month: "short", day: "numeric" });
const monday = (date: Date) => { const d = new Date(date); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d; };

function App() {
  const [state, setState] = useState<Snapshot | null>(null);
  const [tab, setTab] = useState<"today" | "progress" | "settings">("today");
  const [alarmInput, setAlarmInput] = useState("07:00");
  const [login, setLogin] = useState(false);
  const [weight, setWeight] = useState("");
  const [waist, setWaist] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    invoke<Snapshot>("get_state").then(s => { setState(s); setAlarmInput(s.alarmTime); }).catch(e => setError(String(e)));
    invoke<boolean>("login_enabled").then(setLogin).catch(() => {});
    let stop: (() => void) | undefined;
    listen<Snapshot>("state-changed", e => setState(e.payload)).then(fn => { stop = fn; });
    return () => stop?.();
  }, []);

  const today = state ? dateOf(state.today) : new Date();
  const day = today.getDay();
  const week = Math.max(1, Math.min(12, Math.floor((today.getTime() - start.getTime()) / 604800000) + 1));
  const phase = week <= 4 ? "Foundation" : week <= 8 ? "Build" : "Finish strong";
  const done = !!state?.completed.includes(state.today);
  const isStrength = [1, 3, 5].includes(day);
  const intervals = week >= 5 && day === 6;
  const workoutName = day === 0 ? "Rest & recharge" : isStrength ? "Full-body strength" : intervals ? "Treadmill intervals" : "Incline treadmill";
  const logged = useMemo(() => state?.measurements[isoOf(monday(today))], [state, today]);

  useEffect(() => { setWeight(logged?.weight?.toString() ?? ""); setWaist(logged?.waist?.toString() ?? ""); }, [logged?.weight, logged?.waist]);

  async function act<T>(command: string, args?: Record<string, unknown>, after?: (value: T) => void) {
    setBusy(true); setError("");
    try { const value = await invoke<T>(command, args); after?.(value); }
    catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  }

  const dates = Array.from({ length: 12 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i * 7); return d; });

  return (
    <div className={state?.alarmActive ? "app alarm-on" : "app"}>
      <header className="topbar">
        <div className="brand"><div className="brand-mark">D</div><span>DAILY DRIVE</span></div>
        <div className="top-right"><span className="anniversary">TO NOV 28 · ANNIVERSARY</span><span className="date-pill">{state ? today.toLocaleDateString("en-KE", { weekday: "short", month: "short", day: "numeric" }) : "Loading…"}</span></div>
      </header>
      <div className="shell">
        <aside className="sidebar">
          <div className="side-label">YOUR PLAN</div>
          <button className={tab === "today" ? "nav active" : "nav"} onClick={() => setTab("today")}><span>◉</span> Today</button>
          <button className={tab === "progress" ? "nav active" : "nav"} onClick={() => setTab("progress")}><span>▥</span> Progress</button>
          <button className={tab === "settings" ? "nav active" : "nav"} onClick={() => setTab("settings")}><span>⚙</span> Alarm settings</button>
          <div className="side-bottom"><div className="mini-label">THE GOAL</div><div className="goal-numbers">99 <span>→</span> 90 <small>kg</small></div><p>12 weeks, one day at a time.</p></div>
        </aside>
        <main className={`content ${tab}-view`}>
          {!state ? <div className="loading">Loading your plan…</div> : <>
            {state.alarmActive && <div className="alarm-banner"><span className="alarm-dot" /> IT'S WORKOUT TIME <span className="alarm-sub">The alarm keeps sounding until you complete today's session.</span></div>}
            {error && <div className="error" role="alert">{error}</div>}
            {tab === "today" && <>
              <div className="eyebrow">WEEK {week} OF 12 <span>·</span> {phase.toUpperCase()}</div>
              <h1>{done ? "You showed up today." : state.restDay ? "Rest is part of the plan." : "Let's get moving."}</h1>
              <p className="intro">{state.inPlan ? "Your daily check-in for the 12-week transformation." : "Your plan runs Sep 7 – Nov 28, 2026."}</p>
              <div className="hero-card">
                <div className="hero-top"><span className="section-kicker">TODAY'S WORKOUT</span><span className={done ? "status done" : "status"}>{done ? "✓ Completed" : state.restDay ? "Rest day" : "● To do"}</span></div>
                <div className="hero-title">{workoutName}</div>
                <div className="hero-desc">{isStrength ? "Monday · Wednesday · Friday" : intervals ? "Saturday · Week 5 onward" : day === 0 ? "Take the day off and recover." : "Build endurance at a sustainable pace."}</div>
                {state.inPlan && !state.restDay && <button className="complete-button" disabled={done || busy} onClick={() => act<Snapshot>("complete_today", {}, setState)}>{done ? "✓ Workout complete" : "✓ I completed this workout"}</button>}
              </div>
              <div className="two-col">
                <section className="panel workout-panel"><div className="panel-heading"><span>THE SESSION</span><span className="panel-icon">↗</span></div>
                  {isStrength ? <div className="exercise-list">{strength.map(([name, reps]) => <div className="exercise" key={name}><span>{name}</span><strong>{reps}</strong></div>)}</div>
                    : day === 0 ? <p className="panel-copy">No workout today. Hydrate, sleep well, and get ready for Monday.</p>
                    : intervals ? <div className="steps"><p><b>Warm up</b> 5 min flat · 5–6 km/h</p><p><b>Intervals</b> 6–8 rounds: 1 min at 8–9 km/h, 2 min at 5 km/h</p><p><b>Cool down</b> 5 min easy</p><p className="muted">Aim for 150–160 bpm at the peak.</p></div>
                    : <div className="steps"><p><b>Speed</b> 5.5–6.5 km/h</p><p><b>Incline</b> {week <= 4 ? "6%" : week <= 8 ? "8%" : "10–12%"}</p><p><b>Duration</b> 30–45 min</p><p className="muted">Target heart rate: 113–132 bpm.</p></div>}
                </section>
                <section className="panel meal-panel"><div className="panel-heading"><span>TODAY'S FOOD</span><span className="panel-icon">♢</span></div>
                  <div className="meal"><small>BREAKFAST</small><p>{breakfast[day]}</p></div>
                  <div className="meal"><small>DINNER</small><p>{dinner[day]}</p></div>
                  <div className="meal-note">Water through the day · go lighter on oil</div>
                </section>
              </div>
            </>}
            {tab === "progress" && <>
              <div className="eyebrow">YOUR JOURNEY</div><h1>Progress, week by week.</h1><p className="intro">Log your weight and waist once a week. Small changes add up.</p>
              <section className="panel log-panel"><div className="panel-heading"><span>THIS WEEK · {pretty(isoOf(monday(today)))}</span><span>WEEK {week}</span></div>
                <div className="form-row"><label>Weight (kg)<input type="number" step="0.1" min="30" max="300" value={weight} onChange={e => setWeight(e.target.value)} placeholder="e.g. 96.5" /></label><label>Waist (cm)<input type="number" step="0.1" min="30" max="250" value={waist} onChange={e => setWaist(e.target.value)} placeholder="e.g. 101" /></label><button className="save-button" disabled={busy || !state.inPlan} onClick={() => act<Snapshot>("save_measurement", { date: isoOf(monday(today)), weight: weight ? Number(weight) : null, waist: waist ? Number(waist) : null }, setState)}>Save check-in</button></div>
              </section>
              <section className="panel timeline"><div className="panel-heading"><span>12-WEEK TRACKER</span><span>{state.completed.length} workouts done</span></div>
                {dates.map((date, i) => {
                  const iso = isoOf(date); const next = new Date(date); next.setDate(next.getDate() + 7);
                  const count = state.completed.filter(d => d >= iso && d < isoOf(next)).length;
                  const measure = state.measurements[iso];
                  return <div className="week-row" key={iso}><span className="week-no">{String(i + 1).padStart(2, "0")}</span><span className="week-date">{pretty(iso)}{i === 11 ? " · Anniversary week" : ""}</span><span className="week-count">{count}/6 sessions</span><span className="week-measure">{measure?.weight ? `${measure.weight} kg` : "—"} <i>·</i> {measure?.waist ? `${measure.waist} cm` : "—"}</span></div>;
                })}
              </section>
            </>}
            {tab === "settings" && <>
              <div className="eyebrow">MAKE IT YOURS</div><h1>Your daily alarm.</h1><p className="intro">A loud Mac sound repeats and this window comes forward until you mark the workout complete.</p>
              <section className="panel settings-panel"><div className="setting-row"><div><h3>Workout time</h3><p>Monday–Saturday, during the 12-week plan.</p></div><div className="time-control"><input type="time" value={alarmInput} onChange={e => setAlarmInput(e.target.value)} aria-label="Workout alarm time" /><button disabled={busy || alarmInput === state.alarmTime} onClick={() => act<Snapshot>("set_alarm_time", { time: alarmInput }, setState)}>Save</button></div></div>
                <div className="setting-row"><div><h3>Launch at login</h3><p>Keep the app ready for your daily alarm.</p></div><button className={login ? "toggle on" : "toggle"} role="switch" aria-checked={login} aria-label="Launch at login" onClick={() => act<boolean>("launch_at_login", { enabled: !login }, setLogin)}><span /></button></div>
              </section>
              <p className="settings-note">The Mac must be awake and this app must be running. Closing the window keeps it running; use Quit to stop it. The sound follows your Mac's volume.</p>
            </>}
          </>}
        </main>
      </div>
    </div>
  );
}

export default App;
