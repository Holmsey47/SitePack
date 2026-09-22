# SitePack v1 — Screen Source of Truth

**Status:** Working SoT — CM site scope locked (18 Sep 2026)  
**Owner:** SitePack Lead  
**Consumers:** SitePack Mobile (UI), SitePack Data (schema/RLS)  
**Rule:** If it isn’t on this page, it isn’t v1. No Build until these five screens are unambiguous.

**Jobs locked (day one):**
1. Operative gets **latest drawing for this site** on phone (~10s), offline after first sync  
2. Operative/supervisor knows PDF is **current** (rev + date) without ringing office  
3. CM **pushes a new revision** to assigned people; old retires as default  
4. Operative **requests a missing/unclear drawing** → CM queue (not WhatsApp)  
5. Owner sees **all-sites pack health**; CM sees pulse for **assigned sites only** (assignees, last update, open requests)

**People model:** Trade is a **label** on a person (dryliner, plasterer, labourer, …). Same screens for all trades. Not a drylining-only app.

**Roles (v1):**
| Role | Sees | Can do |
|---|---|---|
| Operative | Assigned sites only | View pack, download offline, request drawing |
| CM | Assigned sites only (~3 CMs split ~40 sites) | Upload/replace rev, manage assignments on those sites, answer requests for those sites |
| Owner | All company sites | Full pulse + same CM tools on any site; no separate “admin garden” |

---

## Out of scope (refuse)

Snag + photo, markup/compare/BIM/OCR, full RFI/variation/submittal, company chat / WhatsApp bot, RAMS / inductions / CSCS / timesheets / wages / plant, print-room integrations, PC guest portals / ISO 19650 CDE, CIS / accounting, Fieldwire or Site Manager Pro feature parity.

**Phase B (after drawings v0 — parked, not Phase A):** thin CM snag/photo — see appendix below.  
**Still refuse even in Phase B:** drawing pin/markup, snag libraries, PlanRadar-style defect OS, CompanyCam photo-only clone.

---

## Shared UI rules (every screen)

- Phone-first; thumb-reachable primary actions  
- **Current** is visceral: large rev badge + date; superseded is grey, ugly, not default  
- If an operative can happily work from an old PDF inside the app, we failed  
- Offline: current pack pre-downloads; airplane-mode must still open current sheets  
- Copy enemy: WhatsApp + Drive + van folder + print room — every screen makes that swap obvious  
- Empty states tell the next action in one line (no “coming soon” modules)

---

## Screen 1 — Login / enter

**Who:** All  
**Job:** Get in with zero training.

**Shows:**
- **Invite link** from Owner/CM (no open signup)  
- First visit: set password once → thereafter **email + password**  
- Not magic link

**Acceptance:**
- [ ] Invitee sets password once, then signs in with email + password  
- [ ] First-time operative from invite lands on **assigned-sites home** with their sites, no empty “explore company”  
- [ ] Failed auth shows plain retry; no marketing carousel  
- [ ] Session survives app kill; re-open does not force re-login every muddy Monday  
- [ ] No public self-serve signup path

**Not in v0:** Magic link, open signup, SSO enterprise, CSCS login, multi-company picker beyond one company.

---

## Screen 2 — Assigned-sites home

**Who:** Operative; CM uses the **same list query** (assigned only). Owner uses Screen 6 for all-company pulse (may also land on assigned list if they have assignments — optional).  
**Job:** Jobs 1 + assignment model — “only sites I’m on / I manage.”

**Shows:**
- Flat list of **assigned sites only** (name, optional plot/address short line, pack age / “Updated …” )  
- Tap site → Site pack  
- Operative optional: badge count of open requests **I** raised  
- CM optional: badge count of **Open** requests on my assigned sites

**Does not show:** Other company sites, programmes, diaries, chat, snags, wages.

**Acceptance:**
- [ ] Operative with 3 of 40 sites sees exactly those 3 — never the other 37  
- [ ] CM with ~⅓ of sites sees only those — never the full 40  
- [ ] Unassigned operative/CM sees empty state: “You’re not on a site yet — ask your owner” (no browse)  
- [ ] From cold open to first site tap ≤ 2 taps after login  
- [ ] List works offline for already-synced site names; stale warning if pack older than N days (N configurable later; default show “Updated [date]”)

