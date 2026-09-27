# Workflow test results — 27 September 2026

| Layer | Passed | Failed | Skipped |
| --- | ---: | ---: | ---: |
| API unit (16 suites) | 165 | 0 | 0 |
| Backoffice unit | 12 | 0 | 0 |
| Customer unit (4 files) | 21 | 0 | 0 |
| API HTTP (2 suites) | 67 | 0 | 0 |
| Backoffice Playwright: Chromium desktop + Pixel 7 | 103 | 0 | 1 |
| Customer Playwright: Chromium desktop + Pixel 7 | 64 | 0 | 0 |
| Total | 432 | 0 | 1 |

The desktop project skips the mobile-menu scenario intentionally. Final full browser runs used no retries and reported zero flaky tests. An earlier customer run encountered a transient browser ERR_NO_BUFFER_SPACE; the subsequent complete run passed.

All three production builds and TypeScript checks passed. Customer ESLint passed. Backoffice build reported existing image/dependency warnings. API unit coverage over all collected source: statements 42.93%, branches 53.94%, functions 40%, lines 46.52%. HTTP/browser tests are separate and are not included in that unit coverage. This is not 100% code or combination coverage.

## Bugs found and fixed

- Concurrent backoffice 401 responses now share one refresh request; API refresh checks account status, identity and atomically consumes the session.
- Backoffice login respects a safe internal return URL.
- Branch registration links now reach the branch claim flow; legacy UUID links remain supported. Claim success no longer disappears when LIFF re-authenticates.
- Read-only roles cannot use write controls; bill viewers no longer request endpoints requiring unrelated permissions.
- Long mobile dialogs scroll so their submit buttons remain reachable.
- Payment submissions reject an existing pending payment; upload validation happens before Cloudinary and only approved payments reduce the balance. Simultaneous PostgreSQL submissions still require the live concurrency test.
- Malformed multibyte LINE signatures return false instead of throwing; LIFF URLs keep fragments and a single liffId parameter.

## What the results establish

Browser tests render the real apps with mutable HTTP fixtures. API HTTP tests exercise real JWT, permission/branch guards, DTO validation and response envelopes with mocked Prisma. Unit tests mock database/provider boundaries. No production records or real LINE messages were created.

Real LINE login/webhooks, Cloudinary upload, PostgreSQL transaction behavior/concurrency, provider quotas, and physical device flows still need staging verification. See [the test case matrix](QA-TEST-CASES.md), including LIVE-01 through LIVE-06.

## Reproduce

Install dependencies with pnpm, then run the commands in QA-TEST-CASES.md. Browser setup requires `pnpm exec playwright install chromium`. Playwright starts/stops its own isolated development server with hidden Windows processes, captures logs in test-results/server.log, and restores generated Next config files. HTML reports and failure screenshots/traces are generated locally under playwright-report/ and test-results/ and are ignored by Git.
