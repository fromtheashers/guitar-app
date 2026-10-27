// Turns yt-dlp's error output (from the Google Cloud audio service or the helper on
// the teacher's computer) into a sentence for the person waiting.

export function explain(stderr: string, via: "server" | "helper" = "server"): string {
  // Judge by yt-dlp's final ERROR line; earlier WARNING lines are retries.
  const lines = stderr.split("\n").filter((l) => l.startsWith("ERROR"));
  const s = (lines.length ? lines.join(" ") : stderr).toLowerCase();
  if (s.includes("pass expired") || s.includes("bad pass"))
    return "The request expired before it reached the audio source. Try again.";
  if (s.includes("confirm your age") || s.includes("age-restricted") || s.includes("age restricted"))
    return "That video is age-restricted, so it can't be fetched.";
  if (s.includes("not a bot") || s.includes("sign in to confirm") || s.includes("http error 429") || s.includes("too many requests"))
    return via === "helper"
      ? "YouTube refused your home computer for now. Wait a few minutes and try again, or use the microphone option below."
      : "YouTube blocked the audio service for now. Try again later, or use the microphone option below.";
  if (s.includes("private video")) return "That video is private.";
  if (s.includes("video unavailable") || s.includes("is not available")) return "That video is unavailable.";
  if (s.includes("downloader isn't installed")) return "The helper on your home computer can't find yt-dlp. Re-run the helper setup.";
  if (s.includes("does not pass filter")) return "That video is longer than 15 minutes. Pick a single-song video.";
  if (s.includes("unable to download webpage") || s.includes("unable to connect") || s.includes("timed out"))
    return via === "helper" ? "Your home computer couldn't reach YouTube. Check its internet connection." : "The audio service couldn't reach YouTube. Try again in a minute.";
  return "Couldn't fetch the audio from YouTube. Try again, or use the backup option below.";
}
