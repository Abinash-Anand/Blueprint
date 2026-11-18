/**
 * Bounded voice recording (AI design §4.2): start, stop or cancel; the timer and level show that the microphone is
 * live; it stops by itself at the limit and never listens in the background. The recording is converted to WAV,
 * sent once for transcription and then dropped. Errors leave typing available.
 */
import { useEffect, useRef, useState } from "react";
import { ApiError, api } from "../../api/client";
import { toWav } from "../../lib/wav";

type State = "idle" | "recording" | "working";

export const canRecord = () =>
  typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof window !== "undefined" && "MediaRecorder" in window;

export function Recorder({
  scheduleId,
  maxSeconds,
  maxBytes,
  label = "Answer by voice",
  onTranscript,
}: {
  scheduleId: number;
  maxSeconds: number;
  maxBytes: number;
  label?: string;
  onTranscript: (text: string) => void;
}) {
  const [state, setState] = useState<State>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<{ mr: MediaRecorder; stream: MediaStream; chunks: Blob[]; cancelled: boolean; timer: number; raf: number; ctx: AudioContext | null } | null>(null);

  const cleanup = () => {
    const r = rec.current;
    if (!r) return;
    window.clearInterval(r.timer);
    cancelAnimationFrame(r.raf);
    r.stream.getTracks().forEach((t) => t.stop());
    void r.ctx?.close();
    rec.current = null;
  };
  useEffect(() => () => {
    if (rec.current) rec.current.cancelled = true;
    if (rec.current?.mr.state === "recording") rec.current.mr.stop();
    cleanup();
  }, []);

  async function start() {
    setError(null);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
    } catch {
      setError("The microphone is blocked or not available. Allow it for this site, or type your answer.");
      return;
    }
    const mr = new MediaRecorder(stream);
    const r = { mr, stream, chunks: [] as Blob[], cancelled: false, timer: 0, raf: 0, ctx: null as AudioContext | null };
    rec.current = r;
    mr.ondataavailable = (e) => e.data.size > 0 && r.chunks.push(e.data);
    mr.onstop = () => void finish(r);
    const t0 = Date.now();
    r.timer = window.setInterval(() => {
      const s = Math.floor((Date.now() - t0) / 1000);
      setElapsed(s);
      if (s >= maxSeconds && mr.state === "recording") mr.stop();
    }, 250);
    try {
      r.ctx = new AudioContext();
      const an = r.ctx.createAnalyser();
      an.fftSize = 512;
      r.ctx.createMediaStreamSource(stream).connect(an);
      const data = new Uint8Array(an.fftSize);
      const tick = () => {
        an.getByteTimeDomainData(data);
        let peak = 0;
        for (const x of data) peak = Math.max(peak, Math.abs(x - 128));
        setLevel(peak / 128);
        r.raf = requestAnimationFrame(tick);
      };
      tick();
    } catch {
      /* the level meter is optional */
    }
    setElapsed(0);
    setState("recording");
    mr.start();
  }

  async function finish(r: NonNullable<typeof rec.current>) {
    const chunks = r.chunks;
    const cancelled = r.cancelled;
    cleanup();
    if (cancelled || chunks.length === 0) {
      setState("idle");
      return;
    }
    setState("working");
    try {
      const { wav } = await toWav(new Blob(chunks, { type: chunks[0].type }));
      if (wav.size > maxBytes) throw new ApiError(413, "AUDIO_TOO_LARGE", "The recording is too long. Keep answers under the time limit.");
      const t = await api.transcribe(scheduleId, wav);
      if (!t.text.trim()) setError("No speech was recognised. Try again closer to the microphone, or type.");
      else onTranscript(t.text.trim());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "The recording could not be processed. Type your answer instead.");
    } finally {
      setState("idle");
    }
  }

  const stop = () => rec.current?.mr.state === "recording" && rec.current.mr.stop();
  const cancel = () => {
    if (!rec.current) return;
    rec.current.cancelled = true;
    stop();
  };

  const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  return (
    <div className="rv-rec">
      {state === "idle" && (
        <button type="button" className="btn" onClick={() => void start()}>
          <span className="rv-dot" aria-hidden="true" /> {label}
        </button>
      )}
      {state === "recording" && (
        <>
          <span className="rv-live" role="status">
            <span className="rv-dot on" aria-hidden="true" /> Recording {mmss(elapsed)} / {mmss(maxSeconds)}
            <span className="rv-level" aria-hidden="true"><i style={{ width: `${Math.min(100, Math.round(level * 160))}%` }} /></span>
          </span>
          <button type="button" className="btn primary" onClick={stop}>Stop</button>
          <button type="button" className="btn" onClick={cancel}>Cancel</button>
        </>
      )}
      {state === "working" && <span className="rv-live" role="status">Transcribing…</span>}
      {error && <span className="rv-err" role="alert">{error}</span>}
    </div>
  );
}
