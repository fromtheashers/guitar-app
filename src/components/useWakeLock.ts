"use client";

import { useEffect } from "react";

/** Holds a screen wake lock while `on`, taking it again when the page comes back into view. */
export function useWakeLock(on: boolean) {
  useEffect(() => {
    if (!on || !("wakeLock" in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let live = true;
    const take = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const l = await navigator.wakeLock.request("screen");
        if (live) lock = l;
        else void l.release();
      } catch {
        // Low battery mode or a browser that says no: everything still works, the screen may just dim.
      }
    };
    void take();
    document.addEventListener("visibilitychange", take);
    return () => {
      live = false;
      document.removeEventListener("visibilitychange", take);
      void lock?.release();
    };
  }, [on]);
}
