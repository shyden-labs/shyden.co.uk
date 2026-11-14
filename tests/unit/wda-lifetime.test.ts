import type { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  parseReadyLine,
  startWda,
  WDA_PIN,
  WDA_READY_CEILING_MS,
} from '../../scripts/wda.mjs';

/**
 * The device run owns WebDriverAgent's lifetime (#838): it builds WDA when
 * this pin has no build yet, starts it on the iPhone, hands on the address it
 * answers on over USB, and always stops it. Every process and command here is
 * a stand-in: a unit test starts nothing.
 */

const UDID = '00008150-000954D90A20401C';
const CACHE = '/cache/shyden-wda';
const XCTESTRUN = `${CACHE}/${WDA_PIN}/dd/Build/Products/WebDriverAgentRunner_iphoneos27.1-arm64.xctestrun`;
const READY =
  '2026-10-31 20:04:52.870906+0700 WebDriverAgentRunner-Runner[1:2] ServerURLHere->http://192.168.1.3:8100<-ServerURLHere';
const DETAILS =
  '    • Tunnel IP Address: fd97:eff2:bed2::1\n    • Tunnel Transport Protocol: tcp\n';

class FakeChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  signals: string[] = [];
  exitOnKill = true;
  kill(signal = 'SIGTERM'): boolean {
    this.signals.push(signal);
    if (this.exitOnKill) queueMicrotask(() => this.emit('exit', null, signal));
    return true;
  }
  print(text: string): void {
    this.stdout.emit('data', Buffer.from(`${text}\n`));
  }
}

function harness({
  built = true,
  alive = null as string | null,
}: { built?: boolean; alive?: string | null } = {}) {
  const child = new FakeChild();
  const runs: string[][] = [];
  const spawns: string[][] = [];
  let aliveNow = alive;
  const deps = {
    run: vi.fn(async (file: string, args: string[]): Promise<string> => {
      runs.push([file, ...args]);
      if (file === 'xcrun') return DETAILS;
      return '';
    }),
    spawn: vi.fn((file: string, args: string[]) => {
      spawns.push([file, ...args]);
      return child as unknown as ChildProcess;
    }),
    findXctestrun: vi.fn((): string | null => (built ? XCTESTRUN : null)),
    hasSource: vi.fn(() => true),
    alive: vi.fn(() => aliveNow),
    answers: vi.fn(async (_url: string): Promise<void> => {}),
  };
  return {
    child,
    runs,
    spawns,
    deps,
    setAlive: (v: string | null) => (aliveNow = v),
  };
}

const flush = () => new Promise((r) => setImmediate(r));

describe('parseReadyLine', () => {
  it("reads the URL from xcodebuild's ready line", () => {
    expect(parseReadyLine(READY)).toBe('http://192.168.1.3:8100');
  });
  it('returns null for any other line', () => {
    expect(parseReadyLine('Test Suite started')).toBeNull();
  });
});

