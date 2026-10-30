import { describe, it, expect } from 'vitest';
import {
  clearsCoverageFirst,
  nodeScript,
  serverCoverageFindings,
  type WebServer,
} from '../web-server-coverage';
import { searched } from '../source-files';
import { fixtureReader } from '../fixture-texts';

const CLEARS =
  "import { a } from './a.mjs';\ndelete process.env.NODE_V8_COVERAGE;\nrun();\n";

describe('a script clears NODE_V8_COVERAGE before it does anything (#913)', () => {
  it('reads a delete placed first after the imports', () => {
    expect(clearsCoverageFirst(CLEARS, 'serve.mjs')).toBe(true);
  });

  it('reads a delete in a script with no imports', () => {
    expect(
      clearsCoverageFirst('delete process.env.NODE_V8_COVERAGE;\n', 's.mjs'),
    ).toBe(true);
  });

  it('reads past a shebang line', () => {
    expect(
      clearsCoverageFirst(`#!/usr/bin/env node\n${CLEARS}`, 'serve.mjs'),
    ).toBe(true);
  });

  it('refuses a delete that another statement runs before', () => {
    expect(
      clearsCoverageFirst(
        "import { a } from './a.mjs';\na();\ndelete process.env.NODE_V8_COVERAGE;\n",
        'serve.mjs',
      ),
    ).toBe(false);
  });

  it('refuses a script that never clears it', () => {
    expect(
      clearsCoverageFirst("import { a } from './a.mjs';\na();\n", 'serve.mjs'),
    ).toBe(false);
  });

  it('refuses a delete that only a comment spells', () => {
    expect(
      clearsCoverageFirst(
        '// delete process.env.NODE_V8_COVERAGE;\nrun();\n',
        'serve.mjs',
      ),
    ).toBe(false);
  });

  it('refuses a delete of another variable', () => {
    expect(
      clearsCoverageFirst('delete process.env.NODE_OPTIONS;\n', 'serve.mjs'),
    ).toBe(false);
  });

  it('refuses a first statement that only reads the variable', () => {
    expect(
      clearsCoverageFirst('process.env.NODE_V8_COVERAGE;\n', 'serve.mjs'),
    ).toBe(false);
  });

  it('refuses another operator on the variable', () => {
    expect(
      clearsCoverageFirst('void process.env.NODE_V8_COVERAGE;\n', 'serve.mjs'),
    ).toBe(false);
  });

  it('refuses a declaration placed first', () => {
    expect(
      clearsCoverageFirst(
        'const x = 1;\ndelete process.env.NODE_V8_COVERAGE;\n',
        'serve.mjs',
      ),
    ).toBe(false);
  });

  it('refuses an empty script', () => {
    expect(clearsCoverageFirst('', 'serve.mjs')).toBe(false);
  });
});

describe('the script a web server command runs (#913)', () => {
  it('names the script of a bare node command', () => {
    expect(nodeScript('node tests/functions/serve.mjs')).toBe(
      'tests/functions/serve.mjs',
    );
  });

  it('names none for a node command with arguments', () => {
    expect(nodeScript('node tests/functions/serve.mjs --x')).toBeUndefined();
  });

  it('names none for a command chained after node', () => {
    expect(nodeScript('node a.mjs && npm run build')).toBeUndefined();
  });

  it('names none for a node command chained after another', () => {
    expect(nodeScript('npm run build && node a.mjs')).toBeUndefined();
  });

  it('names none for a command that is not node', () => {
    expect(nodeScript('npm run build && npm run preview')).toBeUndefined();
  });
});

describe('every web server either unsets the measurement or its script clears it (#913)', () => {
  const read = fixtureReader;

  it('accepts a command that unsets it', () => {
    const servers: WebServer[] = [
      {
        id: 'a › web server 1',
        command: 'unset NODE_V8_COVERAGE; npm run build',
      },
    ];
    expect(
      searched(serverCoverageFindings(servers, read({})), {
        of: servers,
        what: 'fixture web servers',
      }),
    ).toEqual([]);
    expect(
      floorBreach('web-server-coverage/unset-servers', servers.length),
    ).toBeUndefined();
  });

  it('accepts a node script that clears it first and is stopped by SIGTERM', () => {
    const servers: WebServer[] = [
      { id: 'f › web server 1', command: 'node serve.mjs', signal: 'SIGTERM' },
    ];
    expect(
      searched(serverCoverageFindings(servers, read({ 'serve.mjs': CLEARS })), {
        of: servers,
        what: 'fixture web servers',
      }),
    ).toEqual([]);
    expect(
      floorBreach('web-server-coverage/sigterm-servers', servers.length),
    ).toBeUndefined();
  });

  it('accepts a node script that clears it first and is stopped by SIGINT', () => {
    const servers: WebServer[] = [
      { id: 'f › web server 1', command: 'node serve.mjs', signal: 'SIGINT' },
    ];
    expect(
      searched(serverCoverageFindings(servers, read({ 'serve.mjs': CLEARS })), {
        of: servers,
        what: 'fixture web servers',
      }),
    ).toEqual([]);
    expect(
      floorBreach('web-server-coverage/sigint-servers', servers.length),
    ).toBeUndefined();
  });

  it('names a node script Playwright would SIGKILL, which writes no coverage', () => {
    expect(
      serverCoverageFindings(
        [{ id: 'f › web server 1', command: 'node serve.mjs' }],
        read({ 'serve.mjs': CLEARS }),
      ),
    ).toEqual([
      'f › web server 1: node serve.mjs has no gracefulShutdown signal, so Playwright SIGKILLs it and its coverage is never written',
    ]);
  });

  it('names a node script that does not clear it', () => {
    expect(
      serverCoverageFindings(
        [
          {
            id: 'f › web server 1',
            command: 'node serve.mjs',
            signal: 'SIGTERM',
          },
        ],
        read({ 'serve.mjs': 'run();\n' }),
      ),
    ).toEqual(['f › web server 1: node serve.mjs']);
  });

  it('names any other command', () => {
    expect(
      serverCoverageFindings(
        [{ id: 'a › web server 1', command: 'npm run build' }],
        read({}),
      ),
    ).toEqual(['a › web server 1: npm run build']);
  });
});
