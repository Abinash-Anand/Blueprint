/**
 * Build professional PDFs from the Markdown sources (the editable source of truth).
 *   cd docs/tools && npm install && npm run build            → docs/SRS.pdf, HLD.pdf, LLD.pdf
 *   CHROME_PATH=/path/to/chrome npm run build                 (if Chrome/Edge is not auto-detected)
 * Pipeline: Markdown → HTML (marked) → Mermaid diagrams rendered to SVG in headless Chrome
 *           → Paged.js pagination (cover, TOC with page numbers, running header, page x / y) → PDF.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Marked } from "marked";
import puppeteer from "puppeteer-core";

const here = dirname(fileURLToPath(import.meta.url));
const docsDir = resolve(here, "..");
const buildDir = join(here, "_build");
mkdirSync(buildDir, { recursive: true });

const DOCS = process.argv.slice(2).length ? process.argv.slice(2) : ["SRS", "HLD", "LLD"];

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter(Boolean);
  const found = candidates.find((p) => existsSync(p));
  if (!found) throw new Error("Chrome/Edge not found. Set CHROME_PATH.");
  return found;
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const slugify = (s) => s.toLowerCase().replace(/<[^>]+>/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function parseFrontMatter(md) {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(md);
  if (!m) return { meta: {}, body: md };
  const meta = {};
  for (const line of m[1].split("\n")) {
    const kv = /^(\w+):\s*"?(.*?)"?\s*$/.exec(line);
    if (kv) meta[kv[1]] = kv[2];
  }
  return { meta, body: md.slice(m[0].length) };
}

function toHtml(name, md) {
  const { meta, body } = parseFrontMatter(md.replace(/\r\n/g, "\n"));
  const toc = [];
  const used = new Set();
  const marked = new Marked({
    gfm: true,
    renderer: {
      heading({ tokens, depth }) {
        const text = this.parser.parseInline(tokens);
        let id = "s-" + (slugify(text) || "section");
        while (used.has(id)) id += "-x";
        used.add(id);
        if (depth <= 2) toc.push({ depth, id, text });
        const cls = depth === 1 && /^Appendix/.test(text) ? ' class="appendix"' : "";
        return `<h${depth} id="${id}"${cls}>${text}</h${depth}>\n`;
      },
      code({ text, lang }) {
        if (lang === "mermaid") return `<figure class="diagram"><pre class="mermaid">${esc(text)}</pre></figure>\n`;
        return `<pre class="code"><code>${esc(text)}</code></pre>\n`;
      },
      table(token) {
        const head = token.header.map((c) => `<th${c.align ? ` style="text-align:${c.align}"` : ""}>${this.parser.parseInline(c.tokens)}</th>`).join("");
        const rows = token.rows
          .map((r) => `<tr>${r.map((c) => `<td${c.align ? ` style="text-align:${c.align}"` : ""}>${this.parser.parseInline(c.tokens)}</td>`).join("")}</tr>`)
          .join("");
        return `<table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>\n`;
      },
    },
  });
  const content = marked.parse(body);
  const tocHtml = toc
    .map((t) => `<li class="toc-l${t.depth}"><a href="#${t.id}"><span class="t">${t.text}</span><span class="dots"></span></a></li>`)
    .join("\n");
  const mermaidJs = pathToFileURL(join(here, "node_modules/mermaid/dist/mermaid.min.js")).href;
  const pagedJs = pathToFileURL(join(here, "node_modules/pagedjs/dist/paged.polyfill.js")).href;
  const title = meta.title ?? name;
  const short = title.split("—").pop().trim();

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>${CSS.replace("%SHORT%", esc(short))}</style>
<script>window.PagedConfig = { auto: false };</script>
<script src="${mermaidJs}"></script>
<script src="${pagedJs}"></script>
</head><body>
<section class="cover">
  <div class="brand">Engineering City</div>
  <div class="title">${esc(title.split("—").pop().trim())}</div>
  <div class="subtitle">${esc(meta.subtitle ?? "")}</div>
  <table class="meta"><tbody>
    <tr><th>Document</th><td>${esc(name)}.md (source of truth) · ${esc(name)}.pdf</td></tr>
    <tr><th>Version</th><td>${esc(meta.version ?? "1.0")}</td></tr>
    <tr><th>Date</th><td>${esc(meta.date ?? "")}</td></tr>
    <tr><th>Related</th><td>SRS.md · HLD.md · LLD.md · DESIGN.md</td></tr>
  </tbody></table>
  <div class="stripe"><i style="background:#7f98a8"></i><i style="background:#8ea58b"></i><i style="background:#c2ab80"></i><i style="background:#9c8ea6"></i><i style="background:#7fa3a1"></i><i style="background:#c4937f"></i><i style="background:#a8a096"></i></div>
</section>
<nav class="toc"><h2 class="toc-title">Contents</h2><ol>${tocHtml}</ol></nav>
<main>${content}</main>
<script>
(async () => {
  try {
    mermaid.initialize({ startOnLoad: false, theme: "base", securityLevel: "strict",
      themeVariables: { fontFamily: "Segoe UI, Roboto, Helvetica, Arial, sans-serif", fontSize: "13px",
        primaryColor: "#eef1f3", primaryBorderColor: "#3f5a66", primaryTextColor: "#2e3133", lineColor: "#6c6f71",
        secondaryColor: "#f6f4ef", tertiaryColor: "#efece6", clusterBkg: "#f6f4ef", clusterBorder: "#d8d3c9" },
      flowchart: { htmlLabels: false, curve: "basis" }, er: { useMaxWidth: true }, sequence: { useMaxWidth: true } });
    await mermaid.run({ querySelector: ".mermaid" });
    window.__mermaidErrors = document.querySelectorAll(".mermaid:not([data-processed])").length;
    await PagedPolyfill.preview();
    window.__done = true;
  } catch (e) { window.__error = String(e && e.stack || e); }
})();
</script>
</body></html>`;
}

const CSS = `
@page { size: A4; margin: 22mm 18mm 20mm 18mm;
  @top-left { content: "Engineering City"; font: 8.5pt "Segoe UI", Roboto, Arial, sans-serif; color: #8a8679; letter-spacing: .08em; text-transform: uppercase; }
  @top-right { content: "%SHORT%"; font: 8.5pt "Segoe UI", Roboto, Arial, sans-serif; color: #8a8679; }
  @bottom-center { content: "Page " counter(page) " of " counter(pages); font: 8.5pt "Segoe UI", Roboto, Arial, sans-serif; color: #6c6f71; }
}
@page :first { @top-left { content: none; } @top-right { content: none; } @bottom-center { content: none; } }
html { font-family: "Segoe UI", Roboto, Helvetica, Arial, sans-serif; font-size: 10pt; color: #2e3133; line-height: 1.5; }
body { margin: 0; }
.cover { break-after: page; padding-top: 55mm; }
.cover .brand { font-size: 10pt; letter-spacing: .16em; text-transform: uppercase; color: #6c6f71; }
.cover .title { font-size: 30pt; font-weight: 650; margin: 6mm 0 3mm; line-height: 1.15; color: #2e3133; border: 0; }
.cover .subtitle { font-size: 13pt; color: #3f5a66; margin-bottom: 14mm; }
.cover table.meta { width: auto; border: 0; font-size: 10pt; }
.cover table.meta th { text-align: left; color: #6c6f71; font-weight: 500; padding: 2mm 8mm 2mm 0; background: none; border: 0; }
.cover table.meta td { border: 0; padding: 2mm 0; }
.cover .stripe { display: flex; margin-top: 30mm; height: 4mm; } .cover .stripe i { flex: 1; }
.toc { break-after: page; }
.toc-title { font-size: 18pt; margin: 0 0 6mm; border: 0; }
.toc ol { list-style: none; padding: 0; margin: 0; }
.toc li { margin: 0; }
.toc li a { color: #2e3133; text-decoration: none; display: flex; }
.toc li a::after { content: target-counter(attr(href), page); color: #6c6f71; min-width: 7mm; text-align: right; }
.toc li a .dots { flex: 1; border-bottom: 0.8pt dotted #b9b4a9; margin: 0 2mm 1.2mm; }
.toc .toc-l1 { font-weight: 600; margin-top: 3mm; }
.toc .toc-l2 { padding-left: 6mm; font-size: 9.5pt; }
h1 { font-size: 17pt; font-weight: 650; margin: 10mm 0 4mm; padding-bottom: 2mm; border-bottom: 1.5pt solid #3f5a66; break-after: avoid; }
h1.appendix { break-before: page; }
main > h1:first-child { margin-top: 0; }
h2 { font-size: 13pt; font-weight: 650; margin: 7mm 0 2.5mm; color: #2e3133; break-after: avoid; }
h3 { font-size: 11pt; font-weight: 650; margin: 5mm 0 2mm; color: #3f5a66; break-after: avoid; }
p { margin: 0 0 2.5mm; orphans: 3; widows: 3; }
ul, ol { margin: 0 0 3mm; padding-left: 6mm; }
li { margin: 0.6mm 0; }
a { color: #3f5a66; }
code { font-family: Consolas, "Cascadia Mono", Menlo, monospace; font-size: 8.8pt; background: #f1efe9; padding: 0 1mm; border-radius: 2px; }
pre.code { background: #f6f4ef; border: 0.5pt solid #d8d3c9; border-left: 2pt solid #3f5a66; padding: 3mm 4mm; font-size: 8.2pt; line-height: 1.4; white-space: pre-wrap; word-break: break-word; border-radius: 2px; }
pre.code code { background: none; padding: 0; font-size: inherit; }
table { width: 100%; border-collapse: collapse; margin: 2mm 0 4mm; font-size: 8.6pt; break-inside: auto; }
thead { display: table-header-group; }
tr { break-inside: avoid; }
th { background: #eef0f1; text-align: left; font-weight: 600; color: #2e3133; }
th, td { border: 0.5pt solid #d8d3c9; padding: 1.4mm 2mm; vertical-align: top; }
blockquote { margin: 3mm 0; padding: 2mm 4mm; border-left: 2pt solid #d8d3c9; color: #4a4d4f; background: #faf9f6; }
figure.diagram { margin: 3mm 0 5mm; padding: 3mm; border: 0.5pt solid #d8d3c9; border-radius: 3px; background: #fcfbf8; break-inside: avoid; text-align: center; }
figure.diagram svg { max-width: 100% !important; height: auto; max-height: 215mm; }
pre.mermaid { margin: 0; font-family: inherit; background: none; border: 0; }
hr { border: 0; border-top: 0.5pt solid #d8d3c9; margin: 5mm 0; }
`;

const chrome = findChrome();
const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ["--allow-file-access-from-files", "--no-sandbox"] });
try {
  for (const name of DOCS) {
    const md = readFileSync(join(docsDir, `${name}.md`), "utf8");
    const htmlPath = join(buildDir, `${name}.html`);
    writeFileSync(htmlPath, toHtml(name, md));
    const page = await browser.newPage();
    page.on("pageerror", (e) => console.error(`[${name}] page error:`, e.message));
    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "load" });
    await page.waitForFunction("window.__done === true || window.__error", { timeout: 180_000 });
    const err = await page.evaluate("window.__error");
    if (err) throw new Error(`${name}: ${err}`);
    const diagrams = await page.evaluate("document.querySelectorAll('figure.diagram svg').length");
    const failed = await page.evaluate("window.__mermaidErrors");
    const out = join(docsDir, `${name}.pdf`);
    await page.pdf({ path: out, preferCSSPageSize: true, printBackground: true });
    const pages = await page.evaluate("document.querySelectorAll('.pagedjs_page').length");
    console.log(`${name}.pdf: ${pages} pages, ${diagrams} diagrams rendered${failed ? `, ${failed} FAILED` : ""}`);
    if (failed) process.exitCode = 1;
    await page.close();
  }
} finally {
  await browser.close();
}
