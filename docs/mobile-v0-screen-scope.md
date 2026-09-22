# SitePack Mobile — v0 screen scope (against Lead SoT)

**Status:** Scoping only — no cloud-agent scaffold until Lead greenlights repo name/org  
**Source:** `/workspace/SitePack/v1-screen-sot.md` (working SoT)  
**Stack intent:** Expo + Expo Router + TypeScript; mock data layer until Data publishes migrations  

## Build phases (Lead order)

### Phase A — first cloud-agent build (after repo greenlit)
| # | Screen | Routes (proposed) | Role | Mock until Data |
|---|---|---|---|---|
| 1 | Login / enter | `/(auth)/login` | All | Invite link → set password once; then email+password; stub session → role |
| 2 | Operative home | `/(app)/home` | Operative | Assigned sites list only |
| 3 | Site pack | `/(app)/sites/[siteId]` | Op + later CM | Current list + collapsed superseded + offline download |
| 4 | Request drawing (create) | `/(app)/sites/[siteId]/request` | Operative | Free text + optional ref; status Open |

**Phase A out:** CM upload/replace, CM request inbox, Owner/CM multi-site (wait for Data drawings + assignments).

### Phase B — after Data has drawings + assignments
| # | Screen | Routes (proposed) | Role |
|---|---|---|---|
| 5 | CM upload / replace | `/(app)/sites/[siteId]/upload` (+ replace path) | CM / Owner |
| 4b | CM request inbox | `/(app)/requests` | CM / Owner |
| 6 | Multi-site pulse | `/(app)/sites` | Owner = all company; CM = assigned only (same as home) |

## Shared UI (every Phase A screen)
- Phone-first, thumb primary actions; no nav stubs for refused features (G8)
- Current = large rev + date; superseded grey, collapsed, never default open (G3)
- Offline: download current pack; airplane mode opens current sheets only (G4)
- Empty states = one-line next action

## Acceptance mapped (Phase A must hit)
- Login → home with assigned sites only; session survives kill (Screen 1)
- Op with N of M sites sees exactly N (G2 / Screen 2)
- Cold open → site tap ≤ 2 taps after login; ~10s to current sheet when synced (G1)
- Pack: rev+date without opening PDF; superseded ≥1 deliberate step (Screen 3)
- Offline ready state + airplane opens all **current** in downloaded pack (G4)
- Request ≤3 fields + send; queue item Open/Sent — not chat (Screen 4 / G5 create side)

## Data contract (consume, don’t invent)
Until Data publishes migrations, Mobile uses a **repository interface** only:
- `sites` / `site_assignments` (RLS: assigned-only for operative)
- `drawings` (`is_current`, `revision`, `dated`, `supersedes_id`, storage URL)
- pack download manifest per site
- `drawing_requests` (site_id, requester_id, body, status, timestamps)

No invented REST endpoints. Swap mock → Supabase when Data ships.

## Locked / assumed decisions
- **CM site scope LOCKED:** assigned sites only (same list query as operative home). Owner = all company sites (pulse).
- Auth LOCKED: password + invite link (no magic link; no open signup)
- Notify: push if available else in-app only
- Defer seen/ack

### Role → home list
| Role | Home list query |
|---|---|
| Operative | assigned sites |
| CM | assigned sites (same query) |
| Owner | `company_sites_pulse` full company |

## Explicit refuse (no screens, no stubs)
Snag, markup, RFI engine, chat, wages, RAMS, CIS, CDE, KPI garden, SSO/CSCS.

## Blockers before code
1. Lead confirms repo name/org with user (Origin namespace or GitHub)
2. Then Mobile launches cloud-agent Phase A only
