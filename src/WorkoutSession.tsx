import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

type SessionStep = { kind: "exercise" | "rest"; name: string; reps: string; durationSeconds: number };
export type SessionDraft = {
  date: string;
  title: string;
  targetSeconds: number;
  steps: SessionStep[];
  stepIndex: number;
  stepElapsedSeconds: number;
  totalElapsedSeconds: number;
  running: boolean;
  ready: boolean;
  lastTickAt: number;
};

const storageKey = "daily-drive-active-session";
const clock = (seconds: number) => `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
const soundFor = (step?: SessionStep) => step?.kind === "rest" ? "Glass" : step ? "Ping" : "Hero";
const playCue = (step?: SessionStep) => { void invoke("preview_alarm_sound", { sound: soundFor(step) }).catch(() => {}); };

export function createSessionDraft(date: string, workout: { title: string; durationMinutes?: number }, items: { name: string; reps: string; durationSeconds?: number; restSeconds?: number }[]): SessionDraft {
  const targetSeconds = Math.round((workout.durationMinutes || 30) * 60);
  const exercises = items.filter(item => item.name.trim());
  const steps: SessionStep[] = [];
  if (!exercises.length) steps.push({ kind: "exercise", name: workout.title, reps: "", durationSeconds: targetSeconds });
  exercises.forEach((item, index) => {
    steps.push({ kind: "exercise", name: item.name, reps: item.reps, durationSeconds: item.durationSeconds || 0 });
    if (index < exercises.length - 1 && item.restSeconds) steps.push({ kind: "rest", name: "Rest before " + exercises[index + 1].name, reps: "", durationSeconds: item.restSeconds });
  });
  return { date, title: workout.title, targetSeconds, steps, stepIndex: 0, stepElapsedSeconds: 0, totalElapsedSeconds: 0, running: true, ready: false, lastTickAt: Date.now() };
}

export function loadSessionDraft(): SessionDraft | null {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || "null") as SessionDraft | null;
    if (!saved || !/^\d{4}-\d{2}-\d{2}$/.test(saved.date) || !Array.isArray(saved.steps) || !saved.steps.length || saved.stepIndex < 0 || saved.stepIndex >= saved.steps.length || typeof saved.totalElapsedSeconds !== "number") return null;
    return { ...saved, running: false, lastTickAt: 0 };
  } catch { return null; }
}

function advance(session: SessionDraft, seconds: number): SessionDraft {
  let next = { ...session };
  let remaining = seconds;
  while (remaining > 0 && !next.ready) {
    const step = next.steps[next.stepIndex];
    const available = step.durationSeconds ? Math.max(0, step.durationSeconds - next.stepElapsedSeconds) : remaining;
    const used = Math.min(remaining, available);
    next.stepElapsedSeconds += used;
    next.totalElapsedSeconds += used;
    remaining -= used;
    if (step.durationSeconds && next.stepElapsedSeconds >= step.durationSeconds) {
      if (next.stepIndex === next.steps.length - 1) next = { ...next, running: false, ready: true, lastTickAt: 0 };
      else next = { ...next, stepIndex: next.stepIndex + 1, stepElapsedSeconds: 0 };
      if (next.ready || next.steps[next.stepIndex].durationSeconds === 0) break;
    } else break;
  }
  return next;
}

export default function WorkoutSession({ initial, onClose, onComplete }: { initial: SessionDraft; onClose: () => void; onComplete: () => Promise<boolean> }) {
  const [session, setSession] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);
  const cueInitialized = useRef(false);
  const targetCuePlayed = useRef(initial.totalElapsedSeconds >= initial.targetSeconds);
  const step = session.steps[session.stepIndex];
  const priorIndex = session.stepIndex;
  const visibleSeconds = session.ready ? 0 : step.durationSeconds ? Math.max(0, step.durationSeconds - session.stepElapsedSeconds) : Math.max(0, session.targetSeconds - session.totalElapsedSeconds);
  const progress = session.ready ? 1 : step.durationSeconds ? session.stepElapsedSeconds / step.durationSeconds : Math.min(1, session.totalElapsedSeconds / session.targetSeconds);
  const radius = 114;
  const circumference = 2 * Math.PI * radius;

  useEffect(() => {
    try { localStorage.setItem(storageKey, JSON.stringify(session)); } catch { /* Session remains usable in memory. */ }
  }, [session]);
  useEffect(() => {
    if (!session.running || session.ready) return;
    const timer = window.setInterval(() => setSession(current => {
      if (!current.running || current.ready) return current;
      const elapsed = Math.floor((Date.now() - current.lastTickAt) / 1000);
      if (elapsed <= 0) return current;
      return advance({ ...current, lastTickAt: current.lastTickAt + elapsed * 1000 }, elapsed);
    }), 200);
    return () => window.clearInterval(timer);
  }, [session.running, session.ready]);
  useEffect(() => {
    if (!cueInitialized.current) {
      cueInitialized.current = true;
      if (!initial.running) return;
    }
    playCue(session.ready ? undefined : session.steps[session.stepIndex]);
  }, [session.stepIndex, session.ready]);
  useEffect(() => {
    if (session.ready || targetCuePlayed.current || session.totalElapsedSeconds < session.targetSeconds) return;
    targetCuePlayed.current = true;
    playCue();
  }, [session.totalElapsedSeconds, session.targetSeconds, session.ready]);

  function nextStep() {
    setSession(current => current.stepIndex === current.steps.length - 1
      ? { ...current, ready: true, running: false, lastTickAt: 0 }
      : { ...current, stepIndex: current.stepIndex + 1, stepElapsedSeconds: 0, lastTickAt: Date.now() });
  }
  async function complete() {
    setBusy(true);
    const saved = await onComplete();
    setBusy(false);
    if (saved) { try { localStorage.removeItem(storageKey); } catch { /* The session is already complete. */ } onClose(); }
  }
  function stop() { try { localStorage.removeItem(storageKey); } catch { /* The session is already stopped. */ } onClose(); }

  return <div className="session-backdrop">
    <section className="session-screen" role="dialog" aria-modal="true" aria-labelledby="session-title">
      <header className="session-header"><div><span>WORKOUT SESSION</span><h2 id="session-title">{session.title}</h2></div><span>{session.date}</span></header>
      <div className="session-stage"><span>{session.ready ? "SESSION FINISHED" : step.kind === "rest" ? "REST TIME" : `EXERCISE ${session.steps.slice(0, session.stepIndex + 1).filter(part => part.kind === "exercise").length} OF ${session.steps.filter(part => part.kind === "exercise").length}`}</span><h3>{session.ready ? "Great work." : step.name}</h3>{!session.ready && step.reps && <p>{step.reps}</p>}</div>
      <div className="session-ring-wrap"><svg className="session-ring" viewBox="0 0 280 280" role="img" aria-label={`${Math.round(progress * 100)} percent progress`}><circle cx="140" cy="140" r={radius} className="session-ring-track" /><circle cx="140" cy="140" r={radius} className="session-ring-progress" strokeDasharray={circumference} strokeDashoffset={circumference * (1 - progress)} transform="rotate(-90 140 140)" /></svg><div className="session-clock"><strong>{clock(visibleSeconds)}</strong><span>{session.ready ? "FINISHED" : step.durationSeconds ? "STEP REMAINING" : "SESSION REMAINING"}</span></div></div>
      <div className="session-total"><span>Total time <strong>{clock(session.totalElapsedSeconds)}</strong></span>{session.targetSeconds > 0 && <span>Session target <strong>{clock(session.targetSeconds)}</strong></span>}</div>
      <div className="session-next">{!session.ready && (session.steps[session.stepIndex + 1] ? `Next: ${session.steps[session.stepIndex + 1].name}` : "Last step")}</div>
      <div className="session-controls">{!session.ready && <><button className="session-pause" onClick={() => setSession(current => current.running ? { ...current, running: false, lastTickAt: 0 } : { ...current, running: true, lastTickAt: Date.now() })}>{session.running ? "Pause" : "Resume"}</button><button className="session-next-button" onClick={nextStep}>{session.stepIndex === session.steps.length - 1 ? "Finish timer" : "Next step →"}</button></>}<button className="session-complete" disabled={busy} onClick={() => void complete()}>{busy ? "Saving…" : "Complete workout"}</button></div>
      {confirmStop ? <div className="session-stop-confirm"><span>Stop this session without marking the workout complete?</span><button onClick={stop}>Yes, stop</button><button onClick={() => setConfirmStop(false)}>Keep going</button></div> : <button className="session-stop" onClick={() => setConfirmStop(true)}>Stop session</button>}
      <div className="session-steps" aria-label="Session steps">{session.steps.map((part, index) => <span key={`${index}-${part.name}`} className={index < priorIndex ? "done" : index === priorIndex ? "current" : ""} title={part.name} />)}</div>
    </section>
  </div>;
}
