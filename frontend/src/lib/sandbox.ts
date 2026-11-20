/**
 * Running a code answer in the browser (Revision v2 plan §11, phase 4). Nothing is sent to the server: the code is
 * turned from TypeScript into plain JavaScript here, then runs in public/sandbox.html inside an
 * <iframe sandbox="allow-scripts"> (an opaque origin: no cookies, storage or access to this page) whose own policy
 * allows no network, in a Web Worker that is ended after five seconds. Only the printed text comes back.
 */

export type RunLine = { kind: "log" | "info" | "warn" | "error"; text: string };
export type RunResult = { lines: RunLine[]; error: string | null; timedOut: boolean; truncated: boolean; ms: number };

type Ts = typeof import("typescript");
let tsModule: Promise<Ts> | null = null;
/** The TypeScript compiler, loaded the first time code is run (a large file: never part of the main bundle). */
const loadTs = () => (tsModule ??= import("typescript").then((m) => ((m as unknown as { default?: Ts }).default ?? m)));

/** TypeScript (or JavaScript) to plain JavaScript, or the first syntax error with its line. Exported for tests. */
export function toJavaScript(ts: Ts, code: string): { js: string } | { error: string } {
  const out = ts.transpileModule(code, {
    reportDiagnostics: true,
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, experimentalDecorators: true, jsx: ts.JsxEmit.React, removeComments: false },
  });
  const d = out.diagnostics?.find((x) => x.category === ts.DiagnosticCategory.Error);
  if (d) {
    const line = d.file && d.start !== undefined ? d.file.getLineAndCharacterOfPosition(d.start).line + 1 : null;
    return { error: `${line ? `Line ${line}: ` : ""}${ts.flattenDiagnosticMessageText(d.messageText, " ")}` };
  }
  return { js: out.outputText };
}

/* ---------------- the sandbox frame ---------------- */

let frame: Promise<HTMLIFrameElement> | null = null;
let nextId = 1;
const waiting = new Map<number, (r: RunResult) => void>();

function sandbox(): Promise<HTMLIFrameElement> {
  if (frame) return frame;
  frame = new Promise((resolve, reject) => {
    const f = document.createElement("iframe");
    f.setAttribute("sandbox", "allow-scripts");
    f.setAttribute("aria-hidden", "true");
    f.tabIndex = -1;
    f.title = "Code sandbox";
    f.style.cssText = "position:absolute;width:0;height:0;border:0;visibility:hidden";
    const timer = window.setTimeout(() => {
      frame = null;
      f.remove();
      reject(new Error("The code sandbox didn't start."));
    }, 10_000);
    window.addEventListener("message", (e) => {
      if (e.source !== f.contentWindow) return; // only the sandbox frame talks to us here
      const m = e.data as { type?: string; id?: number } & Partial<RunResult>;
      if (m?.type === "ready") {
        window.clearTimeout(timer);
        resolve(f);
      } else if (m?.type === "result" && typeof m.id === "number") {
        waiting.get(m.id)?.({ lines: m.lines ?? [], error: m.error ?? null, timedOut: !!m.timedOut, truncated: !!m.truncated, ms: m.ms ?? 0 });
        waiting.delete(m.id);
      }
    });
    f.src = "/sandbox.html";
    document.body.appendChild(f);
  });
  return frame;
}

/** Runs a JavaScript or TypeScript answer and returns what it printed. Never throws: problems come back as `error`. */
export async function runCode(code: string): Promise<RunResult> {
  const empty = { lines: [], timedOut: false, truncated: false, ms: 0 };
  let js: string;
  try {
    const r = toJavaScript(await loadTs(), code);
    if ("error" in r) return { ...empty, error: r.error };
    js = r.js;
  } catch {
    return { ...empty, error: "The code runner couldn't load. Check your connection and try again." };
  }
  try {
    const f = await sandbox();
    const id = nextId++;
    return await new Promise<RunResult>((resolve) => {
      waiting.set(id, resolve);
      f.contentWindow!.postMessage({ type: "run", id, code: js }, "*"); // an opaque origin can only be addressed as "*"
    });
  } catch (e) {
    return { ...empty, error: (e as Error).message };
  }
}
