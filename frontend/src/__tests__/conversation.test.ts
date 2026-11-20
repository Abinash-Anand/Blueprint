/** Voice conversation mode (Revision v2 phase 4): what is read aloud, and how short spoken replies are understood. */
import { describe, expect, it } from "vitest";
import type { SessionFeedback } from "../api/types";
import { feedbackSpeech, langOf, parseChoice, parseResult, questionSpeech } from "../components/voice/conversation";

const OPTS = ["It runs once per subscriber", "It shares one execution", "It never completes", "It caches the last value"];

describe("understanding a spoken choice", () => {
  it("takes a letter in a short reply or after a cue word, an ordinal anywhere, or a number", () => {
    expect(parseChoice("B.", OPTS, false)).toEqual([1]);
    expect(parseChoice("Bee", OPTS, false)).toEqual([1]);
    expect(parseChoice("I'd go with answer c, because it never ends", OPTS, false)).toEqual([2]);
    expect(parseChoice("the second one", OPTS, false)).toEqual([1]);
    expect(parseChoice("Die vierte", OPTS, false)).toEqual([3]);
    expect(parseChoice("Antwort A", OPTS, false)).toEqual([0]);
    expect(parseChoice("three", OPTS, false)).toEqual([2]);
  });

  it("does not read the English article as option A in a sentence", () => {
    expect(parseChoice("I think it runs once per subscriber, a fresh run each time", OPTS, false)).toEqual([0]); // matched by its words, not the article
    expect(parseChoice("this is a guess and I really do not know", OPTS, false)).toBeNull();
  });

  it("takes several letters for select-all, but not for a single choice", () => {
    expect(parseChoice("a and c", OPTS, true)).toEqual([0, 2]);
    expect(parseChoice("a and c", OPTS, false)).toBeNull();
  });

  it("matches an option by its own words, only when one option clearly fits", () => {
    expect(parseChoice("it caches the last value", OPTS, false)).toEqual([3]);
    expect(parseChoice("hmm", OPTS, false)).toBeNull();
    expect(parseChoice("", OPTS, false)).toBeNull();
    expect(parseChoice("option F", OPTS, false)).toBeNull(); // only four options
  });
});

describe("understanding a spoken result", () => {
  it("knows the four results in English and German, okay for the suggestion, and repeat", () => {
    expect(parseResult("Forgot.", 2)).toBe(0);
    expect(parseResult("I struggled a bit", null)).toBe(1);
    expect(parseResult("recalled", null)).toBe(2);
    expect(parseResult("Strong recall", null)).toBe(3);
    expect(parseResult("mit Mühe", null)).toBe(1);
    expect(parseResult("sicher gewusst", null)).toBe(3);
    expect(parseResult("Okay.", 2)).toBe(2);
    expect(parseResult("ja, weiter", 1)).toBe(1);
    expect(parseResult("okay", null)).toBeNull(); // nothing suggested: the learner has to say it
    expect(parseResult("say that again", 2)).toBe("repeat");
    expect(parseResult("banana", 2)).toBeNull();
  });
});

describe("what is read aloud", () => {
  it("reads a multiple-choice question with lettered options and asks for the letter", () => {
    const text = questionSpeech({ situation: "", question: "What does a cold observable do", code: "of(1)", options: OPTS.slice(0, 2), format: "CHOICE" }, "en");
    expect(text).toBe("There is code on the screen. What does a cold observable do. The options: Option A: It runs once per subscriber. Option B: It shares one execution. Say the letter of your answer.");
    expect(questionSpeech({ situation: "Im Café.", question: "Wie bestellst du?", code: null, options: [], format: "OPEN" }, "de")).toBe("Im Café. Wie bestellst du?");
    expect(langOf("de")).toBe("de");
    expect(langOf(undefined)).toBe("en");
  });

  it("reads the feedback, the missed points, the model answer and asks for the result", () => {
    const fb = {
      format: "OPEN", correct: null, options: [], expected: ["Runs per subscriber"], modelAnswer: { gist: "Each subscriber gets its own run.", full: "…" },
      misconceptions: ["Cold means cached."], suggested: 1,
      evaluation: { feedback: "You named laziness but not the separate runs", criteria: [{ index: 0, text: "Each subscriber gets its own execution", verdict: "MISSING", evidence: null }], misconceptions: [] },
    } as unknown as SessionFeedback;
    expect(feedbackSpeech(fb, "en")).toBe(
      "You named laziness but not the separate runs. Missed: Each subscriber gets its own execution. Model answer: Each subscriber gets its own run. Common mix-up: Cold means cached. Suggested: Struggled. Say okay to accept, or say forgot, struggled, recalled or strong.",
    );
    const choice = { format: "CHOICE", correct: false, options: [{ text: "Yes", correct: false, chosen: true, explanation: "" }, { text: "No", correct: true, chosen: false, explanation: "It never caches" }], misconceptions: [], suggested: 0 } as unknown as SessionFeedback;
    expect(feedbackSpeech(choice, "de")).toBe("Nicht ganz. Richtig ist B: No. It never caches. Vorschlag: Vergessen. Sag okay, um ihn zu übernehmen, oder vergessen, mit Mühe, gewusst oder sicher.");
  });
});
