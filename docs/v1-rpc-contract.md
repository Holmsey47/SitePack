# SitePack v1 — RPC / Mobile bind contract

**Owner:** SitePack Data  
**Consumers:** SitePack Mobile  
**Depends on:** `/workspace/SitePack/v1-schema-draft.md` (Lead-approved)  
**Status:** Draft for Mobile bind (18 Sep 2026)  
**Hold:** Seed company + live RPCs only after Supabase project/repo exist. Do not invent parallel shapes.

Auth: invite + password (no magic link, no open signup) → session → `people.id = auth.uid()`.

---

## `replace_drawing`

**Who:** CM / Owner with `can_access_site` (CM must be assigned to the site)  
**Why:** Screen 5 — upload/replace without two `is_current` rows

### Args (json / named params)

| Arg | Type | Required | Notes |
|---|---|---|---|
| `p_site_id` | uuid | yes | |
| `p_title` | text | yes | sheet name |
| `p_sheet_number` | text | no | null/blank → sheet_key `''` |
| `p_revision` | text | yes | |
| `p_dated` | date | no | |
| `p_storage_path` | text | yes | already uploaded to `drawings` bucket |
| `p_file_size_bytes` | bigint | no | |
| `p_content_type` | text | no | default `application/pdf` |
| `p_replace_drawing_id` | uuid | no | if set, must be current row for that sheet; else match by site+title+sheet_key |
| `p_folder` | text | no | null copies the previous current row’s folder (or **Other** if there is no previous row). Blank trims to **Other**. A name is stored trimmed. Folder is not part of sheet identity. |

### Behaviour (one transaction)

1. Resolve previous current for `(site_id, title, sheet_key)` (or by `p_replace_drawing_id`).
2. Insert new `drawings` row: `is_current = true`, `supersedes_id = old.id` (null if first), `folder` from `p_folder` (null copies the previous current folder; blank is **Other**).
3. Set old row `is_current = false` if any. Do not change the old row’s folder.
4. Bump `sites.updated_at`.
5. Insert `drawing_audit` (`action = upload` or `replace`, revision snapshot, actor = me).
6. Return the new drawing row.

### Returns

Full `drawings` row (json object), including `id`, `is_current`, `supersedes_id`, `revision`, `dated`, `storage_path`, `created_at`.

### Errors (stable codes for UI)

| Code / message fragment | Meaning |
|---|---|
| `not_authorized` | not CM/Owner or no site access |
| `site_not_found` | bad site |
| `replace_target_not_current` | `p_replace_drawing_id` is not current |
| `storage_path_required` | empty path |

---

## `site_pack_manifest(p_site_id uuid)`

**Who:** anyone with `can_access_site`  
**Why:** Screen 3 offline download — **current sheets only**

### Returns

`jsonb` array (order: title asc, sheet_number asc):

```json
[
  {
    "drawing_id": "uuid",
    "title": "Ground Floor GA",
    "sheet_number": "A-101",
    "revision": "C",
    "dated": "2026-09-10",
    "file_size_bytes": 2457600,
    "content_type": "application/pdf",
    "signed_url": "https://…",
    "signed_url_expires_at": "2026-09-18T15:30:00Z"
  }
]
```

- Omit superseded rows.
- `sheet_number` may be `null`.
- Signed URL TTL: **1 hour** (Mobile may re-fetch manifest if expired before download finishes).
- Empty pack → `[]` (not an error).

### Errors

| Code | Meaning |
|---|---|
| `not_authorized` | no site access |
| `site_not_found` | |

---

## `company_sites_pulse()`

**Who:** CM / Owner only  
**Why:** Screen 6 multi-site list

**Scope (locked):**
- **Owner** → all sites in company
- **CM** → only sites they are assigned to (same gate as operative home)

### Args

None (company from `private.my_company_id()`; CM filter via `site_assignments`).

### Returns

`jsonb` array (order: site name asc):

```json
[
  {
    "site_id": "uuid",
    "name": "Plot 12 – Oak Estate",
    "address_line": "Oak Estate, Phase 2",
    "assignee_count": 6,
    "assignee_names_preview": ["Amy K", "Ben T", "Chris L"],
    "last_pack_update": "2026-09-17T18:02:00Z",
    "open_request_count": 2
  }
]
```

- `assignee_names_preview`: up to **3** display names; Mobile shows `+N` from `assignee_count`.
- `last_pack_update`: `sites.updated_at` (null if never updated).
- `open_request_count`: `drawing_requests` with `status = 'Open'` for that site.
- Operative calling this → `not_authorized`.
- CM with zero assignments → `[]` (not an error).

---

## Direct table reads Mobile may use (RLS-enforced)

| Use | Query shape |
|---|---|
| Me | `select * from people where id = auth.uid()` |
| Op home | `sites` via assignments (or join `site_assignments` where `person_id = me`) |
| Site pack list | `drawings` where `site_id = ?` — filter `is_current` in UI; superseded = deliberate second query/section |
| My requests | `drawing_requests` where `requester_id = me` |
| CM request inbox | `drawing_requests` for **assigned** sites (RLS); Owner sees company-wide |
| Assignments on site | `site_assignments` + `people` for CM notify UI |

Prefer RPCs above for replace / offline manifest / pulse so Mobile does not re-implement current-flip or signed URLs.

---

## Seed (after project exists — not yet)

One company, one Owner/CM, one operative, one site, one assignment, two drawings (current + superseded), one Open request — enough for Screens 1–6 smoke. Exact seed SQL lands with first migration PR.

---

## Out of contract

Notify outbox, seen/ack, snag tables, parallel REST “API layer” beyond Supabase + these RPCs.
