---
name: emulator-test-resource-gate
description: Decide whether to run the Firestore/Auth emulator integration suite (`npm run test:emulator`) based on which machine this is — skip on machines already known to be unreliable for it, run the full suite on unknown machines while watching for swap pressure and aborting if it appears, and run normally on machines already confirmed to handle it. Use before any `npm run test:emulator` invocation.
---

## The policy

1. **Identify the machine** — `hostname` (add `uname -m` too if it might
   matter, e.g. ARM vs x86). Check it against the "Known machines" table
   below.
2. **Known machine, verdict = skip** → don't run the suite. Say so
   explicitly, name the machine and cite the table entry's evidence, and
   fall back to `npm test` (plain suite, unaffected) plus manual browser
   verification for anything Firestore-backed.
3. **Known machine, verdict = run** → run the full suite normally. It's
   already been confirmed to work here.
4. **Unknown machine (not in the table)** → run the **full** suite, but
   under the swap watchdog (below), not blind. Afterward, add the machine
   to the table with the real result, so future runs skip this step.

## Why "watch swap", not just "check resources once"

A one-time pre-check is necessary but not sufficient — proven directly:
on the Pi in the table below, a full-suite run was *started* from a
genuinely healthy baseline (load 0.77, ~4GB available, swap 32% used) and
still degraded mid-run into the same failure pattern as an already-loaded
run (load past 2.0, swap climbing, most tests timing out). The suite's own
execution can consume the headroom a pre-check found. Swap usage climbing
*during* the run was the most consistent leading indicator of an
unreliable run actually in progress — more useful as a live signal than
any one-time snapshot.

So for an unknown machine: don't just check once and hope — start the run
and keep watching. If swap usage reaches the danger threshold, stop the
run immediately rather than let it grind through 5-minute-per-test
timeouts producing misleading "failures."

## Running it

```bash
.claude/skills/emulator-test-resource-gate/run-with-swap-watchdog.sh
```

This starts `npm run test:emulator` in the background and polls `free -m`
every 10s; if swap usage reaches 50% of total swap at any point, it kills
the run immediately and exits 2 (**inconclusive due to resources — not a
test result**, don't record this as a pass/fail). If swap stays healthy
throughout, it waits for the real result and exits with the test runner's
own exit code.

To watch one file instead of the full suite (e.g. re-checking a single
spec after a fix): pass the path as `$1`:

```bash
.claude/skills/emulator-test-resource-gate/run-with-swap-watchdog.sh "src/app/features/checkin/services/checkin-state.service.emulator.spec.ts"
```

50% was chosen deliberately conservative, below the level (swap fully
exhausted, 199Mi/199Mi) that was directly observed alongside the worst
hangs — the goal is to abort before things get that bad, not after.

## After an unknown-machine run: update the table

- **Suite passed at a high rate, watchdog never tripped** → add the
  machine as `run`. Future sessions skip straight to running normally.
- **Suite failed at a low rate, watchdog never tripped** (i.e. resources
  looked fine throughout, but tests still failed/timed out) → still add
  the machine as `skip`, but note the reason as *not* swap-related — see
  the Raspberry Pi entry below, where the actual cause turned out to be
  `@firebase/rules-unit-testing`'s own overhead, unrelated to swap. Don't
  assume every skip is a resource story; record what was actually observed.
- **Watchdog aborted the run (exit 2)** → don't add a table entry yet.
  This means "inconclusive," not "known bad" — the machine might be fine
  once other load on it clears. Re-attempt once, and only record a verdict
  from a run that actually completed (pass, fail, or a clean full-batch
  failure), not from an aborted one.

## Known machines

| Hostname | Arch | Verdict | Evidence |
|---|---|---|---|
| `raspberrypi` | aarch64, 4-core, 7.8GB | **skip** | Full-batch run: 13/63 passed. Re-run as 10 strictly sequential isolated files: identical 13/63 — ruled out concurrency as the cause. Fresh emulator JVM (seconds old, system load ~1.0): worst-failing file still 0/4 — ruled out JVM staleness. Root cause identified: `@firebase/rules-unit-testing`'s `initializeTestEnvironment()`/`clearFirestore()` machinery specifically — the one spec file that avoids it (`auth.service.emulator.spec.ts`, plain client SDK) passed 5/5 every time; every file using it failed to some degree, independent of swap/load state at the time. **Not fixable by the watchdog above** — swap wasn't the bottleneck on this machine, tooling overhead was. `npm test` (plain suite) is fully reliable here regardless. |
| `LAPTOP-CIVJFE3K` | x86_64, Windows 11 (Git Bash) | **run** | Full suite run cleanly twice in one session: 63/63 then 74/74 (test count grew between runs as new spec files landed), each in 15-25s with no timeouts, retries, or errors. `npm test` (plain suite) also clean at 58-60/58-60 both times. Note: `run-with-swap-watchdog.sh` is **not usable on this machine as-is** — it shells out to `free -m`, which doesn't exist in Git Bash on Windows (`which free` → not found) — so both runs here were unwatched direct `npm run test:emulator` calls. Since the verdict is `run` (no resource issues observed at all), the watchdog is moot for this host; skip straight to running normally. |

Add a row here after testing any new machine, per "After an unknown-machine
run" above.

## What this does NOT gate

This skill only concerns whether/how to run the emulator test suite
against an already-running emulator — not whether to start the emulator
itself (`npm run emulators`, a separate, always-do-it prerequisite). It
also doesn't replace [[safe-debugging-practices]]'s rules about not
wiping shared/interactive emulator data — reliability and data-safety are
independent concerns that both apply when working with the emulator.
