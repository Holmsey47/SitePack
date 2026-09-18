# Decision: v1 wedge — Sites, drawings, requests

**Status:** Press ahead (docs-first) · Updated 18 Sep 2026  
**Working product name:** SitePack (interim only)

## In scope
1. Sites + people assignment (operative sees only assigned sites)
2. Drawing list per site: title, number if known, revision, date, current flag
3. Upload / replace revision (CM): new = current; old → superseded
4. Phone viewer + offline pre-download of current pack
5. Request a drawing → CM inbox tied to site
6. Owner/CM multi-site list: sites, assignees, last update, open requests
7. Light push/SMS on pack update
8. Minimal audit: who uploaded what rev when; optional “seen”

## Out of scope (90 days — refuse)
Snagging + photo · markup/BIM/OCR · full RFI · WhatsApp bot · RAMS/inductions/timesheets/wages · print-room integrations · PC CDE / ISO 19650 suite · CIS/accounting · matching Fieldwire/SMP feature-for-feature

## Audience
All site trades including labourers. Trade = label on people, not a drylining-only product. Pilot company shape remains Shaun’s drylining/plastering firm.

## Decision: CM site visibility (18 Sep 2026)

**Locked by user.** Contracts managers see **only sites they are assigned to**, not all company sites.

Rationale: pilot company shape ~40 sites with ~3 CMs who split them; all-sites access causes confusion / wrong-site risk.

| Role | Sites visible |
|------|----------------|
| Operative (incl. labourer) | Assigned only |
| Contracts manager | Assigned only (can upload/replace + handle requests on those) |
| Owner | All company sites |


## Decision: Auth for pilot (18 Sep 2026)

**Locked:** password + invite link for everyone. No magic link in v0.

Owner/CM sends invite → invitee sets password once → thereafter email + password. No open signup.

## Decision: Snag / photo timing (18 Sep 2026)

**Locked:** thin CM snag+photo is **Phase B** — after drawings pack v0 ships and works.

Thin scope (Phase B): photo + floor/area/room + description + assign to operative (or site queue). No markup, snag libraries, or full defect OS.
