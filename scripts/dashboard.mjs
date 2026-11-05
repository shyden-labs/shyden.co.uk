#!/usr/bin/env node
/**
 * The live dashboard for `npm run test:devices`. See
 * docs/superpowers/specs/2026-08-08-real-device-test-harness-design.md for
 * the design this whole harness implements. An HTTP server AND the page it
 * serves, in one file, exactly as asked.
 *
 * WHAT THIS IS, AND WHAT IT IS NOT. This is an OBSERVER. It tails plain
 * JSON-lines files that `tests/reporters/jsonl-reporter.ts` (Playwright)
 * and `tests/reporters/jsonl-vitest.ts` (Vitest) already write, and a few
 * small JSON artifacts `scripts/test-devices.mjs` and
 * `tests/device/ios/session.ts` already write for their own reasons. It
 * never runs a test, never touches a device, and never influences the
 * exit code of anything -- `scripts/test-devices.mjs` reads every child's
 * exit code directly off that child's own `close` event, exactly as
 * before this file existed, whether or not this server is even running.
 * If this process throws or never starts, the run is unaffected -- the
 * caller (`startDashboard` in test-devices.mjs) only ever WARNS, never
 * throws, on a dashboard failure.
 *
 * NO NEW DEPENDENCIES. Node's `http` module and Server-Sent Events are the
 * whole transport. The page below is one inline, self-contained HTML
 * document -- no CDN, no external fonts, no third-party request of any
 * kind, matching this project's own standing site policy even though this
 * page is not part of the shipped site.
 *
 * LIFECYCLE. Deliberately NOT tied to `scripts/test-devices.mjs`'s own
 * process: it is spawned `detached`, its stdio goes to a log file (not a
 * pipe -- a piped child that outlives its parent gets EPIPE the moment the
 * parent's own file descriptors close), and it is never killed in that
 * script's `cleanup()`. The task brief requires the dashboard to "keep the
 * server alive after the run so the final state stays readable" -- a human
 * has to be able to open the URL, or leave a tab open, and still see the
 * finished run after `npm run test:devices` itself has exited. The only
 * thing that ever stops a previous run's dashboard is the NEXT run's own
 * startup, which frees this server's port the same way the shared preview
 * server's port is freed -- by port, never by process-name pattern.
 */
import { die, stackOf } from './errors.mjs';
import {
  DASHBOARD_FILES,
  IOS_MODE_FILE,
  REPORT_DIR,
  killByPort,
} from './test-devices.mjs';
import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  readSync,
  statSync,
} from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const PORT = Number(process.env.DASHBOARD_PORT) || 4322;
// Condition-based tail interval, not a "sleep and hope": each tick checks
// a real condition (has a file's size changed?) and acts only if so. This
// is the same idiom scripts/test-devices.mjs's own `waitUntil` already
// uses for a bounded wait; the difference here is scope, not principle --
// a live server's own background refresh loop is expected to keep polling
// for as long as the server runs, not stop once one condition is met.
const POLL_MS = 250;

// Every file below is WRITTEN by scripts/test-devices.mjs, and its paths are
// imported from there rather than copied: this is a separate process, but
// the harness only runs `main()` when it is the entry point, so importing it
// costs nothing (tests/unit/dashboard-paths.test.ts). That file's comment on
// DASHBOARD_STATE_DIR says why the live files cannot sit under test-results/.
const JSONL_FILE = DASHBOARD_FILES.jsonl;
/**
 * The groups in page order, one per live file the harness writes.
 *
 * @typedef {keyof typeof JSONL_FILE} GroupName
 */
const GROUP_NAMES = /** @type {GroupName[]} */ (Object.keys(JSONL_FILE));
const GROUPS_FILE = DASHBOARD_FILES.groups;
const FINAL_FILE = DASHBOARD_FILES.final;
// Still under test-results/, unlike the files above: tests/device/ios/
// session.ts writes it once per run. This dashboard reads it the same way it
// reads everything else -- tolerantly, and it only ever OVERWRITES its own
// last-known value when a fresh read succeeds (refreshArtifacts, below), so a
// transient disappearance shows as "nothing new yet", never as the banner
// vanishing once shown.
// No `ios` report: that group is a Vitest run, not Playwright, so there is
// no HTML report to link to.
const REPORT_INDEX = {
  desktop: path.join(REPORT_DIR.desktop, 'index.html'),
  android: path.join(REPORT_DIR.android, 'index.html'),
};

