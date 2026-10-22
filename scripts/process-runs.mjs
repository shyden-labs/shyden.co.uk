/**
 * Whether a process runs, asked with signal 0, which sends nothing. One home
 * for the question the Google ledger's lock and the coverage reader (#936)
 * both ask.
 */
import { codeOf } from './errors.mjs';

/**
 * @param {number} pid
 * @returns {boolean}
 */
export const processRuns = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: the process runs, as someone this one cannot signal.
    return codeOf(error) === 'EPERM';
  }
};
