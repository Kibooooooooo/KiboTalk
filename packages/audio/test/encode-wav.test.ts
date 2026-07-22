import { describe, it, expect } from "vitest";
import { encodeWav } from "../src/index";

function ascii(view: DataView, offset: number, len: number): string {
  let s = "";
  for (let i = 0; i < len; i++) s += String.fromCharCode(view.getUint8(offset + i));
  return s;
}

describe("encodeWav header", () => {
  it("writes RIFF/WAVE magic and chunk sizes for a single sample", () => {
    const buf = encodeWav(new Float32Array([0]), 16000);
    const view = new DataView(buf);
    expect(ascii(view, 0, 4)).toBe("RIFF");
    expect(view.getUint32(4, true)).toBe(36 + 2);
    expect(ascii(view, 8, 4)).toBe("WAVE");
    expect(ascii(view, 12, 4)).toBe("fmt ");
    expect(view.getUint32(16, true)).toBe(16);
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(16000);
    expect(view.getUint32(28, true)).toBe(16000 * 2);
    expect(view.getUint16(32, true)).toBe(2);
    expect(view.getUint16(34, true)).toBe(16);
    expect(ascii(view, 36, 4)).toBe("data");
    expect(view.getUint32(40, true)).toBe(2);
    expect(buf.byteLength).toBe(44 + 2);
  });

  it("data chunk size scales with sample count", () => {
    const buf = encodeWav(new Float32Array(100).fill(0), 16000);
    const view = new DataView(buf);
    expect(view.getUint32(40, true)).toBe(100 * 2);
    expect(buf.byteLength).toBe(44 + 100 * 2);
  });

  it("defaults to 16kHz sample rate", () => {
    const view = new DataView(encodeWav(new Float32Array([0])));
    expect(view.getUint32(24, true)).toBe(16000);
  });

  it("honors a custom sample rate", () => {
    const view = new DataView(encodeWav(new Float32Array([0]), 8000));
    expect(view.getUint32(24, true)).toBe(8000);
    expect(view.getUint32(28, true)).toBe(8000 * 2);
  });
});

describe("encodeWav sample encoding", () => {
  it("maps 1.0 → 0xFF 0x7F, -1.0 → 0x00 0x80, 0 → 0x00 0x00", () => {
    const view = new DataView(encodeWav(new Float32Array([1.0, -1.0, 0]), 16000));
    expect(view.getUint8(44)).toBe(0xff);
    expect(view.getUint8(45)).toBe(0x7f);
    expect(view.getUint8(46)).toBe(0x00);
    expect(view.getUint8(47)).toBe(0x80);
    expect(view.getUint8(48)).toBe(0x00);
    expect(view.getUint8(49)).toBe(0x00);
  });

  it("clamps out-of-range floats to int16 range", () => {
    const view = new DataView(encodeWav(new Float32Array([2.0, -2.0]), 16000));
    expect(view.getInt16(44, true)).toBe(32767);
    expect(view.getInt16(46, true)).toBe(-32768);
  });
});
