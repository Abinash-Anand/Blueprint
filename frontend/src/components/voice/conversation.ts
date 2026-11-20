/**
 * Voice conversation mode (Revision v2 plan §11, phase 4): hands-free revision. The question is read aloud, the learner
 * answers by voice, the answer is transcribed and checked as usual, the feedback is read back, and the learner says how
 * it went. Pure helpers only: what to say, and how to understand a short spoken reply. English and German.
 */
import type { SessionFeedback, SessionQuestion } from "../../api/types";

export type Lang = "en" | "de";
export const langOf = (language: string | undefined): Lang => (language === "de" ? "de" : "en");

const LETTERS = "ABCDEFGHIJ";
const T = {
  en: {
    code: "There is code on the screen.", option: "Option", options: "The options:", sayLetter: "Say the letter of your answer.",
    sayAll: "Say every letter that is true.", right: "Right.", notQuite: "Not quite.", correctIs: "The right answer is", correctAre: "The right answers are",
    missing: "Missed:", model: "Model answer:", compare: "Compare with the expected points:", suggested: "Suggested:",
    askResult: "Say okay to accept, or say forgot, struggled, recalled or strong.", askOwn: "How did it go? Say forgot, struggled, recalled or strong.",
    results: ["Forgot", "Struggled", "Recalled", "Strong recall"], mixup: "Common mix-up:", codeAnswer: "This one needs code: type it, then check.",
  },
  de: {
    code: "Auf dem Bildschirm steht Code.", option: "Antwort", options: "Die Antworten:", sayLetter: "Sag den Buchstaben deiner Antwort.",
    sayAll: "Sag jeden Buchstaben, der stimmt.", right: "Richtig.", notQuite: "Nicht ganz.", correctIs: "Richtig ist", correctAre: "Richtig sind",
    missing: "Gefehlt hat:", model: "Musterantwort:", compare: "Vergleiche mit den erwarteten Punkten:", suggested: "Vorschlag:",
    askResult: "Sag okay, um ihn zu übernehmen, oder vergessen, mit Mühe, gewusst oder sicher.", askOwn: "Wie lief es? Sag vergessen, mit Mühe, gewusst oder sicher.",
    results: ["Vergessen", "Mit Mühe", "Gewusst", "Sicher gewusst"], mixup: "Häufige Verwechslung:", codeAnswer: "Hier brauchst du Code: tippe ihn ein und prüfe dann.",
  },
} as const;
export const say = (lang: Lang) => T[lang];

const sentence = (s: string) => (s && !/[.!?:]$/.test(s.trim()) ? `${s.trim()}.` : s.trim());

/** What is read for a question: situation, the question, and for multiple choice the lettered options. */
export function questionSpeech(q: Pick<SessionQuestion, "situation" | "question" | "code" | "options" | "format">, lang: Lang): string {
  const t = T[lang];
  const parts = [sentence(q.situation), q.code ? t.code : "", sentence(q.question)];
  if (q.format !== "OPEN" && q.options.length) {
    parts.push(t.options, ...q.options.map((o, i) => `${t.option} ${LETTERS[i]}: ${sentence(o)}`), q.format === "MULTI" ? t.sayAll : t.sayLetter);
  }
  return parts.filter(Boolean).join(" ");
}

/** What is read after checking: the verdict, the right option or the missed points, the model answer, then the ask. */
export function feedbackSpeech(fb: SessionFeedback, lang: Lang): string {
  const t = T[lang];
  const parts: string[] = [];
  if (fb.format !== "OPEN") {
    parts.push(fb.correct ? t.right : t.notQuite);
    const right = fb.options.map((o, i) => ({ ...o, i })).filter((o) => o.correct);
    if (!fb.correct && right.length) parts.push(`${right.length > 1 ? t.correctAre : t.correctIs} ${right.map((o) => `${LETTERS[o.i]}: ${sentence(o.text)}`).join(" ")}`);
    const explain = right.find((o) => o.chosen) ?? right[0];
    if (explain?.explanation) parts.push(sentence(explain.explanation));
  } else if (fb.evaluation) {
    parts.push(sentence(fb.evaluation.feedback));
    const missed = fb.evaluation.criteria.filter((c) => c.verdict === "MISSING" || c.verdict === "INCORRECT").map((c) => sentence(c.text));
    if (missed.length) parts.push(t.missing, ...missed);
    parts.push(t.model, sentence(fb.modelAnswer.gist));
  } else {
    parts.push(t.compare, ...fb.expected.map(sentence), t.model, sentence(fb.modelAnswer.gist));
  }
  if (((fb.suggested ?? 3) <= 1 || fb.correct === false) && fb.misconceptions[0]) parts.push(t.mixup, sentence(fb.misconceptions[0]));
  parts.push(fb.suggested !== null ? `${t.suggested} ${t.results[fb.suggested]}. ${t.askResult}` : t.askOwn);
  return parts.filter(Boolean).join(" ");
}

