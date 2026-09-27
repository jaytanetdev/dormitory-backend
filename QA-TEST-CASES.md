# Workflow verification — 27 September 2026

Tests use synthetic per-test data. They never connect to the configured production database or send real LINE messages.

## Boundaries

Browser tests render the actual Next application and use its actual API client. Playwright intercepts HTTP API requests with mutable fixtures. The Mini App replaces only the external LIFF SDK on an explicitly enabled development E2E server; production builds use the real SDK. API HTTP tests start the actual Nest app with JWT, permission/branch guards, validation and response envelopes, but replace Prisma. Service tests mock external calls.

This verifies the scenarios listed below, not every possible combination or 100% of source code.

## Staging cases not performed against live services

| ID | Steps | Required result | This run |
| --- | --- | --- | --- |
| LIVE-01 | Open room and branch claim links inside LINE on Android/iOS; log in and claim | Correct LIFF channel/branch; cannot reuse room invite | SDK simulated |
| LIVE-02 | Issue invoice, upload to Cloudinary, approve, refresh resident app | Database, storage, receipt, balance and LINE message agree | Boundaries tested separately; no real DB/storage |
| LIVE-03 | Deliver signed webhook and reply from backoffice | Correct inbound/outbound persisted conversation | Signature/dispatch unit-tested; no real delivery |
| LIVE-04 | Concurrent room claims, slip submissions/reviews, refresh rotations on separate DB connections | No duplicate tenancy/payment/receipt or stale balance; one token winner | Service conditions tested; PostgreSQL concurrency unverified |
| LIVE-05 | Compare OA quota/reset with provider dashboard | Quota matches actual OA month | Values mocked; month calculation tested |
| LIVE-06 | Print receipt and select camera/file in LINE on physical devices | Readable print, image permission and upload navigation | Chromium mobile emulation only |

Artifacts: test-results/results.json, playwright-report/index.html, failure screenshot/trace ZIP. Generated artifacts are ignored by Git. Measured results are in QA-RESULTS.md.

## Run from this repository

    pnpm install
    pnpm test
    pnpm test:e2e
    pnpm exec jest --runInBand --coverage --coverageReporters=json-summary --coverageReporters=text-summary
    pnpm build
    pnpm typecheck

No PostgreSQL server is required; HTTP tests replace Prisma and start Nest in-process. Never point tests at production.

## API cases

| Area | Required scenarios | Executable test |
| --- | --- | --- |
| Auth | Active-user/store login; normalized email; bad password; signature/type; expired/revoked/deleted/suspended/mismatched session; single-use refresh; logout | auth/auth.service.spec.ts |
| HTTP guards | 27 endpoints reject anonymous/missing permission; permitted read envelope, cross-branch/platform/DTO/token/resident identity checks | test/workflow.e2e-spec.ts |
| Delegation | Permission/scope escalation, immutable/self accounts, suspension/revocation, branch registration link | access/access.service.spec.ts |
| Room/tenancy | Create/occupancy, duplicate contract, wrong branch, move-out dates/reuse/history, hashed/rotated invites, missing OA/nonvacant rooms | operations/operations.service.spec.ts |
| Billing/meters | Due date, cents/rent/utilities/discount, backward/mismatched/missing/old meters, invalid period/contract, draft-only issue, LINE offline | billing/billing.service.spec.ts, billing-workflow.spec.ts |
| Review/QR | Partial/full receipt, late fee/paidAt, double review, scope, reject/audit, approved balance, zero/unconfigured QR, LINE offline | payments/payments.service.spec.ts, payments.dto.spec.ts, promptpay.spec.ts |
| Resident billing/slip | Own scope, hidden draft/void, oldest due, overpayment, duplicate pending, bad MIME/amount/date, cloud missing | miniapp/miniapp.service.spec.ts, miniapp-payment.spec.ts |
| Claim | Valid branch/room/contract invite, missing/duplicate/nonvacant room, active LINE tenancy, invalid/reused link, conditional claim conflicts, hashed token, verified identity/production mock blocked | miniapp/miniapp-claim.spec.ts |
| LINE | Sent/failed/skipped, flex messages and LIFF link, chat/history/branch scope, webhook, quota/provider failure, exact raw signature/malformed signature, ID-token channel/subject | line/line.service.spec.ts |
| Credential encryption | Roundtrip, random nonce, invalid key/ciphertext, tampering | line/line-credentials.spec.ts |
| Store onboarding | Store/branch/owner/presets transaction, normalized fields, safe response, viewer permissions, duplicate conflict | platform/platform.service.spec.ts |

Coverage is measured over all source files. Bootstrap/modules/decorators and remaining persistence combinations are not all unit-covered; HTTP tests complement service tests but do not prove PostgreSQL integration.
