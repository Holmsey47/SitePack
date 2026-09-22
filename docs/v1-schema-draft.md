# SitePack v1 — Schema draft (Data)

**Status:** Approved by Lead with nits applied (18 Sep 2026)  
**Owner:** SitePack Data  
**Contract:** `/workspace/SitePack/v1-screen-sot.md` (Screens 1–6, gates G1–G8)  
**Rule:** Nits applied; migrations only once Supabase project/repo exist. No snag / finance / CIS / timesheet tables.

**Defaults (locked where noted):**
- **CM site scope LOCKED:** assigned sites only (same visibility gate as operative)
- **Owner:** all company sites (pulse + inbox)
- Auth **LOCKED:** invite link + set password once → email+password thereafter (`auth.users`). **No** magic link, **no** open signup
- Defer seen/ack

---

## Entity overview (maps to screens)

| Table | Screens | Purpose |
|---|---|---|
| `companies` | 1, 6 | Tenant |
| `people` | 1–6 | Profile + role + trade label, linked to `auth.users` |
| `sites` | 2, 3, 5, 6 | Jobs / plots under a company |
| `site_assignments` | 2, 5, 6 | Who is on which site (operative gate) |
| `drawings` | 3, 5 | PDF metadata; current + superseded chain |
| `drawing_requests` | 4, 6 | Operative ask → CM queue |
| `drawing_audit` | 5 | Who uploaded what rev when |
| Storage bucket `drawings` | 3, 5 | PDFs; signed URLs for offline pack manifest |

---

## Tables (columns)

### `companies`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `name` | text not null | |
| `created_at` | timestamptz | default now() |

### `people`
One row per authenticated user in a company. Trade is a **label**, not a product line.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | same as `auth.users.id` (1:1) |
| `company_id` | uuid FK → companies | not null |
| `role` | text not null | check: `operative` \| `cm` \| `owner` |
| `trade` | text | nullable label: dryliner, plasterer, labourer, … |
| `display_name` | text | |
| `email` | text | invite target + login identifier |
| `phone` | text | optional |
| `created_at` | timestamptz | |

**Index:** `(company_id)`, `(company_id, role)`

### `sites`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `company_id` | uuid FK → companies | not null |
| `name` | text not null | |
| `address_line` | text | short plot/address for list subtitle |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | bump on pack change (last drawing replace) |

**Index:** `(company_id)`

### `site_assignments`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `site_id` | uuid FK → sites | not null |
| `person_id` | uuid FK → people | not null |
| `created_at` | timestamptz | |
| unique | `(site_id, person_id)` | |

**Index:** `(person_id)`, `(site_id)`

### `drawings`
One row per uploaded PDF revision. Exactly one **current** drawing per logical sheet on a site.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `site_id` | uuid FK → sites | not null |
| `title` | text not null | sheet name |
| `sheet_number` | text | optional |
| `revision` | text not null | manual entry OK |
| `dated` | date | drawing date on sheet |
| `is_current` | boolean not null | default false; exactly one true per sheet group |
| `supersedes_id` | uuid FK → drawings | nullable; previous rev |
| `storage_path` | text not null | path in `drawings` bucket |
| `file_size_bytes` | bigint | for offline progress |
| `content_type` | text | default `application/pdf` |
| `uploaded_by` | uuid FK → people | |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |
| `folder` | text not null | default `Other`. One level only. Not part of the sheet group. |

**Sheet group:** same `site_id` + same `title` (and `sheet_number` when set). Folder is a label on the row, not part of that identity. Replace flow inserts new row with `is_current = true`, sets previous current’s `is_current = false`, sets new.`supersedes_id` = old id — **in one transaction** so two currents never exist (Screen 5). Null `p_folder` copies the previous folder; a sent folder moves only the new current row.

**Sheet key (required — no null footgun):**  
Generated column `sheet_key text generated always as (coalesce(nullif(trim(sheet_number), ''), '')) stored`  
(or equivalent expression). Partial unique index:  
`UNIQUE (site_id, title, sheet_key) WHERE is_current`  
So two currents with the same title and null/blank sheet_number cannot coexist.

**Index:** `(site_id, is_current)`, `(site_id)`

### `drawing_requests`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `site_id` | uuid FK → sites | not null (always attached) |
| `requester_id` | uuid FK → people | not null |
| `body` | text not null | what they need |
| `sheet_hint` | text | optional ref |
| `photo_path` | text | optional; same private `drawings` bucket at `{company_id}/{site_id}/requests/{id}.jpg`. Column ships now; photo upload may defer to a follow-up migration (Mobile stubs in Phase A). |
| `status` | text not null | check: `Open` \| `Sent` \| `Closed` |
| `fulfilled_drawing_id` | uuid FK → drawings | set when CM attaches upload |
| `cm_note` | text | optional close/sent note |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

**Index:** `(site_id, status)`, `(requester_id)`, `(site_id) WHERE status = 'Open'` for Screen 6 counts

### `drawing_audit`
Append-only light audit (who / what rev / when). No seen/ack in v1.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `drawing_id` | uuid FK → drawings | not null |
| `site_id` | uuid FK → sites | denormalised for easy site history |
| `actor_id` | uuid FK → people | who uploaded / replaced |
| `action` | text not null | `upload` \| `replace` (extend later if needed) |
| `revision` | text | snapshot of rev at action |
| `created_at` | timestamptz | |

**Index:** `(site_id, created_at desc)`, `(drawing_id)`

---

## Storage

**Bucket:** `drawings` (private)

**Path convention:** `{company_id}/{site_id}/{drawing_id}.pdf`

