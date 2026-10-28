import { describe, expect, it } from 'vitest';
import { fold, type FoldIo } from '../../scripts/fold-record.mjs';

/**
 * What `scripts/fold-record.mjs` does with a dispatched record's artifact
 * (#889). The bots push nothing: `record-floors.yml` and `visual-capture.yml`
 * measure a scratch ref and upload what moved, and this folds it into the
 * session's own commit, which is still unpushed, so the branch is pushed once
 * and normally. Every refusal happens before a file is copied, and names what
 * it refused.
 *
 * git and gh are stood in: `io` answers each call from the facts a test
 * gives it and records the calls, so the order is asserted too.
 * `tests/integration/fold-record.test.ts` runs the same script against a real
 * repository.
 */

const MEASURED = 'a'.repeat(40);
const FOLDED = 'b'.repeat(40);
const PARENT = 'c'.repeat(40);
const DIR = '/scratch/fold';

interface Facts {
  readonly artifacts?: Readonly<
    Record<string, Readonly<Record<string, string>>>
  >;
  readonly head?: string;
  readonly status?: string;
  readonly pushedOn?: string;
  readonly branch?: string;
  readonly parentsAfter?: string;
  /** false: any download fails the test, for a refusal that must start none. */
  readonly downloads?: boolean;
}

const floorsArtifact = (over: Record<string, string> = {}) => ({
  'floors-record': {
    'floors.json': '{"a/b": 2}\n',
    'message.txt': 'The change\n\nFloors recorded in CI: a/b 1 -> 2\n',
    'sha.txt': `${MEASURED}\n`,
    'ref.txt': 'refs/floors/889-bots-push-nothing\n',
    ...over,
  },
});

const BASELINE = 'tests/e2e/__screenshots__/home-en-linux.png';

const visualArtifact = (over: Record<string, string> = {}) => ({
  'visual-capture': {
    'baselines.txt': `${BASELINE}\n`,
    [`files/${BASELINE}`]: 'png bytes',
    'message.txt': 'The change\n\nVisual baselines captured in CI\n',
    'sha.txt': `${MEASURED}\n`,
    'ref.txt': 'refs/visual/889-bots-push-nothing\n',
    ...over,
  },
});

/** A stand-in for every process and file the fold touches, recording each call. */
const world = (facts: Facts) => {
  const calls: string[] = [];
  const artifacts: NonNullable<Facts['artifacts']> =
    facts.artifacts ?? floorsArtifact();
  let amended = false;
  const io: FoldIo = {
    tempDir: () => DIR,
    download: (runId, dir) => {
      if (facts.downloads === false)
        throw new Error(`downloaded run ${runId}, which must be refused first`);
      calls.push(`gh run download ${runId} -D ${dir}`);
    },
    list: (dir) => {
      expect(dir).toBe(DIR);
      return Object.keys(artifacts);
    },
    read: (file) => {
      const [name, ...rest] = file.slice(`${DIR}/`.length).split('/');
      const body = artifacts[name!]?.[rest.join('/')];
      if (body === undefined) throw new Error(`no such file: ${file}`);
      return body;
    },
    copy: (from, to) => {
      calls.push(`copy ${from} ${to}`);
    },
    git: (args) => {
      calls.push(`git ${args.join(' ')}`);
      const command = args.join(' ');
      if (command === 'rev-parse HEAD')
        return `${amended ? FOLDED : (facts.head ?? MEASURED)}\n`;
      if (command === 'status --porcelain=v1 --untracked-files=all')
        return facts.status ?? '';
      if (command === 'fetch --quiet origin') return '';
      if (command === 'branch -r --contains HEAD --format=%(refname:short)')
        return facts.pushedOn ?? '';
      if (command === 'log -1 --format=%P HEAD')
        return `${amended ? (facts.parentsAfter ?? PARENT) : PARENT}\n`;
      if (command === 'branch --show-current')
        return `${facts.branch ?? '889-bots-push-nothing'}\n`;
      if (args[0] === 'add') return '';
      if (args[0] === 'commit') {
        amended = true;
        return '';
      }
      throw new Error(`unexpected git ${command}`);
    },
  };
  return { io, calls };
};

/** The calls a refusal may have made: reads, and nothing that changes the tree. */
const changedNothing = (calls: readonly string[]) =>
  calls.filter((call) => /^(copy|git add|git commit)\b/.test(call));

