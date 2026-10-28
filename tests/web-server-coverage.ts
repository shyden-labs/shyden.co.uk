import ts from 'typescript';
import { parseSource } from './unit/ast';

/**
 * Which Playwright web servers may be measured for coverage (#913).
 *
 * A web server's command starts with `unset NODE_V8_COVERAGE; `
 * (`unmeasured` in `coverage-options.ts`), since what it builds loads `src/`
 * through Vite, which a Playwright run's coverage cannot convert (#914's).
 * The one other shape is `node <script>`, whose script deletes the variable
 * as its first statement after its imports: Node fixed the script's own
 * coverage folder at startup, so the script is measured and every process it
 * starts, which inherits its environment, is not.
 */

/** The script a bare `node <script>` command runs, or undefined. */
export const nodeScript = (command: string): string | undefined =>
  /^node (\S+\.mjs)$/.exec(command)?.[1];

/** Whether the first statement after the imports is `delete process.env.NODE_V8_COVERAGE`. */
export function clearsCoverageFirst(text: string, file: string): boolean {
  const first = parseSource(text, file).statements.find(
    (statement) => !ts.isImportDeclaration(statement),
  );
  return (
    first !== undefined &&
    ts.isExpressionStatement(first) &&
    ts.isDeleteExpression(first.expression) &&
    first.expression.expression.getText() === 'process.env.NODE_V8_COVERAGE'
  );
}

/** A web server as the guard reads it: `signal` is its `gracefulShutdown.signal`. */
export type WebServer = { id: string; command: string; signal?: string };

/**
 * Each server neither unsetting the variable nor running a script that
 * clears it, as `id: command`; and each measured script Playwright would stop
 * with SIGKILL, its default with no `gracefulShutdown`, since a killed
 * process never writes its coverage.
 */
export const serverCoverageFindings = (
  servers: readonly WebServer[],
  read: (file: string) => string,
): string[] =>
  servers.flatMap(({ id, command, signal }) => {
    if (command.startsWith('unset NODE_V8_COVERAGE; ')) return [];
    const script = nodeScript(command);
    if (script === undefined || !clearsCoverageFirst(read(script), script))
      return [`${id}: ${command}`];
    return signal === undefined
      ? [
          `${id}: ${command} has no gracefulShutdown signal, so Playwright SIGKILLs it and its coverage is never written`,
        ]
      : [];
  });
