/**
 * The tool pages submit the report form in place (#97, spec 3.3).
 *
 * `/classroom-groups` keeps a teacher's roster in memory only, so a
 * full-page POST would wipe the class list. Each tool page's own script calls
 * `enhanceReportForm`; the footer carries no script, so nothing new reaches
 * the homepage, which keeps the plain POST and its `:target` status. If this
 * script fails to load, the plain POST still works, and there is then no
 * roster to lose.
 */
// Type-only, deliberately: a value import would put report.ts's catalogue
// walk and matcher into the browser bundle for nothing.
import type { Outcome } from '../lib/report';

// A Record, so adding an outcome to the union without adding it here fails
// to compile; the list is the Record's keys.
const EVERY_OUTCOME: Record<Outcome, true> = {
  sent: true,
  'not-found': true,
  rejected: true,
  failed: true,
  'form-full': true,
  'connection-full': true,
};
const isOutcome = (value: unknown): value is Outcome =>
  typeof value === 'string' && Object.hasOwn(EVERY_OUTCOME, value);

/** The outcome a response carries, and `failed` for anything else: a 403, an HTML page, a body that is not ours. */
export async function outcomeOf(response: Response): Promise<Outcome> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return 'failed';
  }
  const outcome =
    body && typeof body === 'object' && !Array.isArray(body)
      ? (body as { outcome?: unknown }).outcome
      : undefined;
  return isOutcome(outcome) ? outcome : 'failed';
}

/** Show exactly one status and move focus to it, as the fragment does on the homepage. */
export function showStatus(
  root: ParentNode,
  outcome: Outcome,
): HTMLElement | null {
  let shown: HTMLElement | null = null;
  for (const status of root.querySelectorAll<HTMLElement>(
    '[data-report-status]',
  )) {
    const match = status.dataset.reportStatus === outcome;
    // 'superseded' outranks :target, which a URL fragment may still hold
    // (ReportForm.astro's CSS), so exactly one status is visible.
    status.dataset.reportState = match ? 'shown' : 'superseded';
    if (match) shown = status;
  }
  shown?.focus();
  return shown;
}

/** Send the form with fetch and never reload; one submission at a time. */
export function enhanceReportForm(form: HTMLFormElement): void {
  const button = form.querySelector<HTMLButtonElement>('button[type="submit"]');
  let pending = false;
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (pending) return;
    pending = true;
    if (button) button.disabled = true;
    const body = new URLSearchParams();
    for (const [name, value] of new FormData(form))
      if (typeof value === 'string') body.append(name, value);
    let outcome: Outcome = 'failed';
    try {
      outcome = await outcomeOf(
        await fetch(form.action, {
          method: 'POST',
          headers: { Accept: 'application/json' },
          body,
        }),
      );
    } catch {
      outcome = 'failed';
    } finally {
      pending = false;
      if (button) button.disabled = false;
    }
    if (outcome === 'sent') form.reset();
    showStatus(document, outcome);
  });
}
