/** The code sandbox (Revision v2 phase 4): TypeScript becomes plain JavaScript here, and the sandbox page's policy is strict. */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { toJavaScript } from "../lib/sandbox";

const root = resolve(__dirname, "../..");
// Browsers hash an inline script after turning every line ending into a plain line feed (this checkout may use CRLF).
const page = readFileSync(resolve(root, "public/sandbox.html"), "utf8").replace(/\r\n?/g, "\n");
const nginx = readFileSync(resolve(root, "nginx.conf"), "utf8");

describe("turning an answer into JavaScript", () => {
  it("strips TypeScript types and keeps the code", () => {
    const r = toJavaScript(ts, "interface User { name: string }\nconst u: User = { name: 'Ada' };\nconsole.log(u.name as string);");
    expect(r).toEqual({ js: expect.stringContaining("const u = { name: 'Ada' };") });
    expect((r as { js: string }).js).not.toMatch(/interface|: User|as string/);
  });

  it("turns imports into require calls, which the sandbox answers with a clear message", () => {
    expect((toJavaScript(ts, "import { of } from 'rxjs';\nof(1).subscribe(console.log);") as { js: string }).js).toMatch(/require\("rxjs"\)/);
  });

  it("reports the first syntax error with its line", () => {
    expect(toJavaScript(ts, "const a = 1;\nconst b = ;")).toEqual({ error: expect.stringMatching(/^Line 2: Expression expected/) });
  });
});

describe("the sandbox page", () => {
  it("is allowed to run only its own script, by hash, and nothing from the network", () => {
    const script = page.match(/<script>([\s\S]*?)<\/script>/)![1];
    const hash = `sha256-${createHash("sha256").update(script, "utf8").digest("base64")}`;
    const block = nginx.slice(nginx.indexOf("location = /sandbox.html"), nginx.indexOf("}", nginx.indexOf("location = /sandbox.html")));
    expect(block).toContain(`script-src '${hash}'`);
    expect(block).toContain("default-src 'none'");
    expect(block).toContain("worker-src blob:");
    expect(block).not.toMatch(/connect-src|unsafe-eval|unsafe-inline/);
    expect(page.match(/<script/g)).toHaveLength(1);
  });

  it("is loaded in a frame that may only run scripts: no same origin, forms, popups or navigation", () => {
    const src = readFileSync(resolve(root, "src/lib/sandbox.ts"), "utf8");
    expect(src).toContain('f.setAttribute("sandbox", "allow-scripts");');
    expect(src).not.toMatch(/allow-same-origin|allow-forms|allow-popups|allow-top-navigation/);
  });
});
