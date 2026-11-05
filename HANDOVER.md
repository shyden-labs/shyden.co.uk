# Handover — 2026-11-06 (overnight: #1025 closed, #1044 and #1045 in PR)

**Rules (Shyden):** keep it simple; no force-push; squash PRs into develop; `main` gets only a frozen `release/*` cut. Always prove, never assume: every close rests on a measurement for that exact claim, and a run a close depends on uses `--reporter=line,json`, quoting the test's own `status`. Node: `PATH=$HOME/.local/share/node/current/bin:$PATH`. Board: `python3 .superpowers/sdd/board/set-status.py <n> "<Status>"`.

**Overnight to about 05:30 (Shyden asleep):** work that needs no answer from him. **The OPPO (3b402284) is shared with shydesk-21:** message it before and after using the phone.

**Checkout:** on branch `1045-mid-deal-press` at `842c1eb8` (pushed). Only this file is uncommitted. Probe files are all removed.

## State

- **#1025 CLOSED** on a measured pass (comment 6664864070).
- **#1044: PR #1050** (`1044-tap-helper-own-clock` at `467e467d`). On the phone: 18 clock tests ×3 = 54/54 passed, cg `:174`/`:710` ×3 = 6/6 passed. CI waiter was started; if gone, run `~/.claude/scripts/wait-pr-checks.sh 1050 3000 60` in the background. Squash-merge when green (body from `.superpowers/sdd/1044/` notes / the PR body), then post the results on #1044 and #1037.
- **#1045: PR #1051** (`842c1eb8`). On the phone: 3/3 passed, and the unchanged test failed 3/3. The commit message says the click came "330-460 ms" after the deal; the measured figures are 332-396 ms (the PR body is right). Use the PR body as the squash `--body-file`. Waiter: `wait-pr-checks.sh 1051 3000 60`.
- #838 is blocked by #1044 and #1045 (linked). After both merge, run #838 AC5 (`npm run test:devices`) on both phones, on develop with #1002 merged in.

## Parked for Shyden

1. **#1044 AC1, the classroom-groups half:** the cause of the 2 cg hangs (`:174`, `:710`) did not reproduce. 10/10 runs passed on the OLD helper with a 5 s stall watchdog that never fired, 6/6 on the new one, and 25 Back presses all left the page visible at about 60 fps. The 18 clock hangs' cause IS measured. Options: (a) accept "not reproduced" for the cg pair, since the new `prepare()` fails at 3 s naming the wait if it recurs, then close #1044; (b) keep #1044 open until a full Android run reproduces it. Ask with `AskUserQuestion`; do not close #1044 before the ruling.

## Resume steps

1. `ListAgents`; `ReadNotifications`; `git fetch`.
2. Check PRs #1050 and #1051; merge each green one (squash, `--body-file`).
3. Next workable P0s: #1046-#1049 (#1048 per its rulings comment 6659309766).
