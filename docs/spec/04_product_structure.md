# 04 — Product structure: one list of giving worlds (D100)

## One layer
- **Giving worlds** are the only structure. One list, shown in full in the Donations tab (D3, D60); no separate "domains" layer and no domain hubs. This supersedes the two-layer model of D45 / D62 and the domain fills S37–S39.
- Each world has its own sub-screens, form, closing flow and functionality **on shared infrastructure** (D36). A world may define **sub-categories** (the "item subcategory" pattern of D18) that drive the create form, browse filters and matching.
- **A post lives in one primary world and may be marked for additional worlds** (D101). It is stored once, so edit, pause and cancel apply to every feed. Each world's feed shows posts where that world is primary **or** additional. Examples: a recurring volunteering slot shows in time and employment; a private maths lesson shows in knowledge and time.
- The feed **is** the give-and-take marketplace between people and between people and organizations, filterable by world and by sub-category.
- A world is either **active** (full in-app flow: form, matching, chat, closing) or a **portal** (links, knowledge and org blocks only). Launch flags switch a world between active and portal; they never hide it (D3, D60). In the Donations tab active worlds come first, then portals; each group follows the member's recent visits, kept on the device only (`FR-DONATE-001` AC8).
- Religion is out; spirituality and philosophy are a knowledge sub-category (D45, kept). Emergency is a **mode**, not a world (D42).

## Giving worlds
| World (HE) | slug | Give / take | Sub-categories | Rules | Phase |
|---|---|---|---|---|---|
| Items (חפצים) | `items` | Give away / ask for an item | furniture, kitchen, clothing, books, toys, baby, sport, electronics, tools, tickets, other (D18) | Baby-product safety warning | MVP, live |
| Food (אוכל) | `food` | Offer / ask for food | cooked, packaged, fresh, frozen, dry | Offer requires photo and expiry (D28, D21) | MVP, live |
| Transport (תחבורה) | `transport` (code slug `rides` until the registry task) | Offer / ask for a ride | rides (the launch flow, D70–D75); more later | Cost-sharing caps, official places only (D71) | MVP, live — launch wedge |
| Time & volunteering (זמן) | `time` | Offer / ask for help and volunteering | elderly & loneliness, sport, cleanups, class seats, general | Non-employer organizations recruit volunteers here (not in employment) | MVP, live |
| Money (כסף) | `money` | Donate to KC / to an approved org | — | Never between users (D4); portal until the provider is live (D20, D64) | MVP (Grow) → phase 2 |
| Housing & spaces (דיור) | `housing` | Offer / ask for a space: a place to stay, a roof in a crisis, a gathering space, storage | stays & hosting, emergency shelter (assisted, via organizations only), event & gathering space, storage space (`D112`) | ID verification for both sides (D30, S16); always free; exact address only after approval; emergency shelter never public | Next to launch |
| Knowledge (ידע) | `knowledge` | Teach / learn, advise / ask, **plus a free knowledge library** (courses with progress & quizzes, links, books, articles, videos) — [18](./18_knowledge_world.md) | science & technology, history & heritage, culture & art, spirituality & philosophy, rights & legal aid, lessons & mentoring (the shelf axis); subjects come from the topic graph (S64) | No binding legal or medical advice (D40); everything free (D119) | Phase 2 (K1), K2–K3 after |
| Medical (רפואה) | `medical` | Lend / borrow equipment; medical bodies publish calls | equipment lending, blood & organ donation (links to official registries), information | Only verified medical bodies publish (D30, S17); no medical advice; no PHI stored | Directory now; feed later |
| Animals (בעלי חיים) | `animals` | Give / take for animals | supplies, foster, adoption, knowledge | Everyone may publish and take (PM 2026-11-02); free only, like every world | Phase 2 |
| Democracy (דמוקרטיה) | `democracy` | — (empty for now) | — | Governance: rules, proposals, votes (11); strict party-political neutrality (S25) | Phase 3 |
| Employment (תעסוקה) | `employment` | Give = post a job; take = apply | — | Only a verified organization that is regulated by law and may legally employ posts jobs; others recruit volunteers in time (PM 2026-11-02; refines D41, D53) | Phase 2 |
| Challenges (אתגרים) | `challenges` | Give = open a challenge; take = join | community, personal | Every anonymity level; one engine with world challenges (D46, 10) | Phase 2 |

### Removed worlds and where their content went
| Former | Now |
|---|---|
| Experiences (`experiences`, D45) | tickets → items; class seats and workshops → time |
| Environment (domain) | recycling, plants, seeds → items; cleanups → time; cleanup challenges → challenges |
| Elderly & loneliness, sport (domains) | sub-categories of time |
| Science & technology, history & heritage, culture & art, spirituality & philosophy (domains) | sub-categories of knowledge |
| Creative (legacy code world) | knowledge · culture & art |
| App design (legacy code world, D18) | removed |

## Registrar of Nonprofits fields → KC (D44, remapped)
| Registrar field | Active nonprofits | KC world / sub-category |
|---|---|---|
| Religion | 12,657 | Not included (neutrality); spirituality & philosophy under knowledge (D45) |
| Education & training | 8,195 | knowledge; training → employment |
| Welfare services | 7,755 | time · elderly, food, items, housing |
| Community & society | 2,802 | time + challenges |
| Sport | 2,396 | time · sport; items · sport |
| Culture & art | 1,677 | knowledge · culture & art |
| Health / lifesaving | 1,060 | medical |
| Heritage / commemoration | 908 | knowledge · history & heritage |
| Research, science & tech | 527 | knowledge · science & technology |
| Housing & urban development | 502 | housing |
| Environment & animals | 443 | items / time (environment content), animals |
| Advocacy & social change | 417 | democracy (D40) |
| Trade unions | 393 | employment — nonprofit-sector roles only (S27) |
| Volunteering & funds | 214 | time + money |
| International relations | 189 | partnerships, not a world |

## World hub template (D36)
Every world is a deep hub, not just a feed. One infrastructure; each world defines itself via `WorldHubConfig` (accent color, icon, illustration, tagline, which blocks and in what order, form fields, sub-categories). Unique needs = **plug-in blocks** on the same template (e.g. animal water-stations map, heritage timeline, polls). In emergency, every hub shows an emergency block on top (D42). Content is written by the KC team; orgs propose updates for approval (S18).

| Block | Contents |
|---|---|
| 1. World feed | Same feed & controls as main (D5, D27); includes posts marked for this world as an additional world |
| 2. Knowledge screens | Guides, professional content |
| 3. Org directory | Search/filter/sort; proper-management badge (S35); link approval (D9) |
| 4. Practical info | Points, phones, services |
| 5. Forms | One form per post type (D28) |
| 6. Operations | History, driver board, hours log |
| 7. World challenges | Active challenges + start a new giving challenge here (D43, D46) |
| + plug-in / emergency block | Unique need (D36) / active emergency (D42) |

Tech: `G50` (spec → registry → data migration), `G51`; legacy rows G2, G24, G35.
