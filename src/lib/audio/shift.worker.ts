// Runs shiftPitch off the main thread. The song's samples arrive once ("load");
// each "shift" then renders the song in a key and speed and hands it back.
import { shiftPitch } from "./pitchShift";

export type ShiftRequest =
  | { type: "load"; samples: Float32Array; sampleRate: number }
  | { type: "shift"; job: number; semitones: number; tempo: number };

export type ShiftReply =
  | { type: "progress"; job: number; done: number }
  | { type: "done"; job: number; samples: Float32Array; sampleRate: number };

const scope = self as unknown as {
  onmessage: ((e: MessageEvent<ShiftRequest>) => void) | null;
  postMessage(message: ShiftReply, transfer?: Transferable[]): void;
};

let source: Float32Array | null = null;
let sampleRate = 0;

scope.onmessage = ({ data }) => {
  if (data.type === "load") {
    source = data.samples;
    sampleRate = data.sampleRate;
    return;
  }
  if (!source) return;
  const { job } = data;
  const samples = shiftPitch(source, sampleRate, data.semitones, data.tempo, (done) => scope.postMessage({ type: "progress", job, done }));
  scope.postMessage({ type: "done", job, samples, sampleRate }, [samples.buffer]);
};
