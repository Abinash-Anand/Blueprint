/** Images as revision material (Revision v2 phase 4): the type from the bytes, and the model's reply as text. */
import { describe, expect, it } from "vitest";
import { IMAGE_SCHEMA, imagePrompt, imageReply, imageType } from "../../src/modules/revision/imageText.js";

describe("image type from the first bytes", () => {
  it("knows PNG, JPEG and WebP, and nothing else", () => {
    expect(imageType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]))).toBe("image/png");
    expect(imageType(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]))).toBe("image/jpeg");
    expect(imageType(Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBPVP8 ")]))).toBe("image/webp");
    expect(imageType(Buffer.from("GIF89a......"))).toBeNull();
    expect(imageType(Buffer.from("%PDF-1.7"))).toBeNull();
    expect(imageType(Buffer.alloc(0))).toBeNull();
  });
});

describe("the reply as material text", () => {
  it("joins the lines, keeps code indentation, and drops control characters and extra blank lines", () => {
    const text = imageReply({ readable: true, lines: ["# Observables", "", "", "", "```ts", "of(1).pipe(", "  map((x) => x * 2),", ")", "```", "Cold\u0007 vs hot   "] });
    expect(text).toBe("# Observables\n\n```ts\nof(1).pipe(\n  map((x) => x * 2),\n)\n```\nCold vs hot");
  });

  it("is null when the image had nothing readable or the reply is malformed", () => {
    expect(imageReply({ readable: false, lines: [] })).toBeNull();
    expect(imageReply({ readable: true, lines: ["too short"] })).toBeNull();
    expect(imageReply({ readable: true, lines: "not an array" })).toBeNull();
    expect(imageReply(null)).toBeNull();
  });

  it("asks for a line-by-line transcription without adding or translating, and keeps names out of the markup", () => {
    const p = imagePrompt("RxJS <basics>", "notes<1>.jpg");
    expect(p.system).toMatch(/Do not translate, correct, summarise, explain or add anything/);
    expect(p.system).toMatch(/\[Diagram:/);
    expect(p.user).toContain("<topic>\nRxJS basics\n</topic>");
    expect(p.user).toContain("<file>\nnotes1.jpg\n</file>");
    expect(IMAGE_SCHEMA.properties.lines.type).toBe("array");
  });
});
