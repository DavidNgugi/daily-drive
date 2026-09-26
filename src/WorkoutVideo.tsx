import { useEffect, useRef, useState } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";

type ResolvedVideo = { kind: "file" | "embed"; url: string; pageUrl?: string; youtube?: boolean; youtubeId?: string; start?: number };

function resolveWebVideo(source: string): ResolvedVideo | null {
  let url: URL;
  try { url = new URL(source); } catch { return null; }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.toLowerCase();
  const youtube = host === "youtube.com" || host === "www.youtube.com" || host === "m.youtube.com" || host === "youtu.be" || host === "www.youtube-nocookie.com";
  if (youtube) {
    const id = host === "youtu.be" ? url.pathname.split("/")[1] : url.pathname.startsWith("/shorts/") || url.pathname.startsWith("/embed/") ? url.pathname.split("/")[2] : url.searchParams.get("v");
    if (!id || !/^[A-Za-z0-9_-]{11}$/.test(id)) return null;
    const start = Number(url.searchParams.get("t")?.replace(/s$/, "") || url.searchParams.get("start") || 0);
    return { kind: "embed", url: "", pageUrl: source, youtube: true, youtubeId: id, start: Number.isFinite(start) ? Math.max(0, Math.floor(start)) : 0 };
  }
  if (host === "vimeo.com" || host === "www.vimeo.com" || host === "player.vimeo.com") {
    const id = url.pathname.split("/").filter(Boolean).pop();
    if (id && /^\d+$/.test(id)) return { kind: "embed", url: `https://player.vimeo.com/video/${id}?autoplay=1&controls=1`, pageUrl: source };
  }
  if (url.pathname.includes("/embed/")) return { kind: "embed", url: source, pageUrl: source };
  return { kind: "file", url: source, pageUrl: source };
}

export default function WorkoutVideo({ source, running }: { source: string; running: boolean }) {
  const [video, setVideo] = useState<ResolvedVideo | null>(null);
  const [error, setError] = useState("");
  const [speed, setSpeed] = useState(1);
  const fileRef = useRef<HTMLVideoElement>(null);
  const embedRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    let cancelled = false;
    setError("");
    const web = resolveWebVideo(source.trim());
    if (web?.youtubeId) {
      setVideo(null);
      void invoke<string>("youtube_embed_url", { id: web.youtubeId, start: web.start ?? 0 }).then(url => {
        if (!cancelled) setVideo({ ...web, url });
      }).catch(reason => { if (!cancelled) setError(String(reason)); });
      return () => { cancelled = true; };
    }
    if (web) { setVideo(web); return; }
    const path = source.trim().startsWith("file://") ? decodeURIComponent(source.trim().slice(7)) : source.trim();
    if (!path.startsWith("/")) { setVideo(null); setError("Use a local file path or an http(s) video link."); return; }
    setVideo(null);
    void invoke<string>("import_workout_video", { path }).then(managedPath => {
      if (!cancelled) setVideo({ kind: "file", url: convertFileSrc(managedPath) });
    }).catch(reason => { if (!cancelled) setError(String(reason)); });
    return () => { cancelled = true; };
  }, [source]);

  useEffect(() => {
    if (video?.kind === "file" && fileRef.current) {
      if (running) void fileRef.current.play().catch(() => {});
      else fileRef.current.pause();
    }
    if (video?.youtube) embedRef.current?.contentWindow?.postMessage(JSON.stringify({ event: "command", func: running ? "playVideo" : "pauseVideo", args: [] }), new URL(video.url).origin);
    if (video?.kind === "embed" && !video.youtube && video.url.includes("player.vimeo.com")) embedRef.current?.contentWindow?.postMessage({ method: running ? "play" : "pause" }, "https://player.vimeo.com");
  }, [running, video]);

  function seek(seconds: number) {
    const player = fileRef.current;
    if (player) player.currentTime = Math.max(0, Math.min(player.duration || Infinity, player.currentTime + seconds));
  }

  return <div className="workout-video-panel">
    <div className="workout-video-heading"><strong>WORKOUT VIDEO</strong>{video?.pageUrl && <button onClick={() => void openUrl(video.pageUrl!)}>Open in browser ↗</button>}</div>
    {error ? <p className="workout-video-error">{error}</p> : !video ? <p className="workout-video-loading">Loading video…</p> : video.kind === "embed" ? <div className="workout-video-frame"><iframe ref={embedRef} title="Workout video" src={video.url} referrerPolicy="strict-origin-when-cross-origin" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen onLoad={() => {
      if (video.youtube && running) embedRef.current?.contentWindow?.postMessage(JSON.stringify({ event: "command", func: "playVideo", args: [] }), new URL(video.url).origin);
    }} /></div> : <>
      <video ref={fileRef} src={video.url} controls playsInline onError={() => setError("This video could not be played. Check the file or link format.")} onLoadedMetadata={() => { if (fileRef.current) fileRef.current.playbackRate = speed; if (running) void fileRef.current?.play().catch(() => {}); }} />
      <div className="workout-video-controls"><button onClick={() => seek(-10)}>↶ 10 sec</button><button onClick={() => seek(10)}>10 sec ↷</button><label>Speed <select value={speed} onChange={event => { const next = Number(event.target.value); setSpeed(next); if (fileRef.current) fileRef.current.playbackRate = next; }}>{[0.5, 0.75, 1, 1.25, 1.5, 2].map(value => <option value={value} key={value}>{value}×</option>)}</select></label></div>
    </>}
  </div>;
}