describe('startWda', () => {
  beforeEach(() => vi.useRealTimers());
  afterEach(() => vi.useRealTimers());

  it('resolves with the USB tunnel URL once the ready line prints', async () => {
    const h = harness();
    const started = startWda({ udid: UDID, cacheDir: CACHE, ...h.deps });
    await flush();
    h.child.print(READY);
    const wda = await started;
    expect(wda.url).toBe('http://[fd97:eff2:bed2::1]:8100');
    expect(h.runs).toContainEqual([
      'xcrun',
      'devicectl',
      'device',
      'info',
      'details',
      '--device',
      UDID,
    ]);
  });

  it('runs the existing build without building again', async () => {
    const h = harness({ built: true });
    const started = startWda({ udid: UDID, cacheDir: CACHE, ...h.deps });
    await flush();
    h.child.print(READY);
    await started;
    expect(h.runs.some((r) => r.includes('build-for-testing'))).toBe(false);
    expect(h.spawns).toEqual([
      [
        'xcodebuild',
        'test-without-building',
        '-xctestrun',
        XCTESTRUN,
        '-destination',
        `id=${UDID}`,
      ],
    ]);
  });

  it('builds for this pin, signed as the operator, when no build exists', async () => {
    const h = harness({ built: false });
    h.deps.findXctestrun.mockReturnValueOnce(null).mockReturnValue(XCTESTRUN);
    const started = startWda({ udid: UDID, cacheDir: CACHE, ...h.deps });
    await flush();
    h.child.print(READY);
    await started;
    const build = h.runs.find((r) => r.includes('build-for-testing'));
    expect(build).toEqual([
      'xcodebuild',
      'build-for-testing',
      '-project',
      `${CACHE}/${WDA_PIN}/src/WebDriverAgent.xcodeproj`,
      '-scheme',
      'WebDriverAgentRunner',
      '-destination',
      `id=${UDID}`,
      '-derivedDataPath',
      `${CACHE}/${WDA_PIN}/dd`,
      '-allowProvisioningUpdates',
      'DEVELOPMENT_TEAM=F3XX4PM3MF',
      'CODE_SIGN_STYLE=Automatic',
      'PRODUCT_BUNDLE_IDENTIFIER=uk.co.shyden.wda',
    ]);
  });

  it('clones the pinned source when it is missing', async () => {
    const h = harness();
    h.deps.hasSource.mockReturnValue(false);
    const started = startWda({ udid: UDID, cacheDir: CACHE, ...h.deps });
    await flush();
    h.child.print(READY);
    await started;
    expect(h.runs).toContainEqual([
      'git',
      'clone',
      '--filter=blob:none',
      'https://github.com/appium/WebDriverAgent.git',
      `${CACHE}/${WDA_PIN}/src`,
    ]);
    expect(h.runs).toContainEqual([
      'git',
      '-C',
      `${CACHE}/${WDA_PIN}/src`,
      'checkout',
      WDA_PIN,
    ]);
  });

  it('rejects at the ceiling, naming the last lines, and kills the child', async () => {
    vi.useFakeTimers();
    const h = harness();
    const started = startWda({ udid: UDID, cacheDir: CACHE, ...h.deps });
    const verdict = expect(started).rejects.toThrow(
      /WebDriverAgent printed no ready line within 180 s[\s\S]*signing failed/,
    );
    await vi.advanceTimersByTimeAsync(0);
    h.child.print('signing failed');
    await vi.advanceTimersByTimeAsync(WDA_READY_CEILING_MS);
    await verdict;
    expect(h.child.signals).toContain('SIGTERM');
  });

  it('rejects when xcodebuild exits before the ready line', async () => {
    const h = harness();
    const started = startWda({ udid: UDID, cacheDir: CACHE, ...h.deps });
    await flush();
    h.child.print('** TEST EXECUTE FAILED **');
    h.child.emit('exit', 65, null);
    await expect(started).rejects.toThrow(
      /exited \(code 65, signal null\) before its ready line[\s\S]*TEST EXECUTE FAILED/,
    );
  });

  it('refuses when a runner is already alive for this iPhone', async () => {
    const h = harness({ alive: '4242' });
    await expect(
      startWda({ udid: UDID, cacheDir: CACHE, ...h.deps }),
    ).rejects.toThrow(/already running .*pid 4242/);
    expect(h.spawns).toEqual([]);
  });

  it('stop kills the child and resolves only after it exits', async () => {
    const h = harness();
    const started = startWda({ udid: UDID, cacheDir: CACHE, ...h.deps });
    await flush();
    h.child.print(READY);
    const wda = await started;
    h.child.exitOnKill = false;
    let stopped = false;
    const stopping = wda.stop().then(() => (stopped = true));
    await flush();
    expect(h.child.signals).toEqual(['SIGTERM']);
    expect(stopped).toBe(false);
    h.child.emit('exit', null, 'SIGTERM');
    await stopping;
    expect(stopped).toBe(true);
  });

  it('stop fails naming the pid when a runner outlives it', async () => {
    const h = harness();
    const started = startWda({ udid: UDID, cacheDir: CACHE, ...h.deps });
    await flush();
    h.child.print(READY);
    const wda = await started;
    h.setAlive('5151');
    await expect(wda.stop()).rejects.toThrow(/still running .*pid 5151/);
  });

  // Measured 2026-11-02 on the iPhone Air: the tunnel address read before
  // xcodebuild starts answered EHOSTUNREACH once WDA was up (the device run
  // and a hand probe alike), while one read after the ready line brought the
  // tunnel back and it answered every call, busy and idle, for 220 s.
  it('reads the tunnel address only after the ready line', async () => {
    const h = harness();
    const started = startWda({ udid: UDID, cacheDir: CACHE, ...h.deps });
    await flush();
    expect(h.runs.some((r) => r[0] === 'xcrun')).toBe(false);
    h.child.print(READY);
    await started;
    expect(h.runs.filter((r) => r[0] === 'xcrun')).toHaveLength(1);
  });

  it('hands WDA on only once its tunnel URL answers', async () => {
    const h = harness();
    const started = startWda({ udid: UDID, cacheDir: CACHE, ...h.deps });
    await flush();
    h.child.print(READY);
    await started;
    expect(h.deps.answers).toHaveBeenCalledWith(
      'http://[fd97:eff2:bed2::1]:8100',
    );
  });

  it('fails naming the tunnel, and stops WDA, when the URL does not answer', async () => {
    const h = harness();
    h.deps.answers.mockRejectedValue(new Error('fetch failed EHOSTUNREACH'));
    const started = startWda({ udid: UDID, cacheDir: CACHE, ...h.deps });
    await flush();
    h.child.print(READY);
    await expect(started).rejects.toThrow(
      /WebDriverAgent is up but its tunnel http:\/\/\[fd97:eff2:bed2::1\]:8100 did not answer: fetch failed EHOSTUNREACH/,
    );
    expect(h.child.signals).toContain('SIGTERM');
  });

  it('stops WDA when the tunnel cannot be read after the ready line', async () => {
    const h = harness();
    h.deps.run.mockImplementation(async (file: string) => {
      if (file === 'xcrun') throw new Error('devicectl: device not found');
      return '';
    });
    const started = startWda({ udid: UDID, cacheDir: CACHE, ...h.deps });
    await flush();
    h.child.print(READY);
    await expect(started).rejects.toThrow(/device not found/);
    expect(h.child.signals).toContain('SIGTERM');
  });

  describe('the default answer check, GET /status', () => {
    afterEach(() => vi.unstubAllGlobals());
    const withoutAnswers = (h: ReturnType<typeof harness>) => {
      const { answers: _unused, ...rest } = h.deps;
      return rest;
    };

    it('asks the tunnel URL for /status and hands WDA on at 200', async () => {
      const fetch = vi.fn(
        async (_url: string) => new Response('{}', { status: 200 }),
      );
      vi.stubGlobal('fetch', fetch);
      const h = harness();
      const started = startWda({
        udid: UDID,
        cacheDir: CACHE,
        ...withoutAnswers(h),
      });
      await flush();
      h.child.print(READY);
      await started;
      expect(fetch.mock.calls[0]?.[0]).toBe(
        'http://[fd97:eff2:bed2::1]:8100/status',
      );
    });

    it('names the network error code and the ceiling', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => {
          throw new TypeError('fetch failed', {
            cause: { code: 'EHOSTUNREACH' },
          });
        }),
      );
      const h = harness();
      const started = startWda({
        udid: UDID,
        cacheDir: CACHE,
        ...withoutAnswers(h),
      });
      await flush();
      h.child.print(READY);
      await expect(started).rejects.toThrow(
        /did not answer: GET \/status: fetch failed EHOSTUNREACH \(ceiling 10 s\)/,
      );
    });

    it('refuses an answer that is not 200', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response('', { status: 503 })),
      );
      const h = harness();
      const started = startWda({
        udid: UDID,
        cacheDir: CACHE,
        ...withoutAnswers(h),
      });
      await flush();
      h.child.print(READY);
      await expect(started).rejects.toThrow(/GET \/status answered 503/);
    });
  });
});

