import type { Leftovers, SexMode } from './grouping';
import type { Strings } from './i18n';

/**
 * Everything a collapsed section header needs to describe itself.
 *
 * `dirty` cannot be made `true` by anything built so far -- there is no
 * roster yet, and a roster is what gets lost. It is declared here because
 * the shape is needed now, and it is honest to default it `false`: with
 * nothing to lose, "nothing to save yet" is simply true. A future stage that
 * gives the roster a `dirty` flag owns setting it to exactly one rule (true
 * once a non-empty roster changes since the last export or import, false on
 * load/export/import) and writes the tests for that rule; this interface
 * only reserves the field so `sectionState` does not need a second, later
 * shape change.
 */
export interface ToolState {
  named: number;
  absent: number;
  together: number;
  apart: number;
  rosterSize: number;
  sexMode: SexMode;
  leftovers: Leftovers;
  dirty: boolean;
}

/**
 * The four collapsed headers' state strings.
 *
 * Pure, and one function, because the failure this prevents is a header
 * that disagrees with the thing it describes -- and that only happens when
 * two places compute the same sentence. A unit test can pin every branch of
 * this against both locale tables; an end-to-end test can only ever sample
 * it.
 *
 * Returns three fields, not four: the fourth section (Sound & animation)
 * carries no accumulated state to forget -- sound and speed are simple,
 * always-visible preferences, not data a teacher could lose by collapsing
 * the section -- so no locale copy or design example defines a state
 * sentence for it, and this function does not invent one.
 */
export function sectionState(state: ToolState, t: Strings) {
  const parts: string[] = [];
  if (state.rosterSize === 0) parts.push(t.stateNoneAdded);
  else {
    if (state.named > 0) parts.push(t.stateNamed({ n: state.named }));
    if (state.absent > 0) parts.push(t.stateAbsent({ n: state.absent }));
    if (state.together > 0) parts.push(t.stateTogether({ n: state.together }));
    if (state.apart > 0) parts.push(t.stateApart({ n: state.apart }));
    // Every one of named/absent/together/apart is 0: there IS a roster, but
    // nothing about it is worth calling out yet -- everyone is present,
    // unnamed, and unlettered. Falls back to a plain count rather than
    // leaving the header blank.
    if (parts.length === 0) parts.push(t.stateAdded({ n: state.rosterSize }));
  }

  const opts: string[] = [];
  if (state.sexMode === 'mix') opts.push(t.stateMixed);
  if (state.sexMode === 'separate') opts.push(t.stateSeparated);
  if (state.leftovers === 'bunch') opts.push(t.stateBunched);

  return {
    studentDetails: parts.join(' · '),
    groupingOptions: opts.length ? opts.join(' · ') : t.stateNone,
    importExport: state.dirty ? t.stateUnsaved : t.stateNothingToSave,
  };
}
