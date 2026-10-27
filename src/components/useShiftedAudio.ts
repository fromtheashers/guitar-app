"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import type { ShiftReply, ShiftRequest } from "@/lib/audio/shift.worker";
import { fetchFromSource, type AudioSource } from "@/lib/audioSource";
import { PLAYING, type YTPlayer } from "./useYouTube";

// Plays the song in the student's key. YouTube's player can't change pitch, so the
// page fetches the song's audio from the sources the site names (never stored),
// shifts it in a worker, and plays it in step with the video, which is muted meanwhile. Anything that goes
// wrong leaves the video playing as normal, in the original key.

export type ShiftStatus =
  | { kind: "off" }
  | { kind: "loading" }
  | { kind: "shifting"; done: number }
  | { kind: "ready"; blocked: boolean }
  | { kind: "failed"; reason: string };

// Decoding at 32 kHz keeps a whole song small enough for a phone's memory.
const SAMPLE_RATE = 32000;
// Drift allowed between the video and the audio before the audio jumps back in step.
const DRIFT = 0.2;

interface Rendered {
  semitones: number;
  rate: number;
  buffer: AudioBuffer;
}

export function useShiftedAudio({
  songId,
  semitones,
  rate,
  player,
}: {
  songId: string;
  semitones: number;
  rate: number;
  player: RefObject<YTPlayer | null>;
}): ShiftStatus {
  const [status, setStatus] = useState<ShiftStatus>({ kind: "off" });
  const ctx = useRef<AudioContext | null>(null);
  const worker = useRef<Worker | null>(null);
  const loaded = useRef<Promise<void> | null>(null);
  const job = useRef(0);
  const rendered = useRef<Rendered | null>(null);
  const want = useRef({ semitones, rate });
  useEffect(() => {
    want.current = { semitones, rate };
  }, [semitones, rate]);

  const playing = useRef<{ node: AudioBufferSourceNode; gain: GainNode; ctxStart: number; videoStart: number } | null>(null);
  const muted = useRef(false);

  const stopSound = () => {
    const p = playing.current;
    if (!p) return;
    playing.current = null;
    try {
      p.node.stop();
    } catch {
      /* already stopped */
    }
    p.node.disconnect();
    p.gain.disconnect();
  };

  const setMuted = (on: boolean) => {
    const p = player.current;
    if (!p || muted.current === on) return;
    muted.current = on;
    if (on) p.mute();
    else p.unMute();
  };

  // Fetch and shift whenever the key or speed changes.
  useEffect(() => {
    if (semitones === 0) {
      job.current++;
      rendered.current = null;
      stopSound();
      setMuted(false);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStatus({ kind: "off" });
      return;
    }
    if (rendered.current?.semitones === semitones && rendered.current.rate === rate) return;
    const id = ++job.current;
    // Wait for the student to settle on a key before doing the work.
    const timer = window.setTimeout(async () => {
      try {
        if (!loaded.current) {
          setStatus({ kind: "loading" });
          loaded.current = load(songId, worker).catch((e) => {
            loaded.current = null;
            throw e;
          });
        }
        await loaded.current;
        if (id !== job.current) return;
        setStatus({ kind: "shifting", done: 0 });
        const result = await shift(worker.current!, id, semitones, rate, (done) => id === job.current && setStatus({ kind: "shifting", done }));
        if (id !== job.current) return;
        ctx.current ??= makeContext();
        const buffer = ctx.current.createBuffer(1, result.samples.length, result.sampleRate);
        buffer.copyToChannel(result.samples as Float32Array<ArrayBuffer>, 0);
        stopSound();
        rendered.current = { semitones, rate, buffer };
        setStatus({ kind: "ready", blocked: false });
      } catch (e) {
        if (id !== job.current) return;
        stopSound();
        rendered.current = null;
        setMuted(false);
        setStatus({ kind: "failed", reason: e instanceof Error ? e.message : "Couldn't get the song's audio." });
      }
    }, 400);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [songId, semitones, rate]);

  // Follow the video: start, stop and re-align the audio as it plays, pauses and seeks.
  const ready = status.kind === "ready";
  useEffect(() => {
    if (!ready) return;
    let blocked = false;
    const sync = () => {
      const p = player.current;
      const c = ctx.current;
      const r = rendered.current;
      // A render for another key or speed is on its way: play the video as normal.
      if (!p || !c || !r || r.semitones !== want.current.semitones || r.rate !== want.current.rate) {
        stopSound();
        setMuted(false);
        return;
      }
      if (c.state !== "running") {
        void c.resume();
        // The browser wants a tap first: let the video's own sound carry on till then.
        if (!blocked) setStatus({ kind: "ready", blocked: (blocked = true) });
        stopSound();
        setMuted(false);
        return;
      }
      if (blocked) setStatus({ kind: "ready", blocked: (blocked = false) });
      setMuted(true);
      if (p.getPlayerState() !== PLAYING) {
        stopSound();
        return;
      }
      const t = p.getCurrentTime();
      const now = playing.current;
      if (now && Math.abs(now.videoStart + (c.currentTime - now.ctxStart) * r.rate - t) < DRIFT) return;
      stopSound();
      const offset = t / r.rate;
      if (offset >= r.buffer.duration) return;
      const gain = c.createGain();
      gain.gain.setValueAtTime(0, c.currentTime);
      gain.gain.linearRampToValueAtTime(1, c.currentTime + 0.03);
      gain.connect(c.destination);
      const node = c.createBufferSource();
      node.buffer = r.buffer;
      node.connect(gain);
      node.start(0, offset);
      playing.current = { node, gain, ctxStart: c.currentTime, videoStart: t };
    };
    // Browsers only start sound after a tap or key press on the page.
    const wake = () => void ctx.current?.resume().then(sync);
    const timer = window.setInterval(sync, 100);
    sync();
    window.addEventListener("pointerdown", wake, true);
    window.addEventListener("keydown", wake, true);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("pointerdown", wake, true);
      window.removeEventListener("keydown", wake, true);
      stopSound();
      setMuted(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  useEffect(
    () => () => {
      job.current++;
      stopSound();
      if (muted.current) player.current?.unMute();
      worker.current?.terminate();
      void ctx.current?.close();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  return status;
}

function makeContext(): AudioContext {
  // iPhones mute web audio with the silent switch unless the page says it's playback.
  const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
  if (session) session.type = "playback";
  return new AudioContext();
}

async function load(songId: string, worker: RefObject<Worker | null>): Promise<void> {
  const res = await fetch(`/api/song-audio/${encodeURIComponent(songId)}`, { cache: "no-store" });
  const body = (await res.json().catch(() => null)) as { error?: string; sources?: AudioSource[] } | null;
  if (!res.ok || !body?.sources?.length) throw new Error(body?.error ?? "Couldn't get the song's audio.");
  // Google Cloud first, then the teacher's computer.
  let bytes: ArrayBuffer | null = null;
  for (const source of body.sources) {
    try {
      bytes = (await fetchFromSource(source)).bytes.buffer;
      break;
    } catch (e) {
      console.warn(`Song audio from ${source.kind} failed:`, e instanceof Error ? e.message : e);
    }
  }
  if (!bytes) throw new Error("Couldn't get the song's audio this time.");
  let decoded: AudioBuffer;
  try {
    decoded = await new OfflineAudioContext(1, 1, SAMPLE_RATE).decodeAudioData(bytes);
  } catch {
    throw new Error("This phone couldn't read the song's audio.");
  }
  // One channel: half the memory and work, and plenty for practice.
  const samples = decoded.getChannelData(0).slice();
  for (let ch = 1; ch < decoded.numberOfChannels; ch++) {
    const other = decoded.getChannelData(ch);
    for (let i = 0; i < samples.length; i++) samples[i] += other[i];
  }
  if (decoded.numberOfChannels > 1) for (let i = 0; i < samples.length; i++) samples[i] /= decoded.numberOfChannels;

  worker.current ??= new Worker(new URL("../lib/audio/shift.worker.ts", import.meta.url), { type: "module" });
  const msg: ShiftRequest = { type: "load", samples, sampleRate: decoded.sampleRate };
  worker.current.postMessage(msg, [samples.buffer]);
}

function shift(
  w: Worker,
  job: number,
  semitones: number,
  tempo: number,
  onProgress: (done: number) => void,
): Promise<{ samples: Float32Array; sampleRate: number }> {
  return new Promise((resolve, reject) => {
    const onMessage = ({ data }: MessageEvent<ShiftReply>) => {
      if (data.job !== job) return;
      if (data.type === "progress") onProgress(data.done);
      else {
        cleanup();
        resolve(data);
      }
    };
    const onError = () => {
      cleanup();
      reject(new Error("Couldn't change the song's key on this device."));
    };
    const cleanup = () => {
      w.removeEventListener("message", onMessage);
      w.removeEventListener("error", onError);
    };
    w.addEventListener("message", onMessage);
    w.addEventListener("error", onError);
    const msg: ShiftRequest = { type: "shift", job, semitones, tempo };
    w.postMessage(msg);
  });
}
