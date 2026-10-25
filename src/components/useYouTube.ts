"use client";

import { useEffect, useRef, useState } from "react";

// Minimal typing for the parts of the YouTube IFrame Player API we use.
export interface YTPlayer {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
  setPlaybackRate(rate: number): void;
  getPlaybackRate(): number;
  mute(): void;
  unMute(): void;
  destroy(): void;
}

interface YTNamespace {
  Player: new (el: HTMLElement, opts: unknown) => YTPlayer;
  PlayerState: { ENDED: 0; PLAYING: 1; PAUSED: 2; BUFFERING: 3; CUED: 5 };
}

declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

export const PLAYING = 1;
export const BUFFERING = 3;
export const ENDED = 0;

let apiPromise: Promise<YTNamespace> | null = null;

function loadApi(): Promise<YTNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  apiPromise ??= new Promise((resolve, reject) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      resolve(window.YT!);
    };
    const s = document.createElement("script");
    s.src = "https://www.youtube.com/iframe_api";
    s.async = true;
    s.onerror = () => {
      apiPromise = null;
      reject(new Error("Couldn't load the YouTube player. Check your connection."));
    };
    document.head.appendChild(s);
  });
  return apiPromise;
}

/**
 * Mounts a YouTube player into the returned ref's element.
 * `state` follows the player (1 playing, 2 paused, 0 ended...).
 */
export function useYouTube(videoId: string | null) {
  const host = useRef<HTMLDivElement | null>(null);
  const player = useRef<YTPlayer | null>(null);
  const [ready, setReady] = useState(false);
  const [state, setState] = useState(-1);
  const [error, setError] = useState<string | null>(null);
  const listeners = useRef(new Set<(s: number) => void>());

  useEffect(() => {
    if (!videoId || !host.current) return;
    let cancelled = false;
    const mount = document.createElement("div");
    host.current.replaceChildren(mount);
    loadApi()
      .then((YT) => {
        if (cancelled) return;
        player.current = new YT.Player(mount, {
          videoId,
          width: "100%",
          height: "100%",
          playerVars: { rel: 0, modestbranding: 1, playsinline: 1 },
          events: {
            onReady: () => !cancelled && setReady(true),
            onStateChange: (e: { data: number }) => {
              setState(e.data);
              listeners.current.forEach((fn) => fn(e.data));
            },
            onError: () => setError("This video can't be played here. It may be private or block embedding."),
          },
        });
      })
      .catch((e: Error) => setError(e.message));
    return () => {
      cancelled = true;
      setReady(false);
      player.current?.destroy();
      player.current = null;
    };
  }, [videoId]);

  const onStateChange = (fn: (s: number) => void) => {
    listeners.current.add(fn);
    return () => listeners.current.delete(fn);
  };

  return { host, player, ready, state, error, onStateChange };
}
