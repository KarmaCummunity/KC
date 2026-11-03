# 09 — Emergency mode (D42, D51, D56)

A full app **mode**, scoped by region and world (D42). It changes: the feed (emergency items on top with a banner), notifications (`emergency` group), world hubs (emergency block on top), and templates (ready forms like "host evacuees", "blood units needed").

## Who declares
- **General emergency:** only the **main admin** (D51).
- **Inside an org:** org manager or the org's authorized security officer — for the org's members, volunteers and events only (D51).
- **Verified official/state body** (e.g. Home Front Command, MDA, local authority): within its permissions — region and world under its responsibility (D56). Approved by the main admin with a defined permission (region, world, level); every declaration is logged (S42).
- Every declaration lasts 24h, renewable, and is based on an official source (S28).

| Level | `EmergencyLevel` | Example | Scope |
|---|---|---|---|
| National | `national` | War, earthquake | All users, relevant worlds |
| Regional | `regional` | Evacuation of northern towns | Region; housing, food, rides |
| Local | `local` | Fire in a town | City + radius |
| Targeted shortage | `targeted_shortage` | Blood unit shortage in Eilat | World + region + resource |

Rules (S28): emergency notifications bypass quiet hours only in the affected region, user can disable; +50% karma on giving in the declared world/region; false reports prioritized in moderation.
Phasing: general emergency by main admin — next to launch; local & targeted — phase 2.
Tech: · research "resilience & emergencies" · none · G25
