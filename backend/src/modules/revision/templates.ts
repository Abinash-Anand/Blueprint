/**
 * Reusable prompt templates (Revision spec §4.2, §5.6). A template is rendered for a revision unit; the first time
 * it is used for that unit it is stored as a RevisionPrompt with source TEMPLATE, so attempts can reference it.
 */
import type { RetrievalMethod } from "@prisma/client";

export interface PromptTemplate {
  key: string;
  label: string;
  method: (districtId: string) => RetrievalMethod;
  content: (subject: string) => string;
  expected: string;
}

const fixed = (m: RetrievalMethod) => () => m;
/** Architecture and cloud designs are best retrieved as diagrams; elsewhere a design is code or a schema. */
const designMethod = (districtId: string): RetrievalMethod => (districtId === "ar" || districtId === "cl" ? "VISUAL" : "PRACTICAL");

export const TEMPLATES: PromptTemplate[] = [
  {
    key: "explain",
    label: "Explain",
    method: fixed("CONCEPTUAL"),
    content: (s) => `Without notes, explain ${s} in your own words, as if to a colleague who hasn't met it.`,
    expected: "What it is · the problem it solves · how it works at a high level · one concrete example.",
  },
  {
    key: "why",
    label: "Why",
    method: fixed("CONCEPTUAL"),
    content: (s) => `Why does ${s} exist? What would go wrong, or what would you have to do instead, without it?`,
    expected: "The underlying problem · the alternative and its cost · the risk or effort it removes.",
  },
  {
    key: "how",
    label: "How",
    method: fixed("CONCEPTUAL"),
    content: (s) => `Describe, step by step, how ${s} works internally.`,
    expected: "Steps in the right order · the key data or state involved · where it can fail.",
  },
  {
    key: "compare",
    label: "Compare",
    method: fixed("SCENARIO"),
    content: (s) => `Compare ${s} with a closely related concept or alternative. When would you choose each?`,
    expected: "Names a real alternative · at least two concrete differences · a justified choice for a specific situation.",
  },
  {
    key: "scenario",
    label: "Scenario",
    method: fixed("SCENARIO"),
    content: (s) => `Describe a realistic situation in one of your projects where ${s} matters. What would you do, and why?`,
    expected: "A specific situation · the decision you would make · the reasoning and the trade-off.",
  },
  {
    key: "debug",
    label: "Debug",
    method: fixed("PRACTICAL"),
    content: (s) => `Describe a common mistake or bug involving ${s}: how it shows up, its root cause and the fix. Reproduce it in code if you can.`,
    expected: "A realistic failure · its symptom · the root cause · a correct fix.",
  },
  {
    key: "design",
    label: "Design",
    method: designMethod,
    content: (s) => `Describe a small design that uses ${s}: its parts, how they connect, and your key decisions. Words, a list or a code outline are fine.`,
    expected: "All the main parts · how they connect · at least one justified decision.",
  },
  {
    key: "write",
    label: "Write from memory",
    method: fixed("WRITTEN"),
    content: (s) => `Write a minimal working example of ${s} from memory, without looking anything up.`,
    expected: "Runs or is very close · uses the API or syntax correctly · you can explain every line.",
  },
];

export const templateByKey = new Map(TEMPLATES.map((t) => [t.key, t]));

/** What a template talks about: a sub-topic in its topic, or a whole topic and how its learned parts fit together. */
export function unitSubject(u: { scope: "SUBTOPIC" | "TOPIC"; topicName: string; subtopicName?: string | null; learned?: string[] }) {
  if (u.scope === "SUBTOPIC") return `${u.subtopicName} (${u.topicName})`;
  const parts = u.learned ?? [];
  return parts.length >= 2 ? `${u.topicName}, and how ${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]} work together` : u.topicName;
}