/**
 * On a booted simulator (#1157) WDA builds unsigned for the simulator, into
 * its own derived data, and answers on the Mac's own loopback: a simulator
 * shares the host's network, so there is no devicectl tunnel to read.
 * Measured 2026-11-14: `build-for-testing` for `platform=iOS Simulator`
 * succeeded in 84 s with no signing and left
 * `WebDriverAgentRunner_iphonesimulator27.2-arm64.xctestrun`.
 */
describe('startWda on a simulator', () => {
  const SIM = '1955585D-532E-4881-9E5F-593D91EE1062';
  const SIM_PRODUCTS = `${CACHE}/${WDA_PIN}/dd-sim/Build/Products`;
  const SIM_XCTESTRUN = `${SIM_PRODUCTS}/WebDriverAgentRunner_iphonesimulator27.2-arm64.xctestrun`;
  const start = (h: ReturnType<typeof harness>) =>
    startWda({ udid: SIM, simulator: true, cacheDir: CACHE, ...h.deps });

  it("resolves with the Mac's loopback URL and reads no tunnel", async () => {
    const h = harness();
    h.deps.findXctestrun.mockReturnValue(SIM_XCTESTRUN);
    const started = start(h);
    await flush();
    h.child.print(READY);
    const wda = await started;
    expect(wda.url).toBe('http://127.0.0.1:8100');
    expect(h.deps.answers).toHaveBeenCalledWith('http://127.0.0.1:8100');
    expect(h.runs.some((r) => r.includes('devicectl'))).toBe(false);
  });

  it('builds unsigned for the simulator, into its own derived data', async () => {
    const h = harness();
    h.deps.findXctestrun
      .mockReturnValueOnce(null)
      .mockReturnValue(SIM_XCTESTRUN);
    const started = start(h);
    await flush();
    h.child.print(READY);
    await started;
    expect(h.runs.find((r) => r.includes('build-for-testing'))).toEqual([
      'xcodebuild',
      'build-for-testing',
      '-project',
      `${CACHE}/${WDA_PIN}/src/WebDriverAgent.xcodeproj`,
      '-scheme',
      'WebDriverAgentRunner',
      '-destination',
      `platform=iOS Simulator,id=${SIM}`,
      '-derivedDataPath',
      `${CACHE}/${WDA_PIN}/dd-sim`,
    ]);
  });

  it("looks for the simulator's xctestrun in the simulator's products", async () => {
    const h = harness();
    h.deps.findXctestrun.mockReturnValue(SIM_XCTESTRUN);
    const started = start(h);
    await flush();
    h.child.print(READY);
    await started;
    expect(h.deps.findXctestrun).toHaveBeenCalledWith(
      SIM_PRODUCTS,
      'iphonesimulator',
    );
    expect(h.spawns).toEqual([
      [
        'xcodebuild',
        'test-without-building',
        '-xctestrun',
        SIM_XCTESTRUN,
        '-destination',
        `id=${SIM}`,
      ],
    ]);
  });

  it("looks for the iPhone's xctestrun in the iPhone's products", async () => {
    const h = harness();
    const started = startWda({ udid: UDID, cacheDir: CACHE, ...h.deps });
    await flush();
    h.child.print(READY);
    await started;
    expect(h.deps.findXctestrun).toHaveBeenCalledWith(
      `${CACHE}/${WDA_PIN}/dd/Build/Products`,
      'iphoneos',
    );
  });

  it('fails naming the loopback URL, and stops WDA, when it does not answer', async () => {
    const h = harness();
    h.deps.findXctestrun.mockReturnValue(SIM_XCTESTRUN);
    h.deps.answers.mockRejectedValue(new Error('fetch failed ECONNREFUSED'));
    const started = start(h);
    await flush();
    h.child.print(READY);
    await expect(started).rejects.toThrow(
      'WebDriverAgent is up on the simulator but http://127.0.0.1:8100 did not answer: fetch failed ECONNREFUSED',
    );
    expect(h.child.signals).toContain('SIGTERM');
  });
});
