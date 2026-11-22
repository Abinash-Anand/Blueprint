/**
 * Deterministic provider for tests, offline development and demos (AI design §6.2). It never calls a network.
 * Evaluation: a criterion is COVERED when most of its significant words appear in the answer, PARTIAL when some do.
 * Transcription: AI_FAKE_TRANSCRIPT, or a fixed sentence naming the recording length.
 */
import type { EvaluateInput, EvaluationProvider, GenerateInput, GenerationProvider, TranscribeInput, TranscriptionProvider } from "./types.js";
import { ProviderError } from "./types.js";

const tag = (text: string, name: string) => new RegExp(`<${name}>\\n([\\s\\S]*?)\\n</${name}>`).exec(text)?.[1] ?? "";
const words = (s: string) => s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
const STOP = new Set(["with", "that", "this", "from", "into", "only", "when", "what", "which", "their", "there", "they", "then", "than", "have", "does", "each", "used", "uses", "using", "over", "more", "less", "about", "your", "make", "makes", "sure", "like"]);

const unq = (x: string) => x.replace(/‹/g, "<");

/** Recall checklist (docs/Recall-Plan.md §4.1): six points named after the sub-topic, tiers 1, 1, 2, 2, 2, 3. */
function fakeChecklist(user: string) {
  const sub = tag(user, "subtopic");
  const aspects: [number, string][] = [[1, "definition"], [1, "purpose"], [2, "mechanism"], [2, "usage"], [2, "syntax"], [3, "pitfalls"]];
  return { points: aspects.map(([tier, a]) => ({ label: `${sub} ${a}`, description: `Explains the ${a} of ${sub}.`, tier })) };
}

/**
 * Recall grading (§5.3): a point is ACCURATE when its aspect word (the last word of its label) is in the explanation,
 * quoting that word as it was written; a sentence starting "Wrong:" is a misconception.
 */
function fakeGrade(user: string) {
  const explanation = tag(user, "explanation");
  const points = tag(user, "checklist").split("\n").filter(Boolean).map((line) => {
    const [code, rest] = [line.slice(0, line.indexOf(":")), line.slice(line.indexOf(":") + 1)];
    const aspect = rest.split(".")[0].trim().split(/\s+/).pop() ?? "";
    const hit = aspect ? explanation.match(new RegExp(`\\b${aspect}\\b`, "i"))?.[0] : undefined;
    return { code, status: hit ? "ACCURATE" : "MISSED", evidence: hit ?? "" };
  });
  const misconceptions = [...explanation.matchAll(/Wrong:[^.]*\./g)].map((m) => ({ claim: m[0], correction: "That is not right." }));
  return { points, misconceptions };
}

/** Statements: each point's description without its "Explains the" ("Explains the usage of X." → "The usage of X."). */
function fakeStatements(user: string) {
  const statements = tag(user, "points").split("\n").filter(Boolean).map((line) => {
    const code = line.slice(0, line.indexOf(":"));
    const description = line.slice(line.indexOf(". ") + 2).trim();
    return { code, statement: description.replace(/^Explains the /, "The ") };
  });
  return { statements };
}

function fakeGenerate(i: GenerateInput): { output: unknown; usage: { inputTokens: number; outputTokens: number } } {
  const usage = { inputTokens: Math.ceil(i.user.length / 4), outputTokens: 900 };
  const stage = tag(i.user, "stage");
  if (stage === "recall-checklist") return { usage, output: fakeChecklist(i.user) };
  if (stage === "recall-grade") return { usage, output: fakeGrade(i.user) };
  if (stage === "recall-statements") return { usage, output: fakeStatements(i.user) };
  // Confirms every flagged claim except one that says it is "actually true" (so tests can see a false flag dropped).
  if (stage === "recall-misconception-check") {
    const claims = tag(i.user, "claims").split("\n").filter(Boolean).map((l) => {
      const n = Number(l.match(/^(\d+)\./)?.[1] ?? 0);
      const wrong = !/actually true/i.test(l);
      return { index: n, wrong, reason: wrong ? "It is false." : "It is true." };
    });
    return { usage, output: { claims } };
  }
  // Recall phase 2: a probe naming the first gap's aspect, a verdict from the lists it was given, a progress note.
  if (stage === "recall-probe") {
    const first = tag(i.user, "gaps").split("\n")[0] ?? "";
    return { usage, output: { questions: [`In a real project, how would you handle the ${first.split(":")[1]?.split(".")[0]?.trim().split(/\s+/).pop() ?? "gap"}?`] } };
  }
  if (stage === "recall-verdict") {
    const u = tag(i.user, "unprompted");
    const line = (k: string) => (u.match(new RegExp(`^${k}: (.*)$`, "m"))?.[1] ?? "(none)");
    return { usage, output: { foundationsSummary: `Solid: ${line("recalled")}.`, architectureAndEdgeCasesSummary: `Needs work: ${line("missed")}.`, focusNext: `Revise ${line("missed").split(";")[0]}.` } };
  }
  if (stage === "recall-narrative") return { usage, output: { sentences: ["Your recall of this sub-topic changed since last time.", `Facts: ${tag(i.user, "diff").slice(0, 80)}`] } };
  // Recall phase 3: the fake cannot see the photo; it describes what it was given.
  if (stage === "recall-sketch")
    return { usage, output: i.images?.length ? { readable: true, lines: [`Box: mechanism (sketch of ${i.images[0].data.length} bytes)`, "Arrow: mechanism → usage"] } : { readable: false, lines: [] } };
  if (stage === "outline") {
    let a: { goal?: string; subjects?: string[] } = {};
    try {
      a = JSON.parse(tag(i.user, "answers").replace(/‹/g, "<"));
    } catch {
      /* keep defaults */
    }
    const subjects = (a.subjects?.length ? a.subjects : ["Basics", "Practice", "Projects"]).slice(0, 3);
    while (subjects.length < 3) subjects.push(`Part ${subjects.length + 1}`);
    return {
      usage,
      output: {
        title: (a.goal || "Learning city").slice(0, 80),
        districts: subjects.map((name, di) => ({
          key: `d${di + 1}`, name, subtitle: `All about ${name}`, goal: `Use ${name} confidently.`,
          topics: [1, 2, 3].map((n) => ({ key: `d${di + 1}-t${n}`, name: `${name} ${n}`, priority: n === 3 ? "OPTIONAL" : "CORE", hours: 4 })),
        })),
      },
    };
  }
  const topics = JSON.parse(tag(i.user, "topics").replace(/‹/g, "<")) as { key: string; name: string }[];
  return {
    usage,
    output: {
      topics: topics.map((t, n) => ({
        key: t.key,
        description: `${t.name} explained step by step.`,
        subtopics: [`${t.name}: ideas`, `${t.name}: practice`],
        exercise: `Build a small example that uses ${t.name}.`,
        dependsOn: n > 0 ? [topics[n - 1].key] : [],
        question: { title: t.name, content: `Explain ${t.name} in your own words.`, method: "CONCEPTUAL", expected: "What it is · Why it matters · One example" },
      })),
    },
  };
}

