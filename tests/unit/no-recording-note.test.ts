import { describe, expect, it } from 'vitest';
import { noRecordingNote } from '../../scripts/build-evidence-page.mjs';

/**
 * Why a journey's recording is absent, per ENGINE (#1103, #390 F48). The note
 * was keyed by title alone, so the last spec of that title answered for every
 * engine: an iPhone leg (stills only) listed last told the Chromium leg it had
 * "no recording for this leg", where its recording had gone missing.
 */
const spec = (title: string, project: string, video: string | undefined) => ({
  title,
  project,
  block: 'the block',
  file: 'tests/e2e/a.spec.ts',
  status: 'passed',
  duration: 1,
  video,
});

const specs = [
  spec('records', 'chromium', 'records.webm'),
  spec('journey', 'chromium', undefined),
  spec('journey', 'ios-safari-real-device', undefined),
];

describe('noRecordingNote', () => {
  it('says the recording is missing on an engine whose block records', () => {
    expect(noRecordingNote(specs, 'journey', 'chromium')).toBe(
      'recording missing',
    );
  });

  it('says a stills-only leg has no recording, on that leg alone', () => {
    expect(noRecordingNote(specs, 'journey', 'ios-safari-real-device')).toBe(
      'no recording for this leg',
    );
  });

  it('says there is no result on an engine the journey did not run on', () => {
    expect(noRecordingNote(specs, 'journey', 'firefox')).toBe('no test result');
    expect(noRecordingNote(specs, 'never ran', 'chromium')).toBe(
      'no test result',
    );
  });

  it('says not recorded by policy where the block never records', () => {
    expect(
      noRecordingNote(
        [spec('quiet', 'chromium', undefined)],
        'quiet',
        'chromium',
      ),
    ).toBe('not recorded by policy');
  });
});
