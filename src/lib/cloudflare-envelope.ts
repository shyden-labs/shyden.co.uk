/**
 * The envelope every Cloudflare v4 API answer comes in (#349, #796), read the
 * same way by the waiting-reports count and the Access token expiry check.
 *
 * Pure: every function here works from its arguments alone, and returns a
 * value or throws. Node runs this file by stripping its types, with no build
 * step, so it uses erasable TypeScript only (no enums, namespaces or
 * parameter properties), and imports only `is-record.ts`, which imports
 * nothing, by its full name.
 */
import { isRecord } from './is-record.ts';

/**
 * The code and message of each entry in an answer's `errors` list, for a
 * failure's text. Nothing either job asks Cloudflare or GitHub for holds a
 * report's content or a credential, so no error about it can carry one into
 * the public log.
 */
export const errorsIn = (answer: unknown): string => {
  const errors = isRecord(answer) ? answer.errors : undefined;
  if (!Array.isArray(errors) || errors.length === 0) return '';
  const each = errors.map((error) =>
    isRecord(error)
      ? `${String(error.code)} ${String(error.message)}`
      : JSON.stringify(error),
  );
  return ` (${each.join('; ')})`;
};

/** A Cloudflare answer's `result`, once its envelope says it succeeded. */
export const resultOf = (answer: unknown, what: string): unknown => {
  if (!isRecord(answer)) throw new Error(`${what} is not a JSON object`);
  if (answer.success !== true)
    throw new Error(
      `${what} says success: ${JSON.stringify(answer.success)}${errorsIn(answer)}`,
    );
  return answer.result;
};
