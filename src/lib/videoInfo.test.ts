import { describe, expect, it } from "vitest";
import { cleanTitle, embeddedJson, guessSong, musicSection } from "./videoInfo";

describe("guessSong", () => {
  it("reads 'Artist - Song (Official Video)'", () => {
    expect(guessSong({ title: "Hillsong Worship - What A Beautiful Name (Official Video)", channel: "Hillsong Worship" })).toEqual({
      title: "What A Beautiful Name",
      artist: "Hillsong Worship",
    });
  });

  it("reads 'Song | Live | Channel'", () => {
    expect(guessSong({ title: "Graves Into Gardens (feat. Brandon Lake) | Live | Elevation Worship", channel: "Elevation Worship" })).toEqual({
      title: "Graves Into Gardens",
      artist: "Elevation Worship",
    });
  });

  it("reads 'Song - Channel' when the channel is on the right", () => {
    expect(guessSong({ title: "Goodness Of God (Live) - Bethel Music", channel: "Bethel Music" })).toMatchObject({
      title: "Goodness Of God",
      artist: "Bethel Music",
    });
  });

  it("uses Topic channels and the Music section", () => {
    expect(guessSong({ title: "10,000 Reasons (Bless the Lord)", channel: "Matt Redman - Topic" })).toEqual({
      title: "10,000 Reasons (Bless the Lord)",
      artist: "Matt Redman",
    });
    expect(
      guessSong({ title: "Sunday set clip", channel: "Some Church", music: { song: "Way Maker", artist: "Sinach" } }),
    ).toMatchObject({ title: "Way Maker", artist: "Sinach" });
  });

  it("falls back to the channel as artist", () => {
    expect(guessSong({ title: "Oceans [Lyric Video]", channel: "HillsongUNITEDVEVO" })).toEqual({ title: "Oceans", artist: "HillsongUNITED" });
  });

  it("reads key, tempo, time signature and Spotify from the description", () => {
    const g = guessSong({
      title: "A - B",
      channel: "A",
      description: "Stream: https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC?si=x\nKey: Bb | BPM: 68 | Time Signature: 6/8",
    });
    expect(g).toMatchObject({ spotifyUrl: "https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC", key: "Bb", bpm: 68, beatsPerBar: 6 });
    expect(guessSong({ title: "x", channel: "y", description: "Original key of F# minor, 72 bpm" })).toMatchObject({ key: "F#m", bpm: 72 });
    expect(guessSong({ title: "x", channel: "y", description: "The keyboard part is great" }).key).toBeUndefined();
  });
});

describe("page parsing", () => {
  it("cleans titles but keeps real parentheticals", () => {
    expect(cleanTitle("Build My Life (Official Lyric Video) ft. Someone")).toBe("Build My Life");
    expect(cleanTitle("Way Maker (Miracle Worker)")).toBe("Way Maker (Miracle Worker)");
  });

  it("extracts embedded JSON and the Music card", () => {
    const data = { a: [{ b: { videoAttributeViewModel: { title: "Way Maker", subtitle: "Sinach" } } }] };
    const html = `<script>var ytInitialData = ${JSON.stringify(data)};</script><script>var ytInitialPlayerResponse = {"videoDetails":{"title":"x \\"}\\" y"}};</script>`;
    expect(musicSection(embeddedJson(html, "ytInitialData"))).toEqual({ song: "Way Maker", artist: "Sinach" });
    expect(embeddedJson(html, "ytInitialPlayerResponse")).toEqual({ videoDetails: { title: 'x "}" y' } });
    const old = { rows: [{ infoRowRenderer: { title: { simpleText: "SONG" }, defaultMetadata: { simpleText: "Oceans" } } }, { infoRowRenderer: { title: { simpleText: "ARTIST" }, defaultMetadata: { runs: [{ text: "Hillsong UNITED" }] } } }] };
    expect(musicSection(old)).toEqual({ song: "Oceans", artist: "Hillsong UNITED" });
  });
});
