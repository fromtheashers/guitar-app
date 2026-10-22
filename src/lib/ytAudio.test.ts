import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { explain } = await import("./ytAudio");

describe("explain", () => {
  it("reads yt-dlp's final error, not retry warnings", () => {
    const net = "WARNING: [youtube] Unable to download webpage: proxy\nERROR: [youtube] abc: Unable to download webpage: timed out";
    expect(explain(net)).toMatch(/couldn't reach YouTube/);
    expect(explain("ERROR: [youtube] abc: Sign in to confirm you’re not a bot.")).toMatch(/blocked the server/);
    expect(explain("ERROR: [youtube] abc: Sign in to confirm your age.")).toMatch(/age-restricted/);
    expect(explain("ERROR: [youtube] abc: Private video. Sign in if you've been granted access")).toMatch(/private/);
    expect(explain("abc does not pass filter (duration < 900), skipping ..")).toMatch(/15 minutes/);
  });
});
