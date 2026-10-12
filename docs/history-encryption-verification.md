# History encryption verification

## Scope and environment

Verification used synthetic conversation contents on 10 October 2026. The machine was an Apple M3 Max with 36 GiB of memory. Browser runs used Chrome for Testing 156.0.8078.4 through Playwright. Node benchmarks used Node 23.11.0 and fake-indexeddb, an in-memory implementation of the browser database API.

One MiB is 1,048,576 bytes. Processor percentages describe one core. Browser memory is the maximum sampled sum of resident memory across extension renderer processes. Shared pages can be counted more than once; this is not a measurement of application heap alone.

## Automated verification

`npm test` passed 827 tests in 62 files. Five tests in two files were skipped. `npm run build` passed. Vite retained its warning about the existing large side-panel bundle. A bundle inspection found migration-owner code only in the background bundle.

Regression coverage includes authenticated encryption and tampering, atomic revision publication, restart boundaries, readback verification, attachment restoration, tombstones, same-command retries, stale panel writes, concurrent append and truncate guards, settings cleanup locking, closed database recovery, and Chrome callback errors.

Panel coverage includes shared initial hydration, authoritative activation recovery, two initialization races, persistent save errors, retained destructive failures, targeted remote-conversation refresh, edits during background refresh, and mutation gating during initial adoption.

Independent review identified whole-history refresh on remote writes and lost edits during hydration. The final fix pass added targeted refresh and mutation gating with failing-then-passing regression tests. The reviewer established no critical issue. The final fixes were checked by tests and browser runs rather than a second independent review.

## Chromium measurements

| Synthetic history | Conversations | Time to verified completion | Average processor use | Peak renderer resident memory | Maximum initial panel task | Panel tasks above 50 ms after activation |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 4.3 MiB | 150 | 18 s | 8.3% of one core | 329 MiB | none observed | 0 |
| 70.9 MiB, traced final build | 2,500 | 261 s | 7.8% of one core | 1,285 MiB | 205 ms | 0 |
| 102.1 MiB | 3,600 | 309 s | 6.9% of one core | 1,406 MiB | 120 ms | 0 |

The 150-conversation run stopped the worker during conversion, closed and reopened the panel, sent from a second panel, restarted the browser, and restored every conversation and the message sent during conversion. All 14 checks passed on the final build. A separate 30-conversation run also checked header bounds at 320 pixels with reduced motion and passed all 15 checks.

The 102.1 MiB run stopped the worker during preparation and passed all 13 checks. It restored 43,202 messages and 3,600 conversations. This run preceded the final two initialization-race guards; those guards passed dedicated regressions and the final full suite.

Every completed browser run checked removal of history fields from settings, empty plaintext staging, absence of plaintext markers in encrypted database records, the completion shield, restored messages and titles, and page errors. Reply latency during the 150-conversation final run was 64 ms; the 102.1 MiB run observed 49 ms against a local mock provider. These timings are not provider-network latency predictions.

An earlier 70.9 MiB run observed two post-activation panel tasks, up to 345 ms. Other large runs observed none. The initial harness transferred the entire source through one automation message; the revised harness uses 1 MiB pieces. The causal link to that intermittent observation remains unverified. The traced final-build 70.9 MiB repeat passed all 14 checks, including a second-panel append, and observed no post-activation long tasks. It restored 2,500 conversations and 30,002 messages. Tracing adds diagnostic overhead, so its duration is not directly comparable with untraced runs.

## Node measurements

The benchmark disables inter-batch pauses for throughput measurements. These timings include the simulated database and are not Chrome predictions.

| Workload | Legacy size | Preparation | Activation | Conversion | Restoration | Peak heap |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Small conversations | 0.5 MiB | 80 ms | 2 ms | 2,848 ms | 142 ms | 44 MiB |
| Many conversations | 10.1 MiB | 195 ms | 5 ms | 8,637 ms | 201 ms | 68 MiB |
| One conversation, 4,000 messages | 9.7 MiB | 197 ms | 5 ms | 7,567 ms | 175 ms | 123 MiB |
| Attachments | 13.4 MiB | 64 ms | 6 ms | 447 ms | 38 ms | 93 MiB |

All four workloads reached completion. The combined run including the 100 MiB simulated workload exceeded ten minutes near 99% of one core and was terminated. Real Chromium completed the larger 102.1 MiB workload. The simulator's standalone paced CPU sample also reported about 100%; it measures a short database-heavy wake without the extension service's inter-wake delay and must not be used as the extension's processor estimate.

## Remaining limits

The initial legacy import still reads and parses the old history as one value. It can briefly interrupt the panel and requires transient memory proportional to history size. The measurements do not establish a duration guarantee or a bound for larger histories.

Truncating an unconverted conversation can understate displayed progress until finalization, because removed source bytes are not credited to the progress numerator. This deferred display issue does not bypass verification or restore deleted messages.

Older panels with ambiguous replacement edits receive an encrypted recovery conversation and an explicit error. The original conversation remains intact. Review the recovered copy before resuming migration.

The key remains in the browser profile. Drafts and saved instructions remain outside the protected scope. Removing application values does not establish physical disk or backup erasure, and automatic unlocking does not protect a stolen browser profile.

## Reproduction

Build before running the browser script. Do not replace `dist` while a browser run is using it.

- `npm test`
- `npm run build`
- `node scripts/benchmark-history-migration.mjs --sizes=small,10,single,images`
- `node scripts/e2e-history-encryption.mjs --sessions=150 --stop-at=conversion --close-panel --restart-browser --two-panels --artifacts=/tmp/upchat-history-ui`
- `node scripts/e2e-history-encryption.mjs --sessions=3600`
- `node scripts/e2e-history-encryption.mjs --sessions=2500 --two-panels --trace=/tmp/upchat-history-trace.json`
