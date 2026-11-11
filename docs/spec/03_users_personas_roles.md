# 03 — Users, personas, roles

## Personas (S31)
| Persona | Who | Needs from KC | Worlds |
|---|---|---|---|
| Michal, occasional giver | 34, moving house | Give away fast and safely, no haggling | items, food |
| Danny, daily driver | Commutes TLV–Jerusalem | Fill seats without managing a group | rides |
| Ruth, quiet requester | Single mother | Ask without exposure | food, items, knowledge |
| Noam, young volunteer | 22, student | One-off volunteering, recognized hours | time; sport, tech |
| Sarah, volunteer coordinator | Mid-size nonprofit | Publish events, approve hours, recruit | orgs, events, jobs |
| Avraham, lonely elder | 81, lives alone (often via family) | Regular call, help with errands | time · elderly & loneliness |
| Yossi, WhatsApp group admin | Runs 3 ride groups | Better tool without losing the community | rides, growth (D38) |
| KC admin | Team | Moderation, trust, emergencies | everything |

## Roles & permissions
| Role | Permissions | Phase |
|---|---|---|
| Guest | View only; "Join" on every screen | MVP |
| Community member | All post types, volunteering (D22), likes/comments (D25), event registration (D31), challenges (D43); sees only own karma (D29) | MVP |
| Suspended user | Sees everything, cannot act, can chat with support (D33) | MVP |
| Org-affiliated volunteer | Post on org's behalf, register to its events without verification (D22); logs hours approved by manager (D32) | MVP |
| Organization account | Public profile + own sign-in identity; members with roles act in its name via a profile switcher (D88); always public, may follow (D90); publishes in every world, no cap (D91), and offers, requests and searches in every world like a member (`D115`); always verified on approval (D53) | MVP → Phase 2 |
| Org treasurer | Keeps the org's books in the Admin Portal finance sub-tree: entries, receipts, 46(a) status, imports, reconciliation, exports (D76–D80) | Phase 2 |
| Org accountant | External accountant / auditor: reads the org's books and exports; never writes (D76) | Phase 2 |
| Medical body | Only publisher in the medical world (D30) | Later |
| Org manager / authorized security officer | Activates emergency mode **inside the org only** (D51) | Phase 2 |
| Verified official/state body | Declares emergency within its permissions (D56, S42) | Phase 2 |
| Hotline operator | Sensitive requests | Later |
| KC admin / main admin | Reports (D33), ratings (D24); main admin sees everything (D29) and alone declares a general emergency (D51) | MVP |

**Management hierarchy view (D83, D84).** The admin portal presents every role holder above as layers across all organizations, one layer per level of the reporting chain. Depth is not fixed: inside an org a manager can report to a manager who reports to a manager, down to a volunteer manager and a volunteer, and each link adds a layer. The community stands under the layers and is shown as a count only, never as identities. A suspended user is a regular member until an admin decides (D84). Visibility follows D29: the main admin sees every org; anyone else sees the orgs their own roles belong to. Self-declared org affiliations are counted, never shown as granted roles. Tech: FR-ADMIN-028 (`docs/spec/requirements/12_super_admin.md` §17), `admin_hierarchy_census` (migration `0461`).

**Team management (D85, D86).** From any person in the hierarchy — or any user found in the admin search — a team manager opens one person screen and manages that person end to end: sees their roles and where each applies, grants a new role, changes a role in place (the person keeps their manager and their reports), revokes a role, and sets their direct manager. Permissions come from the role only (D76): the screen lists what each role allows, and changing permissions means changing the role. Every organization runs its own team (D77): its admins and managers manage their own organization below them, within their authority; the main admin manages every organization. Tech: FR-ADMIN-030 (`docs/spec/requirements/12_super_admin.md` §18), `admin_change_role` and the org-scoped `admin_list_admins` (migration `0465`).
