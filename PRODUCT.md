# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Next.js (App Router, TypeScript) on Render's free web service, with a Neon Postgres database. Chosen by Claude after the teacher named Render and Neon as the accounts they already have.

## Users

- **Students:** beginner guitarists in a small church group learning mostly Christian worship songs. They open the app on phones and laptops, usually with a guitar in their lap, to practise a song before rehearsal or Sunday.
- **The teacher (asher):** writes and corrects every chart, assigns setlists, and runs the audio analysis on a laptop.

## Product Purpose

Show students how a worship song is played: the chords in time with the original YouTube video, in an easy or advanced version, in the band's key, with a strum pattern taken from the recording's drums. Success is a student who can open a song and play along without the teacher in the room.

## Positioning

The chart is built from the recording itself. The app listens to the YouTube video once (tab audio, in memory, never saved) and drafts the chords, tempo, sections and a strum pattern that follows the kick, snare and hi-hat. The teacher corrects the draft; students follow it in sync with the video.

## Operating Context

- Practice happens with a guitar in hand: glances at the screen, one hand free at most, often a phone on a music stand or a laptop on a desk.
- Songs come from YouTube links. Spotify links are only a "listen" button.
- The group is small, private and non-commercial. There are no user accounts; a passcode protects editing.
- Analysis runs on a laptop in Chrome or Edge; students only read the results.

## Capabilities and Constraints

- Easy mode: capo to open shapes, simplified chords, strums only on kick and snare. Advanced mode: full voicings, real strum pattern with accents and muted strums.
- Transpose to any key, capo suggestion, Nashville number view.
- Slow-down and A–B / section looping on the YouTube video.
- Teacher-built setlists with an optional key per song.
- No lyrics by default (no CCLI licence); short lyric cues typed by the teacher are allowed.
- Must stay free to run.

## Brand Commitments

None set. No name, logo or palette has been given.

## Evidence on Hand

No real charts, logos or photographs yet. Sample songs used during development are illustrative and must be replaced by the teacher's own.

## Product Principles

1. The guitar comes first: anything a student needs mid-song is readable at arm's length.
2. The teacher's correction beats the machine's guess, always one click away.
3. Never store the audio.
4. Easy mode is a real arrangement, not a dumbed-down view.

## Accessibility & Inclusion

Readable at arm's length on a phone; works without colour alone (strum accents also differ in weight and shape).