// ── live state, built from the jsonl tail + the small JSON artifacts ───

/**
 * @typedef {{ id: string, title: string, project: string, at: string }} RunningTest
 * @typedef {{ title: string, project: string, at: string }} Failure
 */

/**
 * One group's live state.
 *
 * Declared rather than inferred: every field below starts `null` or `[]`, so
 * TypeScript reads the INITIAL value as the type -- `report` became `null`,
 * and the line that later assigns it a `file://` URL was an error. The same
 * shape that made `parents = []` mean `never[]` in #157.
 *
 * @returns {{
 *   expected: boolean,
 *   notRun: { reason: string } | null,
 *   total: number | null,
 *   passed: number,
 *   failed: number,
 *   skipped: number,
 *   running: RunningTest[],
 *   failures: Failure[],
 *   beganAt: string | null,
 *   endedAt: string | null,
 *   final: Record<string, unknown> | null,
 *   report: string | null,
 *   mode: Record<string, unknown> | null,
 * }}
 */
function freshGroup() {
  return {
    expected: true,
    notRun: null, // { reason } once known -- device absent, never attempted
    total: null,
    passed: 0,
    failed: 0,
    skipped: 0,
    running: [], // [{ id, title, project, at }], in-flight right now
    failures: [], // [{ title, project, at }], in the order they happened
    beganAt: null,
    endedAt: null,
    final: null, // authoritative { status, passed, failed, skippedByDesign, durationMs, reason } once the run script writes it
    report: null, // file:// URL once the Playwright HTML report exists
    mode: null, // ios only: { mode, description, device, decidedAt }
  };
}

const state = {
  dashboardStartedAt: Date.now(),
  aborted: null, // fatal error message if the whole run aborted before groups even started
  groups: Object.fromEntries(GROUP_NAMES.map((name) => [name, freshGroup()])),
};

// Per-file tail position, so each poll reads only what is NEW since the
// last one -- never re-parses the whole file, never sleeps waiting for
// growth. `size` guards against the file having been TRUNCATED (a new run
// starting: both reporters truncate their file at the top of their own
// run -- see their own module docs) out from under an already-open tail;
// a shrink is the signal to reset both the read position and this group's
// accumulated counts, or a second run's numbers would silently pile onto
// the first run's.
const tail = Object.fromEntries(
  GROUP_NAMES.map((name) => [name, { offset: 0, partial: '' }]),
);

/**
 * @param {ReturnType<typeof freshGroup>} group
 * @param {{ id: string, title: string, project: string, at: string } & Record<string, any>} ev
 */
function applyEvent(group, ev) {
  switch (ev.event) {
    case 'begin':
      group.total = ev.total;
      group.beganAt = ev.at;
      break;
    case 'test-start':
      group.running.push({
        id: ev.id,
        title: ev.title,
        project: ev.project,
        at: ev.at,
      });
      break;
    case 'test':
      group.running = group.running.filter((r) => r.id !== ev.id);
      if (ev.status === 'passed') group.passed += 1;
      else if (ev.status === 'skipped') group.skipped += 1;
      else {
        group.failed += 1;
        group.failures.push({
          title: ev.title,
          project: ev.project,
          at: ev.at,
        });
      }
      break;
    case 'end':
      group.endedAt = ev.at;
      break;
    default:
    // An event type this version of the dashboard doesn't know about --
    // ignored, not thrown. A future reporter change adding a field must
    // not be able to take the dashboard down; see this file's own module
    // doc on never being able to affect the run.
  }
}

/** @param {GroupName} name */
function tailOneFile(name) {
  const file = JSONL_FILE[name];
  const t = tail[name];
  let size;
  try {
    size = statSync(file).size;
  } catch {
    return false; // file doesn't exist yet -- this group's process hasn't started its reporter
  }

  if (size < t.offset) {
    // Truncated since we last read it: a fresh run started. Reset both the
    // read position and everything this dashboard has accumulated for this
    // group so far, not just the offset -- otherwise a new run's counts
    // would add onto the previous run's.
    t.offset = 0;
    t.partial = '';
    state.groups[name] = freshGroup();
  }
  if (size === t.offset) return false; // nothing new

  const fd = openSync(file, 'r');
  let changed = false;
  try {
    const length = size - t.offset;
    const buf = Buffer.alloc(length);
    const bytesRead = readSync(fd, buf, 0, buf.length, t.offset);
    t.offset += bytesRead;
    const text = t.partial + buf.toString('utf8', 0, bytesRead);
    const lines = text.split('\n');
    t.partial = lines.pop() ?? ''; // last element is either '' (text ended in \n) or a not-yet-flushed partial line
    for (const line of lines) {
      if (!line) continue;
      let ev;
      try {
        ev = JSON.parse(line);
      } catch {
        continue; // a torn line should not be possible (appendFileSync's writes are whole-line and small enough to be atomic), but a parse failure must not crash the tailer -- skip it, the next tick's growth is unaffected
      }
      applyEvent(state.groups[name], ev);
      changed = true;
    }
  } finally {
    closeSync(fd);
  }
  return changed;
}