const words = (s: string) =>
  s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9ß ]+/g, " ").split(/\s+/).filter(Boolean);

/** Spoken forms of the letters A–J, and of the numbers and ordinals 1–10 (English and German). */
const LETTER_SOUNDS: Record<string, number> = {
  a: 0, ay: 0, eh: 0, b: 1, bee: 1, be: 1, c: 2, see: 2, sea: 2, ce: 2, ze: 2, d: 3, dee: 3, de: 3, e: 4, f: 5, ef: 5, eff: 5,
  g: 6, gee: 6, h: 7, aitch: 7, ha: 7, i: 8, j: 9, jay: 9, jot: 9,
};
const ORDINALS: Record<string, number> = {
  first: 0, erste: 0, ersten: 0, erstes: 0, second: 1, zweite: 1, zweiten: 1, third: 2, dritte: 2, dritten: 2,
  fourth: 3, vierte: 3, vierten: 3, fifth: 4, funfte: 4, funften: 4, sixth: 5, sechste: 5, sechsten: 5,
};
const CARDINALS: Record<string, number> = { one: 0, eins: 0, two: 1, zwei: 1, three: 2, drei: 2, four: 3, vier: 3, five: 4, funf: 4, fuenf: 4, six: 5, sechs: 5 };
const CUE = new Set(["option", "answer", "letter", "antwort", "buchstabe", "choice", "nummer", "number"]);

/**
 * The options a spoken reply chooses, or null when it is unclear. Clear forms win: a letter or number after "option",
 * "answer" and the like, or an ordinal ("the second one"). Otherwise, in a short reply, a bare letter or number ("a" is
 * also an English article, so not in a sentence). Otherwise an option whose words the reply repeats.
 */
export function parseChoice(transcript: string, options: string[], multi: boolean): number[] | null {
  const w = words(transcript);
  if (!w.length) return null;
  const n = options.length;
  const short = w.length <= 4;
  const clear: number[] = [];
  const loose: number[] = [];
  const add = (to: number[], k: number) => k >= 0 && k < n && !to.includes(k) && to.push(k);
  w.forEach((x, i) => {
    const cued = CUE.has(w[i - 1] ?? "");
    const value = x in LETTER_SOUNDS ? LETTER_SOUNDS[x] : x in CARDINALS ? CARDINALS[x] : /^\d+$/.test(x) ? Number(x) - 1 : undefined;
    if (x in ORDINALS) add(clear, ORDINALS[x]);
    else if (value !== undefined && cued) add(clear, value);
    else if (value !== undefined && short) add(loose, value);
  });
  const picks = clear.length ? clear : loose;
  if (picks.length) return multi ? picks.sort((a, b) => a - b) : picks.length === 1 ? picks : null;
  // The option's own words: the best match, if clearly better than the rest.
  const said = new Set(w);
  const scores = options.map((o) => {
    const ow = words(o).filter((x) => x.length > 2);
    return ow.length ? ow.filter((x) => said.has(x)).length / ow.length : 0;
  });
  const best = Math.max(...scores);
  const at = scores.indexOf(best);
  return best >= 0.6 && scores.filter((s) => s >= best - 0.15).length === 1 ? [at] : null;
}

const RESULT_WORDS: [number, string[]][] = [
  [0, ["forgot", "forgotten", "forget", "vergessen", "nichts"]],
  [1, ["struggled", "struggle", "struggling", "hard", "muhe", "muehe", "schwer", "schwierig"]],
  [3, ["strong", "stark", "sicher", "easy", "leicht"]],
  [2, ["recalled", "recall", "remembered", "gewusst", "erinnert"]],
];
const ACCEPT = new Set(["ok", "okay", "yes", "yeah", "yep", "accept", "fine", "agree", "continue", "next", "ja", "weiter", "passt", "gut", "einverstanden", "genau", "stimmt"]);
const REPEAT = new Set(["repeat", "again", "nochmal", "wiederholen", "wiederhole"]);

/** A spoken result: one of the four results, "okay" for the suggestion, "repeat", or null when unclear. */
export function parseResult(transcript: string, suggested: number | null): number | "repeat" | null {
  const w = words(transcript);
  for (const [value, forms] of RESULT_WORDS) if (w.some((x) => forms.includes(x))) return value;
  if (w.some((x) => REPEAT.has(x))) return "repeat";
  if (suggested !== null && w.some((x) => ACCEPT.has(x))) return suggested;
  return null;
}
