/**
 * Images as revision material (Revision v2 plan §5.1, phase 4): a photo of handwritten notes, a screenshot of slides or
 * a diagram. The generation model (it reads images) writes out what the image says, once, at upload; only that text is
 * kept, like the text of a PDF. The image itself is never stored.
 */
import { MATERIAL } from "./material.js";

export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export type ImageType = (typeof IMAGE_TYPES)[number];

/** The image type from the file's first bytes (not its name or declared type), or null if it is not one we read. */
export function imageType(buf: Buffer): ImageType | null {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length >= 12 && buf.subarray(0, 4).toString("latin1") === "RIFF" && buf.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  return null;
}

export const IMAGE_PROMPT_VERSION = "material-image-v1";

/** Strict JSON ends a string at its first line break with GWDG, so the text comes back line by line. */
export const IMAGE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["readable", "lines"],
  properties: {
    readable: { type: "boolean", description: "false when the image holds no study content that can be read" },
    lines: { type: "array", maxItems: 400, items: { type: "string", maxLength: 600 }, description: "the text, one line per item" },
  },
} as const;

export function imagePrompt(topicName: string, fileName: string) {
  return {
    system: [
      "You read a learner's own study material from an image: a photo of notes (often handwritten), a screenshot of slides, a page, code or a diagram.",
      "Write out everything the image says, as written and in its own language. Do not translate, correct, summarise, explain or add anything.",
      "Keep the structure as Markdown: headings, lists and tables. Put code in a fenced code block, keeping each line.",
      "For a diagram, figure or drawing write one line: [Diagram: what it shows, with its labels and arrows].",
      "Mark a word you cannot read as [?]. Leave out anything that is not study content (page numbers, app buttons, browser tabs).",
      "If the image holds no study content you can read, set readable to false and lines to [].",
      "Return the text line by line in lines: one array item per line, no line breaks inside an item.",
    ].join("\n"),
    user: [
      "<stage>\nimage-text\n</stage>",
      `<topic>\n${topicName.replace(/[<>]/g, "")}\n</topic>`,
      `<file>\n${fileName.replace(/[<>]/g, "")}\n</file>`,
      "Write out the study material in the attached image.",
    ].join("\n"),
  };
}

/** The model's reply as material text, or null when nothing readable came back. */
export function imageReply(output: unknown): string | null {
  const o = output as { readable?: unknown; lines?: unknown };
  if (!o || typeof o !== "object" || o.readable !== true || !Array.isArray(o.lines)) return null;
  // Lighter than the PDF clean-up: code keeps its indentation.
  const text = o.lines
    .filter((l): l is string => typeof l === "string")
    .map((l) => l.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").replace(/\s+$/, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MATERIAL.maxChars);
  return text.length >= MATERIAL.minChars ? text : null;
}
