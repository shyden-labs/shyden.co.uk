# The deal's sound and the results celebration (#1339)

Date: 2026-11-28. Choices and quotes are Shyden's; anything marked **my call** is the builder's default, open to his correction.

## Why

Shyden: _"I want to change the sound when putting students into groups into something more modern and rich"_, then _"think of like when someone pulls a gacha on honkai star rail or genshin"_, then _"i need much more excitement in the running and especially once the results are in"_. Success: the class hears an exciting, polished, modern-game moment while the groups are dealt, with a payoff and a celebration when the results land.

## What he chose, round by round (all heard in the browser, `.superpowers/brainstorm/49383-1795843130/content/`)

1. Synthesized sketches (two rounds): "still synthetic".
2. Real CC0 recordings layered as a reveal: "suddenly boring".
3. A hype deal and finale: "better, but scary, I thought the electrics were sparking". **No hiss, crackle or white noise anywhere.**
4. The no-crackle version: "cuts off too early". **The ending rings out for 6-8 seconds.**
5. Endings: **"Jackpot"**, three rising fanfare stages.
6. Twelve deal sounds built from pitch-shifted slices: "really bad and synthetic". **Deal notes must be real recorded notes.**
7. Ten deal sounds on real note-by-note instruments: **9, "Full ensemble"**.
8. A preview of the board (#1338, design A) dealing with this sound: _"this is great so far"_, plus _"some celebration animation once all are added to go along with the ending sound"_. Celebration chosen: **"All together"**.
9. Reduce motion: **obey it, and show the calm version.**

## The design

- **While dealing (`sfx.land(i)`):** each student lands on a real recorded note of marimba, harp and glockenspiel together, climbing a major-pentatonic scale and getting louder (`p = i / (n - 1)`), with a real timpani hit on every fourth student. The notes are VSCO 2 CE recordings (CC0), each played from the nearest recording, nudged by no more than three semitones.
- **When all are dealt (`sfx.done()`):** a real timpani roll swells for 1.6 s, then the Jackpot ending begins. Ending: whoosh in, then a timpani hit, the cinematic impact and the low drop, a bell shimmer, and three fanfare stages at 0, 0.5 and 1.0 s (browser-made brass chords on C, F and G major). Then a sustained final chord, the sparkle and glockenspiel "confetti" notes, all fading over 6-8 s. Every layer is a recording or a tone: no noise source.
- **The celebration (board and page):** in time with the three fanfare stages, confetti cannons fire from the bottom corners (three volleys), the group cards jump in a wave, light sweeps across each coloured bar, fireworks burst over the board, gold stars twinkle, and the cards glow, all fading with the sound. Students in the deal pop into their card on their note.
- **Reduce motion:** when the device asks for less motion, nothing flies or bounces: the cards glow and the sound plays in full.

## My calls (Shyden may change)

- A big class keeps the deal's pace; the scale climbs and then wraps around, so 100 students never runs off the top.
- The ending stops at once, with a short fade, when the teacher shuffles again, closes the board or turns sound off.
- Only the notes used ship: about 12-15 recordings, compressed to AAC like today's sounds (expected 300-500 KB in all), self-hosted, credited in `src/assets/sfx/CREDITS.md` (VSCO 2 CE, CC0; the six Freesound CC0 sounds by page link).
- The existing sound switch and the existing "less motion" behaviour still apply.
- The synthesis fallback, for a browser that cannot decode AAC, plays a simple tonal version of the deal and ending (no noise).
- The celebration is drawn on one canvas over the board plus CSS on the cards, and never blocks a tap or a key.

## Anti-goals

- No hiss, crackle, white noise or harsh high grains.
- No sound or celebration that cannot be stopped at once.
- No third-party request: every file is served from the site.

## Approaches considered

1. **Real recorded notes for the deal, plus the existing synth engine for the fanfare and chord (chosen).** The deal sounds real, the ending is as heard.
2. Synthesis only: rejected twice by Shyden as synthetic.
3. One long pre-mixed audio file: cannot follow class size, deal speed or an early stop.

## Proof

Unit tests for the note choice (nearest recording, at most three semitones, wrap-around), the deal's loudness curve, the ending's schedule and stop; e2e on every desktop engine for the stop on reshuffle, on board close and on the sound switch, and for the celebration's calm version under reduced motion; light and dark contrast unaffected; Shyden listens on dev on the projector and signs off.