**Access:**
- Client never uses service role.
- **Signed URLs** (short TTL) for open/view and for **offline pack manifest** (list of current drawings + signed GET URLs + rev + dated + size).
- Upload: CM/Owner via authenticated upload to allowed path prefix, or via Edge Function / signed upload URL.

**Storage RLS (plain English):**
- Read object if caller can SELECT the matching `drawings` row (same site visibility as below).
- Insert/update object if caller is CM or Owner in that company (and path matches their `company_id`).
- Upsert needs INSERT + SELECT + UPDATE on storage (Supabase gotcha).

---

## Helpers (security definer, private schema)

Keep in unexposed schema e.g. `private` (not `public`):

| Function | Returns | Used by |
|---|---|---|
| `private.current_person()` | people row for `auth.uid()` | all policies |
| `private.my_company_id()` | uuid | |
| `private.my_role()` | text | |
| `private.is_cm_or_owner()` | boolean | |
| `private.is_assigned_to_site(site_id)` | boolean | operative path |
| `private.can_access_site(site_id)` | boolean | operative **or CM:** assigned to site; **Owner:** any site in company |

**Do not** put authorization in `user_metadata` / JWT user claims. Role lives in `people.role` (or `app_metadata` only if we sync it carefully — prefer table + helper).

---

## RLS (plain English)

Enable RLS on every public table. Policies assume authenticated role.

### `companies`
- **SELECT:** people in that company  
- **INSERT/UPDATE:** Owner only (v1; invite bootstrap may use service role once)

### `people`
- **SELECT:** same company  
- **UPDATE self:** `display_name`, `trade`, `phone` (not `role`, not `company_id`)  
- **INSERT / role change:** Owner or service role (invite path)

### `sites`
- **SELECT:** `can_access_site(id)` — operative **and CM** only if assigned; **Owner** all company sites  
- **INSERT / DELETE:** Owner, same company
- **UPDATE:** Owner (any company site); CM only if assigned (light metadata — name/address; prefer Owner for structural changes)

### `site_assignments`
- **SELECT:** Owner (company) **or** CM for sites they can access **or** the assigned person (self)  
- **INSERT / DELETE:** Owner (any company site) or CM for sites they already access (v1: prefer Owner manages assignments; CM may manage assignees on their sites)  
- Operative cannot invent assignments

### `drawings`
- **SELECT:** `can_access_site(site_id)` — includes superseded rows (UI demotes; data still readable for archive)  
- **INSERT:** CM/Owner + `can_access_site`  
- **UPDATE:** CM/Owner — only fields needed for replace metadata; current-flip done in transaction (prefer RPC `replace_drawing`)  
- **DELETE:** CM/Owner (rare; prefer supersede)

### `drawing_requests`
- **SELECT:** Owner (all company sites) **or** CM where `can_access_site(site_id)` **or** `requester_id = auth.uid()` (own rows only)  
- **INSERT:** operative (or CM) with `can_access_site(site_id)`; `requester_id = auth.uid()`  
- **UPDATE:** Owner (company) or CM with `can_access_site(site_id)` (status, note, fulfilled_drawing_id); requester cannot close as CM

### `drawing_audit`
- **SELECT:** Owner company-wide; CM/operative if `can_access_site(site_id)`  
- **INSERT:** CM/Owner (or trigger on drawing insert/replace)  
- **No UPDATE/DELETE** for clients (append-only)

---

## Recommended RPCs (keep Mobile simple)

| RPC | Who | Behaviour |
|---|---|---|
| `replace_drawing(...)` | CM/Owner | Insert new drawing + flip `is_current` + set `supersedes_id` + bump `sites.updated_at` + insert `drawing_audit` — **one transaction** |
| `site_pack_manifest(site_id)` | any with site access | Current drawings only: id, title, sheet_number, revision, dated, file_size, **signed URL** — for offline download |
| `company_sites_pulse()` | CM/Owner | **Owner:** all company sites; **CM:** assigned sites only — same columns (Screen 6) |

Views that Mobile might use must be `security_invoker` (Postgres 15+) so RLS still applies.

---

## Screen → query cheat sheet

| Screen | Primary reads |
|---|---|
| 1 Login | Invite → set password → email+password → `people` by `auth.uid()` |
| 2 Operative home | `sites` join `site_assignments` where `person_id = me` (+ `updated_at`) |
| 3 Site pack | `drawings` where `site_id` and `is_current`; superseded: same site `is_current = false` (collapsed UI) |
| 4 Request | INSERT `drawing_requests`; CM list by company/open; operative own by `requester_id` |
| 5 Upload/replace | Storage upload + `replace_drawing` RPC |
| 6 Multi-site | `company_sites_pulse()` — Owner full company; CM assigned subset |

---

## Explicitly out of schema (v1)

Phase B thin snag/photo → separate sketch `/workspace/SitePack/phase-b-site-issues-sketch.md` (**not** in drawings v0 migrations). Still out of v0: drawing pin/markup, snag libraries, RFI numbering, timesheets, wages, CIS, finance, RAMS, chat, seen/ack, multi-company picker, notify outbox (later if Lead opens it).

---

## Next after Lead approve

1. Supabase project + linked CLI  
2. Migration: tables → helpers → RLS → RPCs → storage bucket policies  
3. Seed one company / CM / operative / site for Mobile binding  
4. Hand Mobile: table names, RPC signatures, manifest shape — no parallel API

**Lead approved (nits applied).** **CM scope locked 18 Sep:** assigned-only (not all company). Next: migrations when repo + Supabase exist.
