/**
 * Finding a booted iOS Simulator's Web Inspector (#1157 AC1), read from the
 * text `ps -axo pid,command` and `lsof -a -U -p <pid>` print.
 *
 * Measured 2026-11-14 (iOS 27.0, iPhone 18 Pro): the simulator's `launchd_sim`,
 * whose command names its UDID, holds a unix socket ending
 * `com.apple.webinspectord_sim.socket`. It speaks the phone's Web Inspector
 * messages with the same length framing, but with no usbmuxd, lockdown or TLS.
 *
 * Which `webinspectord` serves which simulator is not yet measured, so a
 * failure names every one seen and claims none as this simulator's.
 */

const SOCKET_NAME = 'com.apple.webinspectord_sim.socket';

interface PsLine {
  readonly pid: number;
  readonly command: string;
}

function psLines(ps: string): PsLine[] {
  return ps.split('\n').flatMap((line) => {
    const match = /^\s*(\d+)\s+(.*)$/.exec(line);
    return match ? [{ pid: Number(match[1]), command: match[2] }] : [];
  });
}

const executable = (command: string): string =>
  command.split(/\s+/)[0].split('/').pop() ?? '';

/** The pid of the one `launchd_sim` whose command names `udid`. */
export function launchdSimPid(ps: string, udid: string): number {
  const found = psLines(ps).filter(
    (line) =>
      executable(line.command) === 'launchd_sim' && line.command.includes(udid),
  );
  if (found.length === 0)
    throw new Error(
      `no booted simulator ${udid}: boot it with xcrun simctl boot ${udid}`,
    );
  if (found.length > 1)
    throw new Error(
      `${found.length} launchd_sim processes name ${udid} (${found.map((line) => line.pid).join(', ')})`,
    );
  return found[0].pid;
}

/** The path of the Web Inspector socket among the unix sockets `lsof` lists. */
export function inspectorSocket(lsof: string): string {
  const path = lsof
    .split('\n')
    .map((line) => line.trim().split(/\s+/).pop() ?? '')
    .find((name) => name.endsWith(`/${SOCKET_NAME}`));
  if (path === undefined)
    throw new Error(
      `the simulator is booted, but its Web Inspector socket (${SOCKET_NAME}) is not open`,
    );
  return path;
}

/** Every `webinspectord` running, for a failure to name. */
export function daemonState(ps: string): string {
  const pids = psLines(ps)
    .filter((line) => executable(line.command) === 'webinspectord')
    .map((line) => line.pid);
  return pids.length === 0
    ? 'no webinspectord running'
    : `webinspectord pids ${pids.join(', ')}`;
}