/**
 * "Here's what I understood" for a new city (AI design §10.4): the subjects are the plan's "Phase …" or "Month …" lines
 * when there is a plan, otherwise three generic ones, so tests can see that the plan reached the model.
 */
function fakeUnderstand(i: EvaluateInput) {
  const goal = tag(i.user, "goal").replace(/‹/g, "<");
  const plan = tag(i.user, "plan").replace(/‹/g, "<");
  const phases = [...plan.matchAll(/^(?:phase|month)\s*\d+\s*[:–-]\s*(.+)$/gim)].map((m) => m[1].trim().slice(0, 40)).slice(0, 7);
  const first = goal.split(/\s+/).slice(0, 3).join(" ") || "My goal";
  return {
    output: {
      name: first.slice(0, 60), category: "Learning", goal: goal.slice(0, 200) || "Learn something new",
      currentLevel: /\bA2\b/.test(goal) ? "A2" : "Beginner", targetLevel: /\bC1\b/.test(goal) ? "C1" : "Confident",
      subjects: phases.length ? phases : ["Basics", "Practice", "Projects"],
      alreadyKnown: [], resources: /podcast/i.test(goal) ? ["Podcasts"] : [],
      focusOptions: ["Everyday use", "Exam"],
      questions: [{ question: "What matters most to you?", options: ["Speaking", "Exam", "Both"] }],
      plan: phases.length ? `${phases.length} phases` : null,
      planMonths: phases.length ? phases.length * 3 : null,
      estimatedHours: 120,
    },
    usage: { inputTokens: Math.ceil(i.user.length / 4), outputTokens: 150 },
  };
}

export function fakeProvider(transcript = process.env.AI_FAKE_TRANSCRIPT || undefined): TranscriptionProvider & EvaluationProvider & GenerationProvider {
  return {
    name: "fake",
    images: true,
    async generate(i: GenerateInput) {
      if (i.signal.aborted) throw new ProviderError("TIMEOUT", "aborted");
      return fakeGenerate(i);
    },
    async transcribe(i: TranscribeInput) {
      if (i.signal.aborted) throw new ProviderError("TIMEOUT", "aborted");
      return { text: transcript ?? `This is a fake transcript of a ${i.audioSeconds}-second recording.`, usage: { audioSeconds: i.audioSeconds } };
    },
    async evaluate(i: EvaluateInput) {
      if (i.signal.aborted) throw new ProviderError("TIMEOUT", "aborted");
      if (i.user.startsWith("<goal>")) return fakeUnderstand(i);
      const criteria = tag(i.user, "criteria").split("\n").filter(Boolean).map((l) => l.replace(/^\d+\.\s*/, ""));
      const answer = [tag(i.user, "answer"), tag(i.user, "follow_up_answer")].filter((s) => s && s !== "(empty)").join("\n");
      const answerWords = new Set(words(answer));
      const verdicts = criteria.map((c, index) => {
        const sig = [...new Set(words(c).filter((w) => w.length > 3 && !STOP.has(w)))];
        const hits = sig.filter((w) => answerWords.has(w));
        const share = sig.length ? hits.length / sig.length : 0;
        const verdict = share >= 0.6 ? "COVERED" : share > 0 ? "PARTIAL" : "MISSING";
        // Quote the first matching word as it appears in the answer, so the quote check passes.
        const quote = hits[0] ? (answer.match(new RegExp(`[\\p{L}\\p{N}]*${hits[0]}[\\p{L}\\p{N}]*`, "iu"))?.[0] ?? null) : null;
        return { index, verdict, evidence: verdict === "MISSING" ? null : quote };
      });
      const firstGap = verdicts.find((v) => v.verdict !== "COVERED");
      const followUp = i.user.includes("<follow_up_question>");
      return {
        output: {
          relevant: answerWords.size >= 3,
          criteria: verdicts,
          misconceptions: [],
          feedback: firstGap ? `You covered ${verdicts.filter((v) => v.verdict === "COVERED").length} of ${verdicts.length} points. The main gap: ${criteria[firstGap.index]}.` : "You covered every point.",
          followUpQuestion: !followUp && firstGap ? `Can you say more about point ${firstGap.index + 1}?` : null,
        },
        usage: { inputTokens: Math.ceil(i.user.length / 4), outputTokens: 200 },
      };
    },
  };
}
