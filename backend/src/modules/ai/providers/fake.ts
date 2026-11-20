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

/**
 * Revision pack concepts (Revision v2 plan §5.1): the material's "## " headings, otherwise the topic's sub-topics, so
 * tests can see where the concepts came from. Always at least three.
 */
function fakeConcepts(user: string) {
  const material = unq(tag(user, "material"));
  let subs: { name: string }[] = [];
  try {
    subs = JSON.parse(unq(tag(user, "subtopics")));
  } catch {
    /* none */
  }
  const heads = [...material.matchAll(/^#{1,3}\s+(.+)$/gm)].map((m) => m[1].trim());
  const titles = (heads.length ? heads : subs.map((x) => x.name)).slice(0, 8);
  while (titles.length < 3) titles.push(`Concept ${titles.length + 1}`);
  return {
    concepts: titles.map((t) => ({
      title: t.slice(0, 100), summary: `What the learner studied about ${t}.`, subtopic: subs.find((x) => x.name === t)?.name ?? subs[0]?.name ?? null,
      keyPoints: [`${t} has a clear purpose`, `${t} is used in practice`], misconceptions: [`Thinking ${t} works by magic`],
    })),
  };
}

const FAKE_OPEN = ["RECALL", "EXPLAIN", "PREDICT", "DEBUG", "APPLY", "TRANSFER"];
const FAKE_CHOICE = ["QUICK_CHOICE", "TRICKY_CHOICE", "WHAT_HAPPENS", "BEST_FIX", "TWO_PART", "SELECT_ALL"];

/**
 * Questions for one concept: for every level asked, one open and one multiple-choice question that pass the pack
 * checks. A concept titled "Broken …" first gets a multiple-choice question with two correct options, so the repair
 * round can be tested; the repair (a request listing problems) is valid.
 */
function fakeItems(user: string) {
  const concept = JSON.parse(unq(tag(user, "concept"))) as { title: string };
  const levels = tag(user, "levels").split(",").map((x) => Number(x.trim())).filter((n) => n >= 1 && n <= 6);
  const repair = user.includes("<problems>");
  const t = concept.title;
  const items = levels.flatMap((level) => {
    const multi = FAKE_CHOICE[level - 1] === "SELECT_ALL";
    const broken = /^broken/i.test(t) && !repair && level === 1;
    return [
      {
        level, kind: FAKE_OPEN[level - 1], situation: "", codeLines: null,
        question: `Level ${level}: what does ${t} do, and why does it matter?`, answerSize: "2-3 sentences",
        expected: [`${t} purpose`, `${t} example`, `${t} limits`], modelAnswer: `${t} solves a specific problem; for example it is used when the situation needs it.`,
        hints: ["Think about the purpose.", "Recall an example.", "Start with: it is used to …"], options: null,
      },
      {
        level, kind: FAKE_CHOICE[level - 1], situation: "", codeLines: null,
        question: `Level ${level}: which statement about ${t} is ${multi ? "true (select all)" : "true"}?`, answerSize: multi ? "pick all that apply" : "pick one",
        expected: [`The right statement names the purpose of ${t}`], modelAnswer: `The statement that names its purpose.`,
        hints: ["Rule out the extreme claims.", "Which one names a purpose?", "It starts with: it is used …"],
        options: [
          { text: `It is used to solve a specific problem`, correct: true, explanation: "Right: that is its purpose." },
          { text: `It works without any setup`, correct: multi || broken, explanation: "A common belief; it needs setup." },
          { text: `It replaces everything else`, correct: false, explanation: "Too strong: it is one tool among others." },
        ],
      },
    ];
  });
  return { items };
}

/**
 * Deterministic curriculum pieces (AI design §10.3), shaped by the request: an outline with three districts of three
 * topics named after the learner's subjects, and the details for whatever topics a district request lists.
 */
function fakeGenerate(i: GenerateInput): { output: unknown; usage: { inputTokens: number; outputTokens: number } } {
  const usage = { inputTokens: Math.ceil(i.user.length / 4), outputTokens: 900 };
  const stage = tag(i.user, "stage");
  if (stage === "pack-concepts") return { usage, output: fakeConcepts(i.user) };
  if (stage === "pack-items") return { usage, output: fakeItems(i.user) };
  // Reading a material image: the fake cannot see it, so it describes what it was given.
  if (stage === "image-text")
    return { usage, output: i.images?.length ? { readable: true, lines: ["# Notes from a photo", `An image of ${i.images[0].data.length} bytes (${i.images[0].mimeType}).`, "- Generics let one function work for many types.", "- extends limits what a type parameter accepts."] } : { readable: false, lines: [] } };
  if (tag(i.user, "stage") === "outline") {
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
