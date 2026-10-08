import { readFileSync, readdirSync } from 'node:fs';
import { nonEmpty } from './source-files';
import { parseCleanYaml, workflowJobs } from './workflow-jobs';
import { withoutCommentLines } from './unit/source-text';

export const WORKFLOWS = '.github/workflows';
export const SCRIPT = 'scripts/closing-keywords.mjs';

interface Trigger {
  readonly on?: { readonly pull_request?: { readonly types?: string[] } };
}

/**
 * The commands a `run:` script actually EXECUTES: comment lines dropped,
 * each trimmed, so only a command at the START of a line counts.
 *
 * Asserting that the script's NAME appears somewhere in the block is a
 * different question, and mutation proved the difference: `true # node
 * scripts/closing-keywords.mjs` satisfied that reading with the invocation
 * commented out, and `true || test -s ...` satisfied it with the liveness
 * control neutered. A `#` inside a `run:` block is part of the YAML STRING,
 * so the parser strips nothing there -- the same defect as a guard satisfied
 * by its own file's documentation (#23, #35). This mirrors how
 * `git-hooks.test.ts` reads the pre-push hook.
 */
export const commandsIn = (run: string): string[] =>
  withoutCommentLines(run, '#')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

/** Every workflow file whose jobs invoke the rule, with its parsed trigger. */
export function workflowsRunningTheRule() {
  const files = nonEmpty(
    readdirSync(WORKFLOWS),
    `workflow files in ${WORKFLOWS}`,
  );
  return files.flatMap((file) => {
    const text = readFileSync(`${WORKFLOWS}/${file}`, 'utf8');
    const jobs = workflowJobs(text, file);
    const runs = jobs.flatMap((job) => job.runs);
    const commands = runs.flatMap(commandsIn);
    const invokes = (command: string) => command.startsWith(`node ${SCRIPT}`);
    return commands.some(invokes)
      ? [
          {
            file,
            runs,
            commands,
            trigger: parseCleanYaml(text, file) as Trigger,
          },
        ]
      : [];
  });
}
