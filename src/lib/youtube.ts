/** The 11-character video id from any common YouTube link, or null. */
export function youtubeId(url: string): string | null {
  const s = url.trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  try {
    const u = new URL(s);
    const host = u.hostname.replace(/^www\.|^m\.|^music\./, "");
    if (host === "youtu.be") return clean(u.pathname.slice(1));
    if (host === "youtube.com" || host === "youtube-nocookie.com") {
      if (u.pathname === "/watch") return clean(u.searchParams.get("v") ?? "");
      const m = /^\/(embed|shorts|live|v)\/([\w-]{11})/.exec(u.pathname);
      if (m) return m[2];
    }
  } catch {
    return null;
  }
  return null;
}

function clean(id: string): string | null {
  return /^[\w-]{11}$/.test(id) ? id : null;
}