**Data needs:** `site_assignments` RLS: operative **and** CM `select` sites where assigned. Owner may list all via pulse RPC.

---

## Screen 3 — Site pack (current drawings)

**Who:** Anyone with site access: operative/CM if assigned; Owner any company site  
**Job:** Jobs 1–2 — latest sheet, trust it’s current, offline.

**Shows:**
- Site name header  
- **Folders** that contain any sheet (one level: Ground floor, First floor, …). Tap a folder.  
- A folder with only superseded sheets stays on the list, grey, labelled **Archive**, and still opens.  
- Inside a folder that has a current sheet: **current** sheets — title, sheet number, **big rev**, date. One more tap opens the PDF. Superseded sheets for that folder stay collapsed behind an extra tap.  
- Inside an archive folder: the superseded sheets are the list. Nothing current to hide them behind.
- Pack actions: **Download for offline** is still the whole site’s current pack, not one folder  
- Primary secondary action: **Request a drawing**

**Replace behaviour (visible to CM only on this screen or via CM feed — see Screen 5):** when a sheet is replaced, new file is current; previous moves to superseded automatically.

**Acceptance:**
- [ ] Opening a current sheet never defaults to a superseded file  
- [ ] Rev + date visible without opening the PDF  
- [ ] After one successful download, airplane mode still opens every **current** sheet in the pack  
- [ ] Superseded open path is ≥1 extra deliberate step vs current  
- [ ] Empty pack: “No drawings yet” + (operative) Request drawing / (CM) Upload  
- [ ] Large PDF: fail gracefully with retry; never corrupt “current” pointer

**Data needs:** drawings with `is_current`, `revision`, `dated`, `supersedes_id`; storage URLs; per-site pack download manifest.

**Not in v1:** Markup, compare, layers, title-block OCR, print, share-to-WhatsApp as primary (optional system share OK).

---

## Screen 4 — Request a drawing

**Who:** Operative (create); CM (inbox + respond)  
**Job:** Job 4 — missing/unclear sheet without WhatsApp burial.

**Operative create:**
- From site pack: site is pre-filled  
- Fields: what they need (free text), optional sheet/ref hint, optional photo of what’s wrong/missing  
- Submit → confirmation with status **Open**

**CM inbox:**
- List: **only requests on sites the CM is assigned to** — site, requester, snippet, status (`Open` / `Sent` / `Closed`), age  
- Owner inbox: all company sites  
- Open item: context + reply by **uploading/attaching drawing** (ties to replace/current flow) or mark sent/closed with note  
- Not a full RFI: no formal response types, no distribution matrix, no ball-in-court bureaucracy

**Acceptance:**
- [ ] Operative submit is ≤3 fields + send; site always attached  
- [ ] Request never appears as a chat thread; it is a queue item  
- [ ] CM can go from Open → attach/upload drawing → status Sent without leaving SitePack for WhatsApp  
- [ ] CM never sees requests for sites they’re not assigned to  
- [ ] Owner/CM multi-site list shows **open request count** per visible site  
- [ ] Operative sees status of **their** requests (Open / Sent)

**Data needs:** `drawing_requests` with site_id, requester_id, body, status, timestamps; optional attachment; link to drawing when fulfilled.

**Refuse:** RFI numbering schemes, AI triage, @mentions, company-wide request feed for operatives.

---

## Screen 5 — CM upload / replace revision

**Who:** CM on an **assigned** site; Owner on any company site  
**Job:** Job 3 — push new rev to assigned people; old dies. Must beat “forward PDF on WhatsApp” on speed.

**Flow (wizard, target &lt;2 minutes):**
1. Pick site (or land from site)  
2. Upload PDF (or pick existing sheet to replace)  
3. Set title / number (if known) / **revision** / date  
4. Confirm → **becomes current**; previous auto-superseded  
5. Assigned people get light push/SMS that pack updated (not an announcements product)

**Acceptance:**
- [ ] Happy path upload+replace measurable under **2 minutes** on a phone connection  
- [ ] After replace, operative pack shows new rev as current without manual “make current”  
- [ ] Old rev only in superseded  
- [ ] CM sees who is assigned on that site before/after notify  
- [ ] Failed upload does not leave two “current” rows

