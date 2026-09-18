# SitePack v0 — drawings pack

Phone-first drawings pack for site trades (including labourers). Trade is a **label**, not a product line.

This repo is Expo + TypeScript + Supabase. Core screens are wired. Phase B snag/photo is not in this build.

## Locked product rules

- Multi-trade, including labourers. `people.trade` is a label (dryliner, plasterer, labourer, …).
- Operative **and** CM see **only assigned sites**. Owner sees all company sites.
- Auth is **invite + password**. No magic-link login. No open signup.
- Phase B snag/photo is parked. No Procore/Fieldwire sprawl, no RFI engine, no chat, no wages/RAMS/CDE.

Product contracts live in [`docs/`](docs/):

- [Screen source of truth](docs/v1-screen-sot.md)
- [Schema](docs/v1-schema-draft.md)
- [RPC contract](docs/v1-rpc-contract.md)
- [Wedge](docs/v1-wedge.md)
- [Mobile Phase A scope](docs/mobile-v0-screen-scope.md) — this build also wires pulse, upload/replace, and CM inbox because those are must-ship for drawings v0.

## What shipped

| Area | Where |
|---|---|
| Invite + password auth | `app/(auth)/login.tsx`, `set-password.tsx`, `supabase/functions/invite-person` |
| Assigned sites home | `app/(app)/home.tsx` — same list query for operative and CM |
| Site pack current / superseded | `app/(app)/sites/[siteId]` — current default; archive is an extra tap |
| Offline current pack | `lib/offline.ts` — native files + web Cache Storage |
| Request a drawing | `app/(app)/sites/[siteId]/request.tsx` — queue item, not chat |
| CM upload / replace | `app/(app)/sites/[siteId]/upload.tsx` + `replace_drawing` RPC |
| Owner pulse / CM assigned pulse | `app/(app)/sites/index.tsx` + `company_sites_pulse()` |
| RLS + helpers | `supabase/migrations/20260918120000_sitepack_v0.sql` |
| Seed | `supabase/seed.sql` + sample PDFs under `supabase/seed-files/drawings` |

## Run path (screens today)

You can verify every core screen **without** a live Supabase project. If `EXPO_PUBLIC_SUPABASE_URL` is empty, the app uses the same seed shape in memory (fixture mode). Session survives reload via `localStorage` / `expo-sqlite`.

```bash
npm install
npm run web
```

Open the URL Expo prints (usually `http://127.0.0.1:8081`).

Seed logins — password `SitePack123!`:

| Email | Role | Sees |
|---|---|---|
| `amy@sitepack.test` | Operative (dryliner) | Oak + Riverside only |
| `ben@sitepack.test` | Operative (labourer) | Oak only |
| `cm@sitepack.test` | CM | Oak + Warehouse only |
| `owner@sitepack.test` | Owner | Pulse: all three company sites |

Amy must **not** see Warehouse. Priya (CM) must **not** see Riverside. That is the assigned-only gate.

Phone: install Expo Go (SDK 54), run `npm start`, scan the QR.

## Run path (local Supabase)

Needs Docker.

```bash
npx supabase start
npx supabase status
```

Copy API URL and anon key into `.env.local`:

```
EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
EXPO_PUBLIC_SUPABASE_ANON_KEY=<anon from supabase status>
```

`supabase start` applies migrations and `supabase/seed.sql`. Sample PDFs load from `supabase/seed-files/drawings` into the private `drawings` bucket.

Hosted project:

1. Create a Supabase project.
2. Auth: disable public signup; keep the email provider on. Do **not** offer magic-link sign-in in the app.
3. Add redirect URLs: `sitepack://set-password` and your web origin `/set-password`.
4. `npx supabase db push` then run `supabase/seed.sql` in the SQL editor (skip seed in production).
5. Deploy `invite-person` with `npx supabase functions deploy invite-person`.
6. Set `INVITE_REDIRECT_URL` on the function.

`site_pack_manifest` returns current-sheet metadata (including `storage_path`). The mobile repo adds 1-hour signed URLs with `storage.createSignedUrls` because Storage signing keys are not in Postgres.

## Auth

1. Owner/CM invites from **Invite** (Edge Function uses the service role; client never does).
2. Invitee opens the email link once → **Set password**.
3. After that: email + password on **Login**.
4. No public sign-up screen. `config.toml` has `auth.enable_signup = false` while the email provider stays enabled so invited users can authenticate.

## Data rules worth knowing

- Role is `people.role`. Authorization does **not** read `user_metadata`.
- `private.can_access_site`: Owner = company sites; operative **and CM** = assignment rows only.
- `replace_drawing` is one transaction: flip old `is_current`, insert new current, `supersedes_id`, bump `sites.updated_at`, append `drawing_audit`. Unique index: one current row per `(site_id, title, sheet_key)`.
- Offline pack downloads **current** sheets only. Airplane mode opens those files. Superseded is a deliberate extra tap and is not in the pack.

## Out of this build

Snag + photo, markup/compare/BIM/OCR, full RFI, WhatsApp bot, RAMS/inductions/timesheets/wages, print-room, ISO 19650 CDE, CIS/accounting, Fieldwire/Site Manager Pro parity, seen/ack, notify outbox.
