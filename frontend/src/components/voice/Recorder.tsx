/**
 * Bounded voice recording (AI design §4.2): start, stop or cancel; the timer and level show that the microphone is
 * live; it stops by itself at the limit and never listens in the background. The recording is converted to WAV,
 * sent once for transcription and then dropped. Errors leave typing available.
 */
import { type CSSProperties, useEffect, useRef, useState } from "react";
import { ApiError, api } from "../../api/client";
import { toWav } from "../../lib/wav";
import { FeedbackMessage, LoadingState } from "../Status";

const BARS = 14;
/** Input level (0..1) that counts as speech for stopping after silence. */
const SPEECH_LEVEL = 0.18;

type State = "idle" | "recording" | "working";

export const canRecord = () =>
  typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof window !== "undefined" && "MediaRecorder" in window;

export function Recorder({
  scheduleId,
  transcribe,
  maxSeconds,
  maxBytes,
  label = "Answer by voice",
  workingText = "Transcribing your answer…",
  onTranscript,
  autoStart = false,
  stopAfterSilenceMs,
}: {
  /** The revision unit the answer belongs to (answers are transcribed for it)… */
  scheduleId?: number;
  /** …or any other transcription, e.g. dictating a new city's goal. */
  transcribe?: (wav: Blob) => Promise<{ text: string }>;
  maxSeconds: number;
  maxBytes: number;
  label?: string;
  workingText?: string;
  onTranscript: (text: string) => void;
  /** Conversation mode: start listening as soon as this appears (the learner switched the mode on themselves). */
  autoStart?: boolean;
  /** Conversation mode: stop by itself after this much quiet, once something was said. */
  stopAfterSilenceMs?: number;
}) {
  const [state, setState] = useState<State>("idle");
  const [elapsed, setElapsed] = useState(0);
  // Recent input levels (0..1), newest last: a live waveform that shows the microphone is really hearing you.
  const [levels, setLevels] = useState<number[]>(() => Array(BARS).fill(0));
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
      let last = 0;
      let heard = false;
      let loudAt = 0;
      const tick = (t = 0) => {
        // About 12 samples a second: enough to read as a waveform, cheap enough not to re-render every frame.
        if (t - last >= 80) {
          last = t;
          an.getByteTimeDomainData(data);
          let peak = 0;
          for (const x of data) peak = Math.max(peak, Math.abs(x - 128));
          const v = Math.min(1, (peak / 128) * 1.8);
          setLevels((l) => [...l.slice(1), v]);
          if (stopAfterSilenceMs) {
            if (v > SPEECH_LEVEL) {
              heard = true;
              loudAt = t;
            } else if (heard && t - loudAt > stopAfterSilenceMs && mr.state === "recording") mr.stop();
          }
        }
        r.raf = requestAnimationFrame(tick);
      };
      tick();
    } catch {
      /* the level meter is optional */
    }
    setElapsed(0);
    setLevels(Array(BARS).fill(0));
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
      const t = transcribe ? await transcribe(wav) : await api.transcribe(scheduleId!, wav);
      if (!t.text.trim()) setError("No speech was recognised. Try again closer to the microphone, or type.");
      else onTranscript(t.text.trim());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "The recording could not be processed. Type your answer instead.");
    } finally {
      setState("idle");
    }
  }

  const stop = () => rec.current?.mr.state === "recording" && rec.current.mr.stop();
  const started = useRef(false);
  useEffect(() => {
    if (!autoStart || started.current) return;
    started.current = true;
    void start();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, when it appears
  }, [autoStart]);
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
          <span className="rv-live rec" role="status">
            <span className="rv-dot on" aria-hidden="true" /> Recording {mmss(elapsed)} / {mmss(maxSeconds)}
            <span className="rv-wave" aria-hidden="true">
              {levels.map((l, i) => <i key={i} style={{ "--l": Math.max(0.12, l) } as CSSProperties} />)}
            </span>
          </span>
          <button type="button" className="btn primary" onClick={stop}>Stop</button>
          <button type="button" className="btn" onClick={cancel}>Cancel</button>
        </>
      )}
      {state === "working" && <LoadingState tone="ai" text={workingText} />}
      {error && <FeedbackMessage tone="danger" className="rv-rec-err" onDismiss={() => setError(null)}>{error}</FeedbackMessage>}
    </div>
  );
}
