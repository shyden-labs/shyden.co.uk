# Sound effects — provenance and licence

Every file here is released under **Creative Commons 0 (CC0 1.0 Universal)**, public domain:
<https://creativecommons.org/publicdomain/zero/1.0/>. Attribution is not required; each source is
credited here anyway.

## Where they come from

- **VSCO 2 CE** (Versilian Community Sample Library, Community Edition), CC0:
  <https://github.com/sgossner/VSCO-2-CE>. The deal's notes (marimba, harp, glockenspiel) and
  the timpani hit and roll.
- **Freesound**, each page's CC0 licence read on 2026-11-28 before its download (the public
  high-quality MP3 preview, #1339):
- `whoosh.m4a`: <https://freesound.org/people/AudioPapkin/sounds/648538/> (AudioPapkin)
- `impact.m4a`: <https://freesound.org/people/deleted_user_3277771/sounds/177242/> (deleted_user_3277771)
- `drop.m4a`: <https://freesound.org/people/Stereo%20Surgeon/sounds/261205/> (Stereo Surgeon)
- `bell.m4a`: <https://freesound.org/people/sgossner/sounds/375598/> (sgossner)
- `sparkle.m4a`: <https://freesound.org/people/opticaillusions/sounds/554312/> (opticaillusions)

## What was done to them

Each was cut to the longest the deal ever plays it, from its start (the whoosh from 1.7 s, where
its rise begins, so its peak meets the reveal), folded to mono, given a 15 ms fade-out so nothing
clicks (the whoosh also a 50 ms fade-in), and encoded to AAC at 96 kbps with ffmpeg:

```sh
ffmpeg -i <source> -t <length> -ac 1 -af "afade=t=out:st=<length - 0.015>:d=0.015" \
  -c:a aac -b:a 96k -movflags +faststart <name>.m4a
```

The whoosh and the drop were also lowered by 1 dB (`volume=-1dB`), as both reach full scale.
Nothing was pitched, filtered or re-synthesised: the player nudges a note by at most three
semitones at play time (`src/lib/dealSound.ts`). Levels were measured on the shipped files with
ffmpeg's `volumedetect`.

| Ships as           | Source                                                               | Length | Mean     | Peak       |
| ------------------ | -------------------------------------------------------------------- | ------ | -------- | ---------- |
| `marimba-43.m4a`   | VSCO 2 CE: `Percussion/Marimba/Marimba_hit_Outrigger_G2_loud_01.wav` | 1.5 s  | -39.6 dB | -22.3 dBFS |
| `marimba-47.m4a`   | VSCO 2 CE: `Percussion/Marimba/Marimba_hit_Outrigger_B2_loud_01.wav` | 1.5 s  | -40.2 dB | -27.4 dBFS |
| `marimba-53.m4a`   | VSCO 2 CE: `Percussion/Marimba/Marimba_hit_Outrigger_F3_loud_01.wav` | 1.5 s  | -34.7 dB | -20.0 dBFS |
| `marimba-60.m4a`   | VSCO 2 CE: `Percussion/Marimba/Marimba_hit_Outrigger_C4_loud_01.wav` | 1.5 s  | -38.7 dB | -20.9 dBFS |
| `marimba-67.m4a`   | VSCO 2 CE: `Percussion/Marimba/Marimba_hit_Outrigger_G4_loud_01.wav` | 1.5 s  | -38.1 dB | -20.2 dBFS |
| `harp-55.m4a`      | VSCO 2 CE: `Strings/Harp/KSHarp_G3_mf.wav`                           | 1.5 s  | -33.8 dB | -21.8 dBFS |
| `harp-62.m4a`      | VSCO 2 CE: `Strings/Harp/KSHarp_D4_mf.wav`                           | 1.5 s  | -35.8 dB | -19.9 dBFS |
| `harp-69.m4a`      | VSCO 2 CE: `Strings/Harp/KSHarp_A4_mf.wav`                           | 1.5 s  | -36.3 dB | -15.2 dBFS |
| `harp-76.m4a`      | VSCO 2 CE: `Strings/Harp/KSHarp_E5_mf.wav`                           | 1.5 s  | -33.4 dB | -19.3 dBFS |
| `glock-67.m4a`     | VSCO 2 CE: `Percussion/Glock/glock_medium_G4.wav`                    | 1.5 s  | -46.7 dB | -25.1 dBFS |
| `glock-72.m4a`     | VSCO 2 CE: `Percussion/Glock/glock_medium_C5.wav`                    | 1.5 s  | -44.8 dB | -25.6 dBFS |
| `glock-79.m4a`     | VSCO 2 CE: `Percussion/Glock/glock_medium_G5.wav`                    | 1.5 s  | -46.5 dB | -24.0 dBFS |
| `glock-84.m4a`     | VSCO 2 CE: `Percussion/Glock/glock_medium_C6.wav`                    | 1.5 s  | -48.3 dB | -24.2 dBFS |
| `glock-91.m4a`     | VSCO 2 CE: `Percussion/Glock/glock_medium_G6.wav`                    | 1.5 s  | -45.9 dB | -25.4 dBFS |
| `glock-96.m4a`     | VSCO 2 CE: `Percussion/Glock/glock_medium_C7.wav`                    | 1.5 s  | -52.8 dB | -25.1 dBFS |
| `timpani-hit.m4a`  | VSCO 2 CE: `Percussion/Timpani/Timpani3_Hit_v4_rr2_Sum.wav`          | 2.5 s  | -32.1 dB | -9.2 dBFS  |
| `timpani-roll.m4a` | VSCO 2 CE: `Percussion/Timpani/Rolls/Timpani2_Roll_v5_rr1_Sum.wav`   | 1.7 s  | -25.1 dB | -10.3 dBFS |
| `whoosh.m4a`       | Freesound, AudioPapkin: whoosh.mp3 (from 1.7 s)                      | 0.6 s  | -13.7 dB | 0.0 dBFS   |
| `impact.m4a`       | Freesound, deleted_user_3277771: hit.mp3                             | 6.5 s  | -14.6 dB | -0.5 dBFS  |
| `drop.m4a`         | Freesound, Stereo Surgeon: drop.mp3                                  | 4.0 s  | -7.7 dB  | 0.0 dBFS   |
| `bell.m4a`         | Freesound, sgossner: bell.mp3                                        | 5.0 s  | -52.1 dB | -27.2 dBFS |
| `sparkle.m4a`      | Freesound, opticaillusions: sparkle.mp3                              | 7.4 s  | -30.1 dB | -9.9 dBFS  |
