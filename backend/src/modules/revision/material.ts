/**
 * Revision material (Revision v2 plan §3.2, §5.1): what the learner studied for a topic, as text. Files are read here
 * and dropped; only the extracted text is kept. PDF, plain text and Markdown are read like plan files in city creation
 * (ai/curriculum/intake.ts); HTML and Word (.docx) are read here without running anything from the file.
 */
import { inflateRawSync } from "node:zlib";
import { AttachmentError, cleanText, extractAttachment } from "../ai/curriculum/intake.js";

export const MATERIAL = {
  maxFiles: 6,
  maxBytes: 5 * 1024 * 1024,
  /** Text kept per file or pasted note. */
  maxChars: 100_000,
  /** Material text sent to the AI for the concepts, across all files. */
  promptChars: 40_000,
  /** Fewer characters than this: "no text found" (a scanned PDF, an empty page). */
  minChars: 40,
} as const;

export type MaterialKind = "pdf" | "text" | "html" | "docx";
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export const MATERIAL_TYPES: Record<string, MaterialKind> = {
  "application/pdf": "pdf",
  "text/plain": "text",
  "text/markdown": "text",
  "text/x-markdown": "text",
  "text/html": "html",
  [DOCX]: "docx",
};

/* ---------------- HTML ---------------- */

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", hellip: "…", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“" };
const decode = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : "";
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });

/** The readable text of an HTML page: no scripts, styles or markup; block elements become line breaks. */
export function htmlText(html: string) {
  return cleanText(
    decode(
      html
        .replace(/<!--[\s\S]*?-->/g, " ")
        .replace(/<(script|style|noscript|template|svg|head)\b[\s\S]*?<\/\1\s*>/gi, " ")
        .replace(/<(br|hr)\b[^>]*>/gi, "\n")
        .replace(/<li\b[^>]*>/gi, "\n- ")
        .replace(/<\/?(p|div|section|article|header|footer|main|aside|nav|h[1-6]|ul|ol|li|tr|table|pre|blockquote|dl|dt|dd|figure|figcaption)\b[^>]*>/gi, "\n")
        .replace(/<\/t[dh]\s*>/gi, "\t")
        .replace(/<[^>]*>/g, ""),
    ),
    MATERIAL.maxChars,
  );
}

/* ---------------- Word (.docx) ---------------- */

/** Uncompressed size allowed for the one file read from the archive (a guard against zip bombs). */
const MAX_XML_BYTES = 30 * 1024 * 1024;

/** One entry of a zip archive, read through its central directory (no Zip64: files here are at most 5 MB). */
export function zipEntry(buf: Buffer, name: string): Buffer | null {
  const min = Math.max(0, buf.length - 22 - 0xffff);
  let eocd = -1;
  for (let i = buf.length - 22; i >= min; i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new AttachmentError("UNREADABLE");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw new AttachmentError("UNREADABLE");
    const method = buf.readUInt16LE(p + 10);
    const compressed = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const entry = buf.subarray(p + 46, p + 46 + nameLen).toString("utf8");
    p += 46 + nameLen + extraLen + commentLen;
    if (entry !== name) continue;
    if (size > MAX_XML_BYTES || local + 30 > buf.length || buf.readUInt32LE(local) !== 0x04034b50) throw new AttachmentError("UNREADABLE");
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(start, start + compressed);
    if (data.length !== compressed) throw new AttachmentError("UNREADABLE");
    if (method === 0) return data;
    if (method !== 8) throw new AttachmentError("UNREADABLE");
    try {
      return inflateRawSync(data, { maxOutputLength: MAX_XML_BYTES });
    } catch {
      throw new AttachmentError("UNREADABLE");
    }
  }
  return null;
}

/** The text of a Word document: paragraphs, line breaks and tabs from word/document.xml, nothing else. */
export function docxText(buf: Buffer) {
  if (buf.readUInt32LE(0) !== 0x04034b50) throw new AttachmentError("UNREADABLE");
  const xml = zipEntry(buf, "word/document.xml");
  if (!xml) throw new AttachmentError("UNREADABLE");
  const body = xml.toString("utf8");
  const text = body
    .replace(/<w:tab\/>/g, "\t")
    .replace(/<w:(br|cr)\b[^>]*\/>/g, "\n")
    .replace(/<\/w:p>/g, "\n")
    .replace(/<w:delText\b[^>]*>[\s\S]*?<\/w:delText>/g, "") // deleted text in tracked changes
    .replace(/<w:instrText\b[^>]*>[\s\S]*?<\/w:instrText>/g, "") // field codes
    .replace(/<[^>]+>/g, "");
  return cleanText(decode(text), MATERIAL.maxChars);
}

/* ---------------- any supported file ---------------- */

/** Reads a supported file into text. Throws AttachmentError("UNSUPPORTED" | "UNREADABLE"). */
export async function extractMaterial(buf: Buffer, mimeType: string): Promise<{ text: string; pages: number | null }> {
  const kind = MATERIAL_TYPES[mimeType];
  if (!kind) throw new AttachmentError("UNSUPPORTED");
  if (kind === "pdf" || kind === "text") {
    const r = await extractAttachment(buf, mimeType);
    return { text: r.text.slice(0, MATERIAL.maxChars), pages: r.pages };
  }
  if (kind === "html") {
    if (buf.includes(0)) throw new AttachmentError("UNREADABLE");
    return { text: htmlText(buf.toString("utf8")), pages: null };
  }
  if (buf.length < 30) throw new AttachmentError("UNREADABLE");
  return { text: docxText(buf), pages: null };
}

/** All material text for the AI, file by file, within MATERIAL.promptChars. */
export function materialText(files: { name: string; text: string }[], max: number = MATERIAL.promptChars) {
  let left = max, out = "";
  for (const f of files) {
    if (left <= 0 || f.text.length < MATERIAL.minChars) continue;
    const part = `--- ${f.name} ---\n${f.text.slice(0, left)}`;
    out += (out ? "\n\n" : "") + part;
    left -= part.length;
  }
  return out;
}
