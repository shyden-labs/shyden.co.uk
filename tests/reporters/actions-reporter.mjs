// @ts-nocheck -- measurement only, never merged.
// MEASUREMENT ONLY (#1086), never merged: records, for every test, each browser
// action and each assertion it executed, with the source line that made it.
import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const DIR = process.env.E2E_REPORT_DIR || 'e2e-report';
const OUT = path.join(DIR, `actions-${process.pid}.jsonl`);

export default class ActionsReporter {
  constructor() {
    mkdirSync(DIR, { recursive: true });
    this.steps = new Map();
  }
  onStepBegin(test, _result, step) {
    if (step.category !== 'pw:api' && step.category !== 'expect') return;
    const entry = this.steps.get(test.id) ?? { actions: [], expects: [] };
    const where = step.location
      ? `@${step.location.file.replace(/^.*\/tests\//, '')}:${step.location.line}`
      : '';
    // The nearest enclosing test.step: on the page walk, the check it belongs to.
    let owner = step.parent;
    while (owner && owner.category !== 'test.step') owner = owner.parent;
    const tag = owner ? ` [step: ${owner.title}]` : '';
    (step.category === 'pw:api' ? entry.actions : entry.expects).push(
      step.title + where + tag,
    );
    this.steps.set(test.id, entry);
  }
  onTestEnd(test, result) {
    const entry = this.steps.get(test.id) ?? { actions: [], expects: [] };
    appendFileSync(
      OUT,
      JSON.stringify({
        project: test.parent.project()?.name,
        file: test.location.file.replace(/^.*\/tests\//, 'tests/'),
        line: test.location.line,
        title: test.titlePath().slice(3).join(' › '),
        retry: result.retry,
        status: result.status,
        ms: result.duration,
        ...entry,
      }) + '\n',
    );
    this.steps.delete(test.id);
  }
}
