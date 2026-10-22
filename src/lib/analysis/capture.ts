// Captures the audio of this browser tab while the YouTube video plays, so it can be
// analysed in memory. Nothing is recorded to disk or uploaded.

import { resample } from "./dsp";
import { SR } from "./features";

export interface Anchor {
  /** Seconds of audio captured so far. */
  audio: number;
  /** Video position reported by the player at that moment. */
  video: number;
  playing: boolean;
}

export interface CaptureResult {
  /** Mono audio at the analysis sample rate. */
  samples: Float32Array;
  toVideoTime: (audioSeconds: number) => number | null;
  seconds: number;
}

export class CaptureError extends Error {
  constructor(
    message: string,
    readonly code: "unsupported" | "denied" | "no-audio" | "too-short",
  ) {
    super(message);
  }
}

const WORKLET = `
class Tap extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Float32Array(4096); this.n = 0; }
  process(inputs) {
    const input = inputs[0];
    if (input && input.length) {
      const ch = input.length;
      const len = input[0].length;
      for (let i = 0; i < len; i++) {
        let s = 0;
        for (let c = 0; c < ch; c++) s += input[c][i];
        this.buf[this.n++] = s / ch;
        if (this.n === this.buf.length) {
          this.port.postMessage(this.buf);
          this.buf = new Float32Array(4096);
          this.n = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor("tab-tap", Tap);
`;

export function tabCaptureSupported(): boolean {
  return typeof navigator !== "undefined" && !!navigator.mediaDevices?.getDisplayMedia && typeof AudioWorkletNode !== "undefined";
}

export interface CaptureHandle {
  /** Stop capturing and return the audio. */
  finish: () => Promise<CaptureResult>;
  /** Stop and throw everything away. */
  cancel: () => void;
  /** Seconds captured so far. */
  elapsed: () => number;
  /** Peak level of the latest chunk, 0..1, for a live meter. */
  level: () => number;
}

/**
 * Ask the browser to share this tab's audio, then start capturing.
 * Must be called from a click handler. `videoTime` reads the player's position.
 */
export async function startTabCapture(videoTime: () => { time: number; playing: boolean }, onEnded?: () => void): Promise<CaptureHandle> {
  if (!tabCaptureSupported()) {
    throw new CaptureError("This browser can't share tab audio. Use Chrome or Edge on a laptop or desktop.", "unsupported");
  }
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, suppressLocalAudioPlayback: false } as MediaTrackConstraints,
      // Chrome-specific hints: offer this tab first and include it in the picker.
      preferCurrentTab: true,
      selfBrowserSurface: "include",
      systemAudio: "exclude",
    } as DisplayMediaStreamOptions);
  } catch {
    throw new CaptureError("Sharing was cancelled, so there's no audio to analyse.", "denied");
  }
  stream.getVideoTracks().forEach((t) => t.stop());
  const audioTracks = stream.getAudioTracks();
  if (!audioTracks.length) {
    stream.getTracks().forEach((t) => t.stop());
    throw new CaptureError("No audio came through. In the share window, pick this tab and switch on \"Also share tab audio\".", "no-audio");
  }

  const ctx = new AudioContext();
  const url = URL.createObjectURL(new Blob([WORKLET], { type: "application/javascript" }));
  await ctx.audioWorklet.addModule(url);
  URL.revokeObjectURL(url);
  const source = ctx.createMediaStreamSource(new MediaStream(audioTracks));
  const tap = new AudioWorkletNode(ctx, "tab-tap");
  const mute = ctx.createGain();
  mute.gain.value = 0;
  source.connect(tap).connect(mute).connect(ctx.destination);

  const chunks: Float32Array[] = [];
  const anchors: Anchor[] = [];
  let total = 0;
  let peak = 0;
  tap.port.onmessage = (e: MessageEvent<Float32Array>) => {
    chunks.push(e.data);
    total += e.data.length;
    let p = 0;
    for (let i = 0; i < e.data.length; i += 8) p = Math.max(p, Math.abs(e.data[i]));
    peak = p;
    const v = videoTime();
    anchors.push({ audio: total / ctx.sampleRate, video: v.time, playing: v.playing });
  };
  audioTracks[0].addEventListener("ended", () => onEnded?.());

  const teardown = () => {
    tap.port.onmessage = null;
    source.disconnect();
    tap.disconnect();
    stream.getTracks().forEach((t) => t.stop());
    void ctx.close();
  };

  return {
    elapsed: () => total / ctx.sampleRate,
    level: () => Math.min(1, peak),
    cancel: () => {
      teardown();
      chunks.length = 0;
    },
    finish: async () => {
      const rate = ctx.sampleRate;
      teardown();
      const raw = new Float32Array(total);
      let o = 0;
      for (const c of chunks) {
        raw.set(c, o);
        o += c.length;
      }
      chunks.length = 0;
      if (total / rate < 20) throw new CaptureError("That was too short to analyse. Let the video play for at least 20 seconds.", "too-short");
      return { samples: resample(raw, rate, SR), toVideoTime: videoTimeMap(anchors), seconds: total / rate };
    },
  };
}

/**
 * Map audio time to video time. The player reports its position in coarse steps
 * that lag behind, so within a few seconds the smallest audio-minus-video offset is
 * the most accurate one.
 */
export function videoTimeMap(anchors: Anchor[]): (t: number) => number | null {
  const playing = anchors.filter((a) => a.playing && a.video > 0);
  const offs = playing.map((a) => ({ t: a.audio, off: a.audio - a.video }));
  return (t: number) => {
    const near = offs.filter((o) => Math.abs(o.t - t) <= 3).map((o) => o.off).sort((a, b) => a - b);
    if (near.length < 3) return null;
    const off = near[Math.floor(near.length * 0.1)];
    const v = t - off;
    return v >= 0 ? v : null;
  };
}
