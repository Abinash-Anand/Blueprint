/**
 * Deterministic provider for tests, offline development and demos (AI design §6.2). It never calls a network.
 * Evaluation: a criterion is COVERED when most of its significant words appear in the answer, PARTIAL when some do.
 * Transcription: AI_FAKE_TRANSCRIPT, or a fixed sentence naming the recording length.
 */
import type { EvaluateInput, EvaluationProvider, TranscribeInput, TranscriptionProvider } from "./types.js";
import { ProviderError } from "./types.js";

const tag = (text: string, name: string) => new RegExp(`<${name}>\\n([\\s\\S]*?)\\n</${name}>`).exec(text)?.[1] ?? "";
const words = (s: string) => s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
const STOP = new Set(["with", "that", "this", "from", "into", "only", "when", "what", "which", "their", "there", "they", "then", "than", "have", "does", "each", "used", "uses", "using", "over", "more", "less", "about", "your", "make", "makes", "sure", "like"]);

export function fakeProvider(transcript = process.env.AI_FAKE_TRANSCRIPT || undefined): TranscriptionProvider & EvaluationProvider {
  return {
    name: "fake",
    async transcribe(i: TranscribeInput) {
      if (i.signal.aborted) throw new ProviderError("TIMEOUT", "aborted");
      return { text: transcript ?? `This is a fake transcript of a ${i.audioSeconds}-second recording.`, usage: { audioSeconds: i.audioSeconds } };
    },
    async evaluate(i: EvaluateInput) {
      if (i.signal.aborted) throw new ProviderError("TIMEOUT", "aborted");
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