**Data needs:** upload to storage; transactional current flip; light notify outbox; audit row `who / what rev / when`.

**Not in v1:** Bulk CDE sync, title-block OCR, automatic rev letter detection as blocker (manual rev entry OK).

---

## Screen 6 — Multi-site pulse

**Who:** Owner (all company sites); CM (assigned sites only — same columns, smaller set). Operative never.  
**Job:** Job 5 — pulse, not a dashboard garden. Real shape: ~40 sites, ~3 CMs who split them; full company list confuses CMs.

**Shows (flat list/table):**
- Site name  
- Assignees (count or names truncated)  
- Last pack update (date/relative)  
- Open requests count  
- Tap → site pack (CM tools if role allows on that site)

**Acceptance:**
- [ ] Owner list works at 40+ sites without module tabs  
- [ ] CM pulse shows **only assigned** sites (same UI component / query path as home list + counts)  
- [ ] Sort/filter minimal: search by site name; optional “stale pack” / “has open requests”  
- [ ] No charts, heatmaps, or KPI theatre in v1  
- [ ] Operative role never reaches this screen

**Data needs:** `company_sites_pulse` — Owner: all company sites; CM: assigned subset only. Counts for open requests; `sites.updated_at`.

---

## Cross-cutting acceptance (ship gate)

| # | Gate | Pass condition |
|---|---|---|
| G1 | 10-second trust | Operative cold-open → assigned site → current sheet visible/open in ~10s on warm device with pack synced |
| G2 | Assigned-only | RLS + UI: operative **and CM** cannot fetch or guess a site they’re not assigned to; Owner can |
| G3 | Current-by-default | No path where superseded is the default open |
| G4 | Offline pack | Airplane mode: all current sheets in downloaded pack open |
| G5 | Request loop | Operative request appears in inbox of CMs **assigned to that site** (and Owner) same day |
| G6 | CM speed | Upload/replace &lt;2 min; faster than typical WhatsApp forward+hope |
| G7 | Multi-site pulse | Owner sees pack age + open asks for **all** sites; CM for **assigned** sites only |
| G8 | Wedge | Phase A: no snag/RFI/chat/wages/RAMS screens or nav stubs. Phase B snag only after drawings v0, thin scope per appendix |

**v1 success metric:** Operative on muddy low-signal site opens app and trusts the sheet in under 10 seconds — without calling the office.

---

## Locked decisions

1. **CM site scope (LOCKED 18 Sep 2026):** CM sees **only assigned sites** — not all company sites. Owner sees all. (~40 sites / ~3 CMs split.)
2. **Auth (LOCKED 18 Sep 2026):** **Invite link + password** for v0. Owner/CM invites → set password once → email+password after. **No magic link. No open signup.**
3. **Thin CM snag/photo (LOCKED 18 Sep 2026):** **Phase B only** — after drawings v0 ships. Does **not** block drawing-pack cloud build. Phase A stays drawings-only.

## Open decisions (still)

4. **Notify:** push only, SMS only, or both for pack updates?  
5. **Seen/ack:** optional “seen Rev X” in v1 or defer to post-v1 audit polish?

Until 4–5 are answered, Mobile/Data may assume: push if available else in-app only; defer seen/ack.

---

## Review rule

Mobile and Data ship **only** against Screens 1–6 + gates G1–G8.  
Anything else needs Lead written approval in SitePack Build before schema or UI work starts.

---

## Appendix — Phase B thin CM snag/photo (parked)

**When:** After drawings v0 (Screens 1–6 + G1–G8 drawings path) ships. Not in Phase A / cloud scaffold for drawings.

**IN:**
- CM on **assigned** site: photo + location text (floor/area/room) + description + assign to operative **or** site queue
- Operative sees items **assigned to them** on their sites
- Ping/notify assignee on assign

**OUT (refuse even in Phase B):**
- Pin/markup on drawings
- Snag libraries / templates / defect taxonomies
- PlanRadar-style defect OS
- CompanyCam-style photo documentation product
- Full RFI / variation linkage

**Data:** `site_issues` sketch only until Phase B opens — no migrations that block drawings v0.
