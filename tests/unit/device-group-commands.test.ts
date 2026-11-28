import { describe, expect, it } from 'vitest';
import {
  androidGroupCommand,
  iosGroupCommand,
  npmRunCommand,
} from '../../scripts/test-devices.mjs';
import {
  NODE,
  NPM_CLI,
  PLAYWRIGHT_CLI,
  VITEST_CLI,
} from '../../scripts/programs.mjs';

describe('the device run builds and previews through npm by path (#1294)', () => {
  it("runs `npm run build` as npm's own entry file under node", () => {
    expect(npmRunCommand(['build'])).toEqual({
      command: NODE,
      args: [NPM_CLI, 'run', 'build'],
    });
  });

  it('runs the preview server the same way, its arguments unchanged', () => {
    expect(npmRunCommand(['preview', '--', '--host', '0.0.0.0'])).toEqual({
      command: NODE,
      args: [NPM_CLI, 'run', 'preview', '--', '--host', '0.0.0.0'],
    });
  });
});

/**
 * The device run's two suites start Playwright's and Vitest's own entry files
 * under node, never `npx` found on PATH (SonarCloud S4036, #1295). The
 * arguments are the ones `npx` was given, unchanged.
 */
describe('the device groups run their test runners by path (#1295)', () => {
  it("runs the Android group through Playwright's entry file", () => {
    expect(androidGroupCommand()).toEqual({
      command: NODE,
      args: [
        PLAYWRIGHT_CLI,
        'test',
        '--config=playwright.device.config.ts',
        '--reporter=list,json,html,./tests/reporters/jsonl-reporter.ts',
      ],
    });
  });

  it("runs the iPhone group through Vitest's entry file, writing its report", () => {
    expect(iosGroupCommand('/r/ios.json')).toEqual({
      command: NODE,
      args: [
        VITEST_CLI,
        'run',
        '--config=vitest.ios.config.ts',
        '--reporter=verbose',
        '--reporter=json',
        '--outputFile.json=/r/ios.json',
        '--reporter=./tests/reporters/jsonl-vitest.ts',
      ],
    });
  });
});