/** @param {string} file */
function readJsonIfPresent(file) {
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null; // a reader must never crash on a writer's half-written file; next tick sees the completed write
  }
}

function refreshArtifacts() {
  const groups = readJsonIfPresent(GROUPS_FILE);
  if (groups) {
    for (const name of GROUP_NAMES) {
      if (groups[name]?.notRun) {
        state.groups[name].expected = true;
        state.groups[name].notRun = groups[name].notRun;
      }
    }
  }

  const final = readJsonIfPresent(FINAL_FILE);
  if (final) {
    state.aborted = final.aborted ?? null;
    if (Array.isArray(final.groups)) {
      for (const g of final.groups) {
        if (state.groups[g.name]) state.groups[g.name].final = g;
      }
    }
  }

  const mode = readJsonIfPresent(IOS_MODE_FILE);
  if (mode) state.groups.ios.mode = mode;

  for (const [name, indexFile] of Object.entries(REPORT_INDEX)) {
    if (existsSync(indexFile))
      state.groups[name].report = `file://${indexFile}`;
  }
}

let lastBroadcast = '';
const clients = new Set();

function broadcastIfChanged() {
  const serialized = JSON.stringify(state);
  if (serialized === lastBroadcast) return;
  lastBroadcast = serialized;
  const frame = `event: state\ndata: ${serialized}\n\n`;
  for (const res of clients) {
    try {
      res.write(frame);
    } catch {
      clients.delete(res); // a dead connection must not stop the next client's update
    }
  }
}

function tick() {
  try {
    for (const name of GROUP_NAMES) tailOneFile(name);
    refreshArtifacts();
    broadcastIfChanged();
  } catch (error) {
    // The tailer must survive a bad tick (a half-written file, a transient
    // fs error) and keep serving whatever it already knows -- this process
    // going quiet on one file must never mean the whole dashboard dies.
    // eslint-disable-next-line no-console
    console.error(`[dashboard] tick failed (continuing): ${stackOf(error)}`);
  } finally {
    setTimeout(tick, POLL_MS);
  }
}

// ── the page: one self-contained HTML document, no external requests ───

