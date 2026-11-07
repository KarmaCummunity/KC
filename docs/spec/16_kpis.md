# 16 — KPIs (S32)

Numeric targets set after launch.

| Area | Metric |
|---|---|
| North star | Successfully closed givings per week |
| Growth | MAU, sign-ups, WhatsApp groups migrated, imported posts claimed |
| Liquidity | % posts with a response within 24h; % closed |
| Engagement | Actions per visit, likes & comments, challenge participants |
| Giving | Volunteer hours, rides, kg food, donations to KC |
| Impact per world | Closed givings per world and sub-category (D100) |
| Knowledge | Sessions completed; questions answered within 48h; resources published and share verified; "helped me" per resource; enrollments, lesson completion rate, course completions; demand gaps closed; search success; agent answers citing a KC resource ([18 §18.10](./18_knowledge_world.md)) |
| Organizations | Active orgs, events, jobs |
| Trust | % verified, reports per 1,000 posts, review time |
| Emergency | Time from declaration to first response, requests answered |
| Satisfaction | NPS, store rating |
| Product/market fit | Sean Ellis score: share of "very disappointed" among users active on ≥ 2 days in the 14 days before answering. Target ≥ 40%, read only with n ≥ 40, reported with its 95% margin of error and checked against 7-day return (KC#1058; legacy FR-SETTINGS-016 AC10, FR-ADMIN-021 AC8) |

## Who sees which statistics (D106, PM 2026-11-03)
One statistics model, shown per audience and permission:
- **Admins (portal "Statistics")** see everything: the per-world flow funnel (published → booked → confirmed → handed over / cancelled, closed, median hours; G43) with the north-star total of givings closed, beside match quality and the community numbers. Counts only, no member identified.
- **A member (their own statistics screen)** sees their counters, activity timeline and **givings by world** (given / received / closed). Personal statistics are owner only.
- **An organization (its profile)** shows its public impact (givings closed, people helped, volunteer hours, active listings); its managers also see their own flow funnel. Waits for the organization entity (ORG-P1).

Tech: legacy `spec/10_statistics.md` FR-STATS-007 (`/admin/stats`, `admin_world_flow_funnel` `0542`), FR-STATS-008 (`my_world_givings` `0547`), FR-STATS-009 (G54).
