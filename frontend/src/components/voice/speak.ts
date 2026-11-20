/**
 * Read text aloud with the browser's own speech synthesis (AI design §3.2): local, free and offline with installed
 * voices. Text always stays on screen; when the browser has no speech support the read-aloud controls are hidden.
 *
 * One thing is read at a time. A small store tells every player what is being read and whether it is paused, so each
 * can show play, pause, resume and stop for its own text. The speed is remembered on this device.
 */
export const canSpeak = () => typeof window !== "undefined" && "speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined";

export type SpeechState = { id: string | null; paused: boolean };
let state: SpeechState = { id: null, paused: false };
const listeners = new Set<(s: SpeechState) => void>();
const set = (s: SpeechState) => {
  state = s;
  listeners.forEach((f) => f(s));
};
export const speechState = () => state;
export function onSpeech(f: (s: SpeechState) => void) {
  listeners.add(f);
  return () => void listeners.delete(f);
}

export const RATES = [0.85, 1, 1.25, 1.5] as const;
const RATE_KEY = "blueprint.speechRate";
export function speechRate(): number {
  try {
    const r = Number(localStorage.getItem(RATE_KEY));
    return (RATES as readonly number[]).includes(r) ? r : 1;
  } catch {
    return 1;
  }
}
export function setSpeechRate(r: number) {
  try {
    localStorage.setItem(RATE_KEY, String(r));
  } catch {
    /* storage unavailable: the speed lasts for this page only */
  }
}

/** A pack's language ("en", "de") as a voice locale; a full locale passes through. */
export const voiceLang = (language: string | undefined) => (language === "de" ? "de-DE" : !language || language === "en" ? "en-GB" : language);

/**
 * Reads `text`, stopping anything else that is being read. `id` names the player that started it. `onEnd` runs once
 * when this text has been read to the end (not when it is stopped or replaced): conversation mode listens then.
 */
export function speak(text: string, lang = "en-GB", id = "default", onEnd?: () => void) {
  if (!canSpeak() || !text.trim()) {
    onEnd?.();
    return;
  }
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = lang;
  u.rate = speechRate();
  const mine = () => state.id === id;
  u.onend = () => {
    if (!mine()) return;
    set({ id: null, paused: false });
    onEnd?.();
  };
  u.onerror = () => mine() && set({ id: null, paused: false });
  set({ id, paused: false });
  window.speechSynthesis.speak(u);
}

export function pauseSpeaking() {
  if (!canSpeak() || !state.id) return;
  window.speechSynthesis.pause();
  set({ ...state, paused: true });
}

export function resumeSpeaking() {
  if (!canSpeak() || !state.id) return;
  window.speechSynthesis.resume();
  set({ ...state, paused: false });
}

export function stopSpeaking() {
  if (canSpeak()) window.speechSynthesis.cancel();
  if (state.id) set({ id: null, paused: false });
}