describe('fold folds a record into the unpushed commit it measured', () => {
  it('copies the floors in, amends with the CI message, and pushes nothing', () => {
    const { io, calls } = world({});
    const result = fold('39517068529', io);
    expect(result).toEqual({
      folded: [
        `Folded 1 file from run 39517068529 (floors-record) into ${FOLDED}.`,
        'Push it once, normally: git push origin 889-bots-push-nothing',
        'Then delete the scratch ref: git push origin --delete refs/floors/889-bots-push-nothing',
      ],
    });
    expect(calls).toEqual([
      `gh run download 39517068529 -D ${DIR}`,
      'git rev-parse HEAD',
      'git status --porcelain=v1 --untracked-files=all',
      'git fetch --quiet origin',
      'git branch -r --contains HEAD --format=%(refname:short)',
      'git branch --show-current',
      'git log -1 --format=%P HEAD',
      `copy ${DIR}/floors-record/floors.json tests/floors.json`,
      'git add -- tests/floors.json',
      `git commit --amend -F ${DIR}/floors-record/message.txt`,
      'git log -1 --format=%P HEAD',
      'git rev-parse HEAD',
    ]);
  });

  it('copies each listed baseline in, and only those', () => {
    const { io, calls } = world({ artifacts: visualArtifact() });
    const result = fold('1', io);
    expect(result).toEqual({
      folded: [
        `Folded 1 file from run 1 (visual-capture) into ${FOLDED}.`,
        'Push it once, normally: git push origin 889-bots-push-nothing',
        'Then delete the scratch ref: git push origin --delete refs/visual/889-bots-push-nothing',
      ],
    });
    expect(changedNothing(calls)).toEqual([
      `copy ${DIR}/visual-capture/files/${BASELINE} ${BASELINE}`,
      `git add -- ${BASELINE}`,
      `git commit --amend -F ${DIR}/visual-capture/message.txt`,
    ]);
  });

  it('folds a full record beside the artifacts its browser shards left (#608)', () => {
    const { io, calls } = world({
      artifacts: {
        ...floorsArtifact(),
        'floors-browser-1': {},
        'floors-browser-10': {},
      },
    });
    expect(fold('8', io)).toEqual({
      folded: [
        `Folded 1 file from run 8 (floors-record) into ${FOLDED}.`,
        'Push it once, normally: git push origin 889-bots-push-nothing',
        'Then delete the scratch ref: git push origin --delete refs/floors/889-bots-push-nothing',
      ],
    });
    expect(changedNothing(calls)).toEqual([
      `copy ${DIR}/floors-record/floors.json tests/floors.json`,
      'git add -- tests/floors.json',
      `git commit --amend -F ${DIR}/floors-record/message.txt`,
    ]);
  });
});

