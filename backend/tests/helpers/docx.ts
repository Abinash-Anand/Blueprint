/** A minimal Word document (.docx) for tests: a zip with [Content_Types].xml and word/document.xml. */
import { deflateRawSync } from "node:zlib";

function zip(files: { name: string; data: Buffer; deflate?: boolean }[]) {
  const locals: Buffer[] = [], centrals: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const body = f.deflate === false ? f.data : deflateRawSync(f.data);
    const name = Buffer.from(f.name, "utf8");
    const method = f.deflate === false ? 0 : 8;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(method, 8);
    local.writeUInt32LE(0, 14); local.writeUInt32LE(body.length, 18); local.writeUInt32LE(f.data.length, 22);
    local.writeUInt16LE(name.length, 26); local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(method, 10);
    central.writeUInt32LE(0, 16); central.writeUInt32LE(body.length, 20); central.writeUInt32LE(f.data.length, 24);
    central.writeUInt16LE(name.length, 28); central.writeUInt32LE(offset, 42);
    locals.push(local, name, body);
    centrals.push(central, name);
    offset += 30 + name.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Each paragraph becomes a <w:p>; a "\t" inside a paragraph becomes <w:tab/>. */
export function docxWithParagraphs(paragraphs: string[], opts: { deflate?: boolean; extraXml?: string } = {}) {
  const body = paragraphs
    .map((p) => `<w:p><w:r>${p.split("\t").map((x) => `<w:t xml:space="preserve">${esc(x)}</w:t>`).join("<w:tab/>")}</w:r></w:p>`)
    .join("");
  const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}${opts.extraXml ?? ""}</w:body></w:document>`;
  return zip([
    { name: "[Content_Types].xml", data: Buffer.from('<?xml version="1.0"?><Types/>'), deflate: false },
    { name: "word/document.xml", data: Buffer.from(xml, "utf8"), deflate: opts.deflate },
  ]);
}
