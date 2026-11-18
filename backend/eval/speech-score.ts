/**
 * Scoring for the speech-term test (AI design §9.2). Pure, so it is unit-tested.
 * A term counts only when it appears as written (case and punctuation ignored, word boundaries kept): "switch map"
 * for switchMap is a miss, because that is exactly the error the learner would have to fix by hand.
 */
import { normalise } from "../src/modules/ai/evaluation/verify.js";

export function termFound(transcript: string, term: string) {
  return ` ${normalise(transcript)} `.includes(` ${normalise(term)} `);
}

export function termHits(transcript: string, terms: string[]) {
  const found = terms.filter((t) => termFound(transcript, t));
  return { found, missed: terms.filter((t) => !found.includes(t)) };
}

/** Word error rate: word-level edit distance divided by the number of reference words. */
export function wer(reference: string, hypothesis: string) {
  const r = normalise(reference).split(" ").filter(Boolean);
  const h = normalise(hypothesis).split(" ").filter(Boolean);
  if (r.length === 0) return h.length ? 1 : 0;
  let prev = Array.from({ length: h.length + 1 }, (_, j) => j);
  for (let i = 1; i <= r.length; i++) {
    const cur = [i];
    for (let j = 1; j <= h.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (r[i - 1] === h[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[h.length] / r.length;
}

/** Audio types the speech provider accepts, by file extension. */
export const AUDIO_TYPES: Record<string, string> = {
  ".wav": "audio/wav",
  ".mp3": "audio/mp3",
  ".flac": "audio/flac",
  ".ogg": "audio/ogg",
  ".aac": "audio/aac",
  ".aiff": "audio/aiff",
};
