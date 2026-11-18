/**
 * WAV checks for uploaded recordings (AI design §8.2). The browser converts its recording to 16 kHz mono PCM WAV,
 * a format every speech provider accepts, and the header gives the exact duration without decoding audio. Pure.
 */
export interface WavInfo {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  dataBytes: number;
  seconds: number;
}

export class WavError extends Error {}

export function parseWav(buf: Buffer): WavInfo {
  if (buf.length < 44 || buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") throw new WavError("Not a WAV file");
  let off = 12;
  let fmt: { format: number; channels: number; sampleRate: number; byteRate: number; bitsPerSample: number } | null = null;
  while (off + 8 <= buf.length) {
    const id = buf.toString("ascii", off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    const body = off + 8;
    if (id === "fmt ") {
      if (size < 16 || body + 16 > buf.length) throw new WavError("Broken fmt chunk");
      fmt = {
        format: buf.readUInt16LE(body),
        channels: buf.readUInt16LE(body + 2),
        sampleRate: buf.readUInt32LE(body + 4),
        byteRate: buf.readUInt32LE(body + 8),
        bitsPerSample: buf.readUInt16LE(body + 14),
      };
    } else if (id === "data") {
      if (!fmt) throw new WavError("data chunk before fmt chunk");
      if (fmt.format !== 1 || fmt.bitsPerSample !== 16 || fmt.channels < 1 || fmt.channels > 2 || fmt.sampleRate < 8000 || fmt.sampleRate > 48000)
        throw new WavError("Only 16-bit PCM WAV is accepted");
      const dataBytes = Math.min(size, buf.length - body);
      return { sampleRate: fmt.sampleRate, channels: fmt.channels, bitsPerSample: 16, dataBytes, seconds: dataBytes / fmt.byteRate };
    }
    off = body + size + (size % 2);
  }
  throw new WavError("No audio data");
}