const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>test:devices dashboard</title>
<style>
  :root {
    color-scheme: dark light;
    --bg: #0b0f14; --card: #131a22; --border: #2a323c; --text: #e6edf3; --muted: #8b949e;
    --passed: #2ea043; --failed: #f85149; --skipped: #d29922; --running: #58a6ff; --notrun: #6e7681;
  }
  @media (prefers-color-scheme: light) {
    :root { --bg: #f5f7fa; --card: #ffffff; --border: #d0d7de; --text: #1b2430; --muted: #57606a; }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 1.25rem; background: var(--bg); color: var(--text);
    font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
  }
  h1 { font-size: 1.15rem; margin: 0 0 0.25rem; }
  .sub { color: var(--muted); margin: 0 0 1rem; font-size: 0.85rem; }
  .conn { display: inline-block; width: 0.55rem; height: 0.55rem; border-radius: 50%; margin-right: 0.4rem; background: var(--notrun); }
  .conn.up { background: var(--passed); }
  .abort {
    background: var(--failed); color: #fff; padding: 0.75rem 1rem; border-radius: 6px;
    margin-bottom: 1rem; font-weight: 600;
  }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 1rem; }
  .card { background: var(--card); border: 1px solid var(--border); border-radius: 10px; padding: 1rem; min-width: 0; }
  .card h2 { margin: 0 0 0.6rem; font-size: 1rem; display: flex; align-items: center; justify-content: space-between; }
  .badge { font-size: 0.7rem; font-weight: 700; letter-spacing: 0.04em; padding: 0.15rem 0.5rem; border-radius: 999px; text-transform: uppercase; }
  .badge.pending { background: var(--notrun); color: #fff; }
  .badge.running { background: var(--running); color: #fff; }
  .badge.passed { background: var(--passed); color: #fff; }
  .badge.failed { background: var(--failed); color: #fff; }
  .badge.notrun { background: var(--notrun); color: #fff; }
  .bar { height: 10px; border-radius: 6px; overflow: hidden; display: flex; background: var(--border); margin: 0.5rem 0; }
  .bar span { height: 100%; }
  .bar .p { background: var(--passed); } .bar .f { background: var(--failed); } .bar .s { background: var(--skipped); }
  .counts { display: flex; gap: 1rem; font-variant-numeric: tabular-nums; margin-bottom: 0.6rem; flex-wrap: wrap; }
  .count { display: flex; align-items: center; gap: 0.35rem; }
  .dot { width: 0.6rem; height: 0.6rem; border-radius: 50%; display: inline-block; }
  .dot.p { background: var(--passed); } .dot.f { background: var(--failed); } .dot.s { background: var(--skipped); }
  .count b { font-size: 1rem; }
  .section-label { color: var(--muted); font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.05em; margin: 0.7rem 0 0.3rem; }
  .running-list, .fail-list { list-style: none; margin: 0; padding: 0; max-height: 8rem; overflow-y: auto; }
  .running-list li, .fail-list li { padding: 0.2rem 0; font-size: 0.82rem; border-bottom: 1px dashed var(--border); }
  .running-list li:last-child, .fail-list li:last-child { border-bottom: none; }
  .fail-list li { color: var(--failed); }
  .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  .mode-banner { border-radius: 6px; padding: 0.6rem 0.7rem; margin-bottom: 0.6rem; font-size: 0.82rem; line-height: 1.4; }
  .mode-banner.dom-dispatch { background: #3a2a00; border: 1px solid var(--skipped); color: #ffd876; }
  @media (prefers-color-scheme: light) { .mode-banner.dom-dispatch { background: #fff6d9; color: #6b4e00; } }
  .mode-banner.native { background: rgba(46,160,67,0.12); border: 1px solid var(--passed); }
  .empty { color: var(--muted); font-style: italic; }
  .report-link { display: inline-block; margin-top: 0.5rem; font-size: 0.8rem; }
  .report-path { display: block; color: var(--muted); font-size: 0.72rem; word-break: break-all; margin-top: 0.15rem; }
  .not-run-box { color: var(--notrun); }
  footer { margin-top: 1.5rem; color: var(--muted); font-size: 0.75rem; }
</style>
</head>
<body>
  <h1><span id="conn" class="conn"></span>test:devices — live dashboard</h1>
  <p class="sub" id="sub">connecting…</p>
  <div id="abort"></div>
  <div class="grid" id="grid"></div>
  <footer>Reporters: tests/reporters/jsonl-reporter.ts (Playwright) · tests/reporters/jsonl-vitest.ts (Vitest). This page is an observer only — it never affects a test outcome.</footer>

<script>
(function () {
  var GROUP_LABEL = { desktop: 'Desktop (emulated, 5 projects)', android: 'Android (real device)', ios: 'iOS (real device)' };
  var grid = document.getElementById('grid');
  var sub = document.getElementById('sub');
  var abortBox = document.getElementById('abort');
  var connDot = document.getElementById('conn');
  var latest = null;

  // Escape-on-output discipline: every piece of DYNAMIC text this page
  // inserts via innerHTML (test titles, project names, failure/not-run
  // reasons, the iOS mode description, report paths) MUST be passed
  // through esc() at the point it is concatenated into an HTML string --
  // never interpolated raw, even though today's only source is this
  // project's own first-party test titles, not external input. Escapes
  // all five characters relevant to both text-node and quoted-attribute
  // context, which is every context this page uses. Structural markup
  // (tag names, fixed class names, numbers) is never escaped because it is
  // never variable -- only literals from a small fixed set chosen in code.
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmtMs(ms) {
    if (ms == null) return '—';
    var s = ms / 1000;
    if (s < 60) return s.toFixed(1) + 's';
    var m = Math.floor(s / 60);
    return m + 'm ' + Math.round(s - m * 60) + 's';
  }

  function renderGroup(name, g) {
    var label = GROUP_LABEL[name] || name;
    var badge, badgeClass;
    if (g.notRun) { badge = 'NOT RUN'; badgeClass = 'notrun'; }
    else if (g.final) { badge = g.final.status.toUpperCase(); badgeClass = g.final.status === 'passed' ? 'passed' : (g.final.status === 'not-run' ? 'notrun' : 'failed'); }
    else if (g.total == null) { badge = 'pending'; badgeClass = 'pending'; }
    else if (g.endedAt) { badge = g.failed > 0 ? 'FAILED' : 'PASSED'; badgeClass = g.failed > 0 ? 'failed' : 'passed'; }
    else { badge = 'running'; badgeClass = 'running'; }

    var html = '<h2>' + esc(label) + ' <span class="badge ' + badgeClass + '">' + esc(badge) + '</span></h2>';

    if (g.mode && g.mode.mode) {
      html += '<div class="mode-banner ' + (g.mode.mode === 'dom-dispatch' ? 'dom-dispatch' : 'native') + '">' + esc(g.mode.description) + '</div>';
    }

    if (g.notRun) {
      html += '<p class="not-run-box">Device absent — this group was never attempted.<br><span class="mono">' + esc(g.notRun.reason) + '</span></p>';
      return html;
    }
    if (g.total == null) {
      html += '<p class="empty">Waiting for this group to start…</p>';
      return html;
    }

    var passed = g.final ? g.final.passed : g.passed;
    var failed = g.final ? g.final.failed : g.failed;
    var skipped = g.final ? g.final.skippedByDesign : g.skipped;
    // g.total (live) counts only what the jsonl 'begin' event saw, i.e.
    // what Playwright/Vitest actually COLLECTED. The authoritative
    // skippedByDesign in g.final can be larger than that: it also counts
    // tests excluded by the emulated-viewport tag's grepInvert BEFORE
    // collection ever happens (android-chrome only), which the live
    // stream never saw at all. Caught live: without this, a finished
    // Android run showed "223 / 176" -- done exceeding total, individually
    // correct numbers read together as nonsense. Once final data exists,
    // the displayed total is recomputed from the SAME three authoritative
    // numbers being shown, so it can never disagree with them.
    var total = g.final ? passed + failed + skipped : g.total;
    var done = passed + failed + skipped;
    var pct = function (n) { return total > 0 ? (100 * n / total) : 0; };

    html += '<div class="bar"><span class="p" style="width:' + pct(passed) + '%"></span><span class="f" style="width:' + pct(failed) + '%"></span><span class="s" style="width:' + pct(skipped) + '%"></span></div>';
    html += '<div class="counts">'
      + '<span class="count"><span class="dot p"></span>Passed <b>' + passed + '</b></span>'
      + '<span class="count"><span class="dot f"></span>Failed <b>' + failed + '</b></span>'
      + '<span class="count"><span class="dot s"></span>Skipped <b>' + skipped + '</b></span>'
      + '<span class="count">' + done + ' / ' + total + '</span>'
      + '</div>';

    var elapsed = g.endedAt ? (g.final ? g.final.durationMs : (g.endedAt - g.beganAt)) : (g.beganAt ? (Date.now() - g.beganAt) : null);
    html += '<div class="section-label">Duration</div><div class="mono">' + fmtMs(elapsed) + (g.endedAt ? '' : ' (running…)') + '</div>';

    html += '<div class="section-label">Currently running</div>';
    if (g.running.length === 0) {
      html += '<p class="empty">' + (g.endedAt ? 'finished' : 'idle') + '</p>';
    } else {
      html += '<ul class="running-list">' + g.running.map(function (r) {
        return '<li class="mono">[' + esc(r.project) + '] ' + esc(r.title) + '</li>';
      }).join('') + '</ul>';
    }

    html += '<div class="section-label">Failures (' + g.failures.length + ')</div>';
    if (g.failures.length === 0) {
      html += '<p class="empty">none so far</p>';
    } else {
      html += '<ul class="fail-list">' + g.failures.map(function (f) {
        return '<li class="mono">[' + esc(f.project) + '] ' + esc(f.title) + '</li>';
      }).join('') + '</ul>';
    }

    // Gated on g.endedAt, not merely g.report: the html reporter only
    // (re)writes index.html at its own onEnd, so the file existing while
    // this group is still running means it is a PREVIOUS run's report,
    // not this one's -- caught live: a mid-run screenshot showed a report
    // link before this run's own desktop group had finished. Once
    // endedAt is set, the html reporter has (per Playwright's own
    // reporter-dispatch order, list -> json -> html -> jsonl in the CLI
    // string this project uses) already run its onEnd and the file is
    // this run's own.
    if (g.report && g.endedAt) {
      html += '<a class="report-link" href="' + esc(g.report) + '" target="_blank" rel="noopener">View HTML report</a>';
      html += '<span class="report-path">' + esc(g.report) + '</span>';
    }

    return html;
  }

  function render(state) {
    latest = state;
    connDot.classList.add('up');
    if (state.aborted) {
      abortBox.innerHTML = '<div class="abort">RUN ABORTED: ' + esc(state.aborted) + '</div>';
    } else {
      abortBox.innerHTML = '';
    }
    var order = ['desktop', 'android', 'ios'];
    grid.innerHTML = order.map(function (name) {
      return '<div class="card">' + renderGroup(name, state.groups[name]) + '</div>';
    }).join('');
    var anyStarted = order.some(function (n) { return state.groups[n].beganAt; });
    sub.textContent = anyStarted ? 'live — updates as each group runs' : 'waiting for the run to start…';
  }

  function tickClock() {
    if (latest) render(latest);
  }
  setInterval(tickClock, 1000);

  function connect() {
    var es = new EventSource('/events');
    es.addEventListener('state', function (e) { render(JSON.parse(e.data)); });
    es.onerror = function () { connDot.classList.remove('up'); };
  }
  connect();
})();
</script>
</body>
</html>
`;

// ── the server ───────────────────────────────────────────────────────

/**
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 */
function handleRequest(req, res) {
  const pathname = (req.url || '/').split('?')[0];

  if (pathname === '/' || pathname === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(PAGE);
    return;
  }

  if (pathname === '/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    });
    res.write(':ok\n\n'); // comment line -- opens the stream immediately for slower clients/proxies
    clients.add(res);
    res.write(`event: state\ndata: ${JSON.stringify(state)}\n\n`); // full snapshot immediately, whether the run is mid-flight or long finished
    req.on('close', () => clients.delete(res));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('not found');
}

async function main() {
  // Takes no arguments; refusing one proves `main()` ran (#227).
  const unexpected = process.argv.slice(2);
  if (unexpected.length > 0)
    die(`dashboard.mjs takes no arguments, received: ${unexpected.join(' ')}`);

  await killByPort(PORT); // whatever's there is, by construction, a previous run's own stale dashboard -- see module doc

  const server = http.createServer((req, res) => {
    try {
      handleRequest(req, res);
    } catch (error) {
      // A request handler throwing must not take the process down --
      // this server has to keep serving every other client and every
      // later tick regardless of one bad request.
      // eslint-disable-next-line no-console
      console.error(
        `[dashboard] request handler failed (continuing): ${stackOf(error)}`,
      );
      try {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('internal error');
      } catch {
        // response may already be partially sent -- nothing more to do
      }
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(PORT, '0.0.0.0', () => resolve(undefined));
  });

  // eslint-disable-next-line no-console
  console.log(`[dashboard] listening on http://localhost:${PORT}/`);
  tick();

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => {
      // eslint-disable-next-line no-console
      console.log(`[dashboard] received ${signal}, shutting down`);
      // `server.close()` alone stops accepting NEW connections and frees
      // the port almost immediately (which is all killByPort's own
      // condition checks for), but its callback -- and so this process's
      // own exit -- does not fire until every ALREADY-OPEN connection
      // ends. An SSE stream is deliberately held open forever by design
      // (that is what makes it live), so a browser tab left watching the
      // dashboard across runs, exactly the intended use ("leave it open
      // to watch"), would otherwise keep this process alive indefinitely
      // after being told to shut down -- observed live: the previous
      // run's dashboard process was still present in `ps`, sleeping, long
      // after the next run's dashboard had already taken over the port.
      // Ending every open SSE response explicitly is what lets `close()`'s
      // callback -- and this process's own exit -- actually happen
      // promptly; the connected browser's EventSource simply reconnects
      // (its own standard behaviour) once a new dashboard exists.
      for (const res of clients) {
        try {
          res.end();
        } catch {
          // already gone -- fine
        }
      }
      server.close(() => process.exit(0));
    });
  }
}

if (import.meta.main) await main();
