import { describe, expect, it } from "vitest";
import { shiftPitch } from "./pitchShift";

const SR = 32000;

function sine(freq: number, seconds: number): Float32Array {
  const x = new Float32Array(Math.round(SR * seconds));
  for (let i = 0; i < x.length; i++) x[i] = Math.sin((2 * Math.PI * freq * i) / SR);
  return x;
}

// Frequency from upward zero crossings in the middle of the signal.
function frequency(x: Float32Array): number {
  const a = Math.floor(x.length * 0.2);
  const b = Math.floor(x.length * 0.8);
  let first = -1;
  let last = -1;
  let count = 0;
  for (let i = a + 1; i < b; i++) {
    if (x[i - 1] < 0 && x[i] >= 0) {
      if (first < 0) first = i;
      else count++;
      last = i;
    }
  }
  return (count * SR) / (last - first);
}

describe("shiftPitch", () => {
  it("moves the pitch by the given semitones and keeps the length", () => {
    const x = sine(220, 3);
    for (const semis of [-5, -2, 2, 5]) {
      const y = shiftPitch(x, SR, semis);
      expect(Math.abs(y.length - x.length) / x.length).toBeLessThan(0.03);
      expect(frequency(y) / (220 * 2 ** (semis / 12))).toBeCloseTo(1, 2);
    }
  });

  it("slows down without changing the pitch", () => {
    const x = sine(330, 2);
    const y = shiftPitch(x, SR, 0, 0.75);
    expect(Math.abs(y.length - x.length / 0.75) / (x.length / 0.75)).toBeLessThan(0.03);
    expect(frequency(y) / 330).toBeCloseTo(1, 2);
  });

  it("does both at once", () => {
    const x = sine(220, 2);
    const y = shiftPitch(x, SR, 3, 0.5);
    expect(Math.abs(y.length - x.length * 2) / (x.length * 2)).toBeLessThan(0.03);
    expect(frequency(y) / (220 * 2 ** 0.25)).toBeCloseTo(1, 2);
  });
});
