import { describe, expect, it } from 'vitest';
import {
  daemonState,
  inspectorSocket,
  launchdSimPid,
} from '../device/ios/inspector/simulator';

/** Finding a booted simulator's Web Inspector socket from `ps` and `lsof` (#1157 AC1). */

const UDID = '1955585D-532E-4881-9E5F-593D91EE1062';
const OTHER = '0A0A0A0A-0000-4000-8000-000000000000';
const launchdSim = (pid: number, udid: string): string =>
  `${pid} launchd_sim /Users/shyden/Library/Developer/CoreSimulator/Devices/${udid}/data/var/run/launchd_bootstrap.plist`;
const SOCKET =
  '/private/var/tmp/com.apple.launchd.iwuTtG7y0V/com.apple.webinspectord_sim.socket';

describe("a simulator's launchd_sim", () => {
  it('is the one process naming its UDID', () =>
    expect(
      launchdSimPid(
        [
          '  PID COMMAND',
          '  376 /System/Library/mds',
          launchdSim(90001, OTHER),
          ` ${launchdSim(82474, UDID)}`,
        ].join('\n'),
        UDID,
      ),
    ).toBe(82474));
  it('is refused when no booted simulator has that UDID', () =>
    expect(() => launchdSimPid(launchdSim(90001, OTHER), UDID)).toThrow(
      `no booted simulator ${UDID}: boot it with xcrun simctl boot ${UDID}`,
    ));
  it('is refused when two processes name the UDID', () =>
    expect(() =>
      launchdSimPid(
        [launchdSim(82474, UDID), launchdSim(82475, UDID)].join('\n'),
        UDID,
      ),
    ).toThrow(`2 launchd_sim processes name ${UDID} (82474, 82475)`));
});

describe("a simulator's Web Inspector socket", () => {
  it('is the unix socket ending webinspectord_sim.socket', () =>
    expect(
      inspectorSocket(
        [
          'COMMAND     PID   USER   FD   TYPE             DEVICE SIZE/OFF NODE NAME',
          'launchd_s 82474 shyden    4u  unix 0x3a1b2c3d4e5f6071      0t0      /private/var/tmp/com.apple.launchd.iwuTtG7y0V/com.apple.testmanagerd.unix-domain.socket',
          `launchd_s 82474 shyden    5u  unix 0x3a1b2c3d4e5f6072      0t0      ${SOCKET}`,
        ].join('\n'),
      ),
    ).toBe(SOCKET));
  it('is refused, saying so, when the simulator has not opened it', () =>
    expect(() =>
      inspectorSocket(
        'launchd_s 82474 shyden    4u  unix 0x3a1b2c3d4e5f6071      0t0      /private/var/tmp/x/other.socket',
      ),
    ).toThrow(
      'the simulator is booted, but its Web Inspector socket (com.apple.webinspectord_sim.socket) is not open',
    ));
});

describe('the Web Inspector daemon, as a failure names it', () => {
  it('lists every webinspectord pid seen', () =>
    expect(
      daemonState(
        [
          '51798 /usr/libexec/webinspectord',
          `53035 /Library/Developer/CoreSimulator/Volumes/iOS_27A/usr/libexec/webinspectord`,
          `82474 launchd_sim ${SOCKET}`,
          '74631 /var/run/com.apple.security.cryptexd/mnt/x/RuntimeRoot/Applications/MobileSafari.app/MobileSafari',
          '72320 /var/run/x/MobileSafari.app/PlugIns/SafariWidgetExtension.appex/SafariWidgetExtension',
        ].join('\n'),
      ),
    ).toBe('webinspectord pids 51798, 53035; MobileSafari pid 74631'));
  // Measured 2026-11-14 (ps -axo pid,command): a simulator's processes run
  // from a runtime path holding a space, so the name is the path's end, not
  // its first word. Reading the first word saw neither, while both ran.
  it('finds both when their paths hold a space, as a simulator runtime does', () =>
    expect(
      daemonState(
        [
          '85433 /private/var/run/com.apple.security.cryptexd/mnt/com.apple.iPhoneOS.SimulatorRuntime-v24.1.434.0.yTTENJ/Library/Developer/CoreSimulator/Profiles/Runtimes/iOS 27.0.simruntime/Contents/Resources/RuntimeRoot/System/Cryptexes/App/usr/libexec/webinspectord',
          '83167 /var/run/com.apple.security.cryptexd/mnt/com.apple.iPhoneOS.SimulatorRuntime-v24.1.434.0.yTTENJ/Library/Developer/CoreSimulator/Profiles/Runtimes/iOS 27.0.simruntime/Contents/Resources/RuntimeRoot/Applications/MobileSafari.app/MobileSafari',
          '72320 /private/var/run/x/Runtimes/iOS 27.0.simruntime/Contents/Resources/RuntimeRoot/Applications/MobileSafari.app/PlugIns/SafariWidgetExtension.appex/SafariWidgetExtension',
        ].join('\n'),
      ),
    ).toBe('webinspectord pids 85433; MobileSafari pid 83167'));
  it('says when neither the daemon nor Safari is running', () =>
    expect(daemonState('376 /System/Library/mds')).toBe(
      'no webinspectord running (launchd_sim starts it on first connect); MobileSafari not running',
    ));
});
