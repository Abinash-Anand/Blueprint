/**
 * Read text aloud with the browser's own speech synthesis (AI design §3.2): local, free and offline with installed
 * voices. Text always stays on screen; when the browser has no speech support the read-aloud buttons are hidden.
 */
export const canSpeak = () => typeof window !== "undefined" && "speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined";

export function speak(text: string, lang = "en-GB") {
  if (!canSpeak() || !text.trim()) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = lang;
  u.rate = 1;
  window.speechSynthesis.speak(u);
}

export function stopSpeaking() {
  if (canSpeak()) window.speechSynthesis.cancel();
}
