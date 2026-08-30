# Dormitory API

NestJS REST API for the multi-tenant dormitory MVP. A `Store` is the tenant boundary; users receive permissions through a custom role and either have all-branch access or explicit `UserBranch` scopes.

## Local setup

```powershell
Copy-Item .env.example .env
docker compose -f ../../docker-compose.yml up -d postgres
pnpm install
pnpm prisma:generate
pnpm prisma:migrate --name init
pnpm prisma:seed
pnpm dev
```

Swagger is available at `http://localhost:4000/docs`; API routes use `/v1`. Demo owner login: store `demo-store`, email `owner@demo.local`, password `Dormitory123!`. Demo platform administrator: `platform@demo.local` / `Platform123!` on the same store slug. Demo credentials must never be seeded into production; the seed refuses production unless `ALLOW_PRODUCTION_SEED=true` is explicitly set.

## Security model

- Access and refresh JWTs use different secrets. Refresh tokens rotate and their bcrypt hashes are persisted.
- Global authentication, permission, and optional branch-scope guards protect routes. Only login/refresh/logout, invite claim, health, and verified LINE webhook routes are public.
- Permission keys are granular (`room.view`, `invoice.issue`, `payment.approve`, etc.). The UI may render these as a menu/action checkbox matrix.
- Invite secrets are returned only when created and stored as SHA-256 hashes with expiry and one-time status.
- LINE webhook signatures use the original raw body. Sending is recorded as `SKIPPED` when LINE credentials are absent so local development remains runnable.

## Main endpoints

- `POST /v1/auth/login`, `/refresh`, `/logout`; `GET /v1/auth/me`
- `GET|POST /v1/branches`; `GET /v1/permissions`; `GET|POST /v1/roles`; `PATCH /v1/roles/:id/permissions`; `GET|POST /v1/users`
- Properties/buildings/room types/rooms under `/v1`; branch residents and contracts; one-time contract invites and public claim
- Meter readings, billing periods, invoices, and `POST /v1/invoices/:id/issue`
- Branch PromptPay configuration, invoice QR generation, slip-backed payments, pending review, approve/reject
- Targeted LINE push and signature-verified `/v1/line/webhook`
- Platform-only `POST /v1/platform/stores` atomically creates a Store, main Branch, immutable Owner role, and first owner user.
- Mini App: `POST /v1/miniapp/auth/line`, invite preview/claim, resident profile/invoice list/detail, and slip-backed payment submission. LINE ID tokens are verified server-side; `mock-line:<userId>` is accepted only outside production.
- `GET /v1/health/live` and `/v1/health/ready`

## MVP boundaries

Slip files are represented by a validated HTTPS object-storage URL plus optional filename, MIME type, and size (maximum 10 MB); direct multipart upload, signed upload issuance, and malware scanning belong in the deployment storage adapter. Automated bank reconciliation, queues/retries, PDF receipts, and accounting reports are intentionally deferred.
