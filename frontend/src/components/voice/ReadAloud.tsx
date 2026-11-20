/**
 * A small read-aloud player: Read aloud, then Pause / Resume and Stop while it reads, and the speed. Only one text is
 * read at a time; starting another stops this one. Hidden where the browser cannot speak.
 */
import { useEffect, useId, useState } from "react";
import { RATES, canSpeak, onSpeech, pauseSpeaking, resumeSpeaking, setSpeechRate, speak, speechRate, speechState, stopSpeaking, voiceLang } from "./speak";

export function ReadAloud({ text, label = "Read aloud", what = "this", lang }: { text: string; label?: string; what?: string; lang?: string }) {
  const id = useId();
  const [s, setS] = useState(speechState());
  const [rate, setRate] = useState(speechRate());
  useEffect(() => onSpeech(setS), []);
  // Leaving the screen stops what this player was reading.
  useEffect(() => () => {
    if (speechState().id === id) stopSpeaking();
  }, [id]);
  if (!canSpeak()) return null;
  const mine = s.id === id;
  const changeRate = (r: number) => {
    setRate(r);
    setSpeechRate(r);
    if (mine) speak(text, voiceLang(lang), id); // the new speed applies from the start of this text
  };
  return (
    <span className={`ra${mine ? " on" : ""}`} role="group" aria-label={`Read ${what} aloud`}>
      {!mine ? (
        <button type="button" className="link ra-play" onClick={() => speak(text, voiceLang(lang), id)} aria-label={`Read ${what} aloud`}>▶ {label}</button>
      ) : (
        <>
          <span className="ra-live" aria-live="polite">{s.paused ? "Paused" : "Reading…"}</span>
          {s.paused
            ? <button type="button" className="ra-btn" onClick={resumeSpeaking} aria-label="Resume reading">▶</button>
            : <button type="button" className="ra-btn" onClick={pauseSpeaking} aria-label="Pause reading">❚❚</button>}
          <button type="button" className="ra-btn" onClick={stopSpeaking} aria-label="Stop reading">■</button>
          <select className="ra-rate" value={rate} onChange={(e) => changeRate(Number(e.target.value))} aria-label="Reading speed">
            {RATES.map((r) => <option key={r} value={r}>{r}×</option>)}
          </select>
        </>
      )}
    </span>
  );
}