describe('fold refuses, by name, before it changes anything', () => {
  it('refuses a run id that is not a number, and downloads nothing', () => {
    const { io } = world({ downloads: false });
    expect(fold('39517068529; rm -rf .', io)).toEqual({
      refusal:
        'fold-record: a run id is digits only, not "39517068529; rm -rf ."',
    });
  });

  it('refuses a run that left no artifact', () => {
    const { io, calls } = world({ artifacts: {} });
    expect(fold('7', io)).toEqual({
      refusal:
        'fold-record: run 7 holds no artifact; expected exactly one of floors-record, visual-capture',
    });
    expect(calls).toEqual([`gh run download 7 -D ${DIR}`]);
  });

  it('refuses a run that left both artifacts', () => {
    const { io, calls } = world({
      artifacts: { ...floorsArtifact(), ...visualArtifact() },
    });
    expect(fold('7', io)).toEqual({
      refusal:
        'fold-record: run 7 holds floors-record, visual-capture; expected exactly one of floors-record, visual-capture',
    });
    expect(calls).toEqual([`gh run download 7 -D ${DIR}`]);
  });

  it('refuses an artifact it does not know', () => {
    const { io, calls } = world({ artifacts: { 'e2e-accounts-1': {} } });
    expect(fold('7', io)).toEqual({
      refusal:
        'fold-record: run 7 holds e2e-accounts-1; expected exactly one of floors-record, visual-capture',
    });
    expect(calls).toEqual([`gh run download 7 -D ${DIR}`]);
  });

  it('refuses a browser shard’s artifact beside a visual capture (#608)', () => {
    const { io, calls } = world({
      artifacts: { ...visualArtifact(), 'floors-browser-1': {} },
    });
    expect(fold('7', io)).toEqual({
      refusal:
        'fold-record: run 7 holds floors-browser-1, visual-capture; expected exactly one of floors-record, visual-capture',
    });
    expect(calls).toEqual([`gh run download 7 -D ${DIR}`]);
  });

  it('refuses a browser shard’s artifact with no record beside it (#608)', () => {
    const { io, calls } = world({ artifacts: { 'floors-browser-1': {} } });
    expect(fold('7', io)).toEqual({
      refusal:
        'fold-record: run 7 holds floors-browser-1; expected exactly one of floors-record, visual-capture',
    });
    expect(calls).toEqual([`gh run download 7 -D ${DIR}`]);
  });

  it('refuses a name only shaped like a shard’s, beside a record (#608)', () => {
    const { io, calls } = world({
      artifacts: { ...floorsArtifact(), 'floors-browser-x': {} },
    });
    expect(fold('7', io)).toEqual({
      refusal:
        'fold-record: run 7 holds floors-browser-x, floors-record; expected exactly one of floors-record, visual-capture',
    });
    expect(calls).toEqual([`gh run download 7 -D ${DIR}`]);
  });

  it('refuses a run that measured another commit', () => {
    const other = 'd'.repeat(40);
    const { io, calls } = world({ head: other });
    expect(fold('7', io)).toEqual({
      refusal: `fold-record: run 7 measured ${MEASURED}, but HEAD is ${other}: a record folds only into the commit it measured`,
    });
    expect(calls).toEqual([
      `gh run download 7 -D ${DIR}`,
      'git rev-parse HEAD',
    ]);
  });

  it('refuses a dirty tree, naming what is dirty', () => {
    const { io, calls } = world({
      status: ' M src/pages/index.astro\n?? notes.txt\n',
    });
    expect(fold('7', io)).toEqual({
      refusal:
        'fold-record: the tree is dirty, so the amend would carry more than the record; commit or remove these first:\n M src/pages/index.astro\n?? notes.txt',
    });
    expect(calls).toEqual([
      `gh run download 7 -D ${DIR}`,
      'git rev-parse HEAD',
      'git status --porcelain=v1 --untracked-files=all',
    ]);
  });

  it('refuses a HEAD a remote branch already holds: folding would rewrite a pushed commit', () => {
    const { io, calls } = world({ pushedOn: 'origin/889-bots-push-nothing\n' });
    expect(fold('7', io)).toEqual({
      refusal:
        'fold-record: HEAD is already on origin/889-bots-push-nothing, so an amend would need a force-push; fold only into an unpushed commit',
    });
    expect(calls).toEqual([
      `gh run download 7 -D ${DIR}`,
      'git rev-parse HEAD',
      'git status --porcelain=v1 --untracked-files=all',
      'git fetch --quiet origin',
      'git branch -r --contains HEAD --format=%(refname:short)',
    ]);
  });

  it('refuses a detached HEAD, which has no branch to push once', () => {
    const { io, calls } = world({ branch: '' });
    expect(fold('7', io)).toEqual({
      refusal:
        'fold-record: HEAD is detached; check out the branch the record is for',
    });
    expect(calls).toEqual([
      `gh run download 7 -D ${DIR}`,
      'git rev-parse HEAD',
      'git status --porcelain=v1 --untracked-files=all',
      'git fetch --quiet origin',
      'git branch -r --contains HEAD --format=%(refname:short)',
      'git branch --show-current',
    ]);
  });

  it('refuses a floors ref outside refs/floors/', () => {
    const { io, calls } = world({
      artifacts: floorsArtifact({ 'ref.txt': 'refs/heads/develop\n' }),
    });
    expect(fold('7', io)).toEqual({
      refusal:
        'fold-record: run 7 recorded refs/heads/develop, which is not under refs/floors/',
    });
    expect(calls).toEqual([`gh run download 7 -D ${DIR}`]);
  });

  it('refuses a visual ref outside refs/visual/', () => {
    const { io, calls } = world({
      artifacts: visualArtifact({ 'ref.txt': 'refs/floors/x\n' }),
    });
    expect(fold('7', io)).toEqual({
      refusal:
        'fold-record: run 7 recorded refs/floors/x, which is not under refs/visual/',
    });
    expect(calls).toEqual([`gh run download 7 -D ${DIR}`]);
  });

  it('refuses a listed path that is not a baseline, naming each', () => {
    const { io, calls } = world({
      artifacts: visualArtifact({
        'baselines.txt': `${BASELINE}\nscripts/deploy-gate.mjs\ntests/e2e/__screenshots__/nested/x.png\n`,
      }),
    });
    expect(fold('7', io)).toEqual({
      refusal:
        'fold-record: run 7 listed paths that are not baselines, so nothing is folded:\nscripts/deploy-gate.mjs\ntests/e2e/__screenshots__/nested/x.png',
    });
    expect(calls).toEqual([`gh run download 7 -D ${DIR}`]);
  });

  it('refuses a capture that lists no baseline', () => {
    const { io, calls } = world({
      artifacts: visualArtifact({ 'baselines.txt': '\n' }),
    });
    expect(fold('7', io)).toEqual({
      refusal:
        'fold-record: run 7 listed no baseline, so there is nothing to fold',
    });
    expect(calls).toEqual([`gh run download 7 -D ${DIR}`]);
  });
});

describe('fold checks the amend kept the commit’s parents', () => {
  it('says so when the parents moved, after the commit it cannot undo', () => {
    const { io } = world({ parentsAfter: 'e'.repeat(40) });
    expect(fold('7', io)).toEqual({
      refusal: `fold-record: the amend changed the parents from ${PARENT} to ${'e'.repeat(40)}: push nothing, and read git reflog`,
    });
  });
});
