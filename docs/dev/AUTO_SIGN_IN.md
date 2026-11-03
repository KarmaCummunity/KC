# Dev-only auth shortcuts

Two ways to skip the login screen during local UI iteration. **Both are off by default and compiled out of production bundles**, so neither is a security risk in main / prod.

| Mode | Speed | Real data? | Mutations work? | When to use |
|---|---|---|---|---|
| **Ghost session** (`EXPO_PUBLIC_DEV_GHOST_SESSION`) | Instant, no network | ❌ Supabase queries 401 | ❌ | Layout / RTL / typography / navigation audit |
| **Auto sign-in** (`EXPO_PUBLIC_DEV_AUTO_SIGN_IN`) | Slow (real auth roundtrip) | ✅ | ✅ | Verifying flows that read or write data |

A red `DEV …` banner appears at the top of every screen when either mode is active so it's impossible to forget you're in dev shortcut mode.

## Mode A — Ghost session (recommended for layout work)

Injects a synthetic `AuthSession` into the auth store. No Supabase call, no real user, no RLS. The fake JWT is rejected by every API endpoint, so any screen that fetches data shows its loading / error / empty state — but the layout, RTL behavior, and component composition render exactly as they would for a real user.

**Enable:** add to `app/apps/mobile/.env` (gitignored):

```bash
EXPO_PUBLIC_DEV_GHOST_SESSION=1
```

Restart the dev server. You should see in the browser console:

```
[devGhostSession] Injecting fake session — DEV-ONLY, gated by __DEV__ + EXPO_PUBLIC_DEV_GHOST_SESSION.
```

**Disable:** remove the line (or set `=0`), restart.

## Mode B — Auto sign-in (real test user)

Uses real Supabase auth with stored test credentials. Full functionality — same code path as a real user, just automated.

**Enable:** add to `app/apps/mobile/.env`:

```bash
EXPO_PUBLIC_DEV_AUTO_SIGN_IN=1
EXPO_PUBLIC_DEV_TEST_EMAIL=karmacommunity2.0@gmail.com
EXPO_PUBLIC_DEV_TEST_PASSWORD=<your test password>
```

Console line on success:

```
[devAutoSignIn] Auto-signing in as karmacommunity2.0@gmail.com (DEV-ONLY: gated by __DEV__ + EXPO_PUBLIC_DEV_AUTO_SIGN_IN).
```

**Disable:** delete the three lines (or set the flag to `0`), restart. The regular sign-out button inside the app also clears the session — auto-sign-in only runs on cold start when nothing is restored.

If both modes are enabled, ghost wins (it short-circuits before the auto sign-in path). Ghost mode also skips the onboarding-state read and the FR-CHAT-001 inbox subscription, since both would 401.

## Safety model — why this is not a back door

Three independent gates per mode, **all must be true** for any code to execute. AND production bundles do not contain any of this code at all.

1. **`__DEV__`** — Metro/Expo replace this with the literal `false` in production builds. The wrapper `if (!__DEV__) return null;` then makes the entire branch unreachable code that the bundler dead-code-eliminates. The fake session shape, the env-var reads, the test credentials, even the function names disappear from `dist/`. Even if a production environment somehow defined `EXPO_PUBLIC_DEV_GHOST_SESSION=1`, there is no code left to read that variable.
2. **`EXPO_PUBLIC_DEV_<flag>`** — explicit per-developer opt-in via `.env` (gitignored). Without the exact string `'1'` the function returns immediately.
3. **For Mode B only**: both `EXPO_PUBLIC_DEV_TEST_EMAIL` and `EXPO_PUBLIC_DEV_TEST_PASSWORD` must be set, else the function logs and returns `null`.

Implementations:
- Ghost: [`app/apps/mobile/src/services/devGhostSession.ts`](../../app/apps/mobile/src/services/devGhostSession.ts)
- Auto sign-in: [`app/apps/mobile/src/services/devAutoSignIn.ts`](../../app/apps/mobile/src/services/devAutoSignIn.ts)
- Wiring: [`app/apps/mobile/src/components/AuthGate.tsx`](../../app/apps/mobile/src/components/AuthGate.tsx) — both run as fallbacks AFTER the FR-AUTH-013 cold-start restore, so an existing real session always takes priority.
- Banner: [`app/apps/mobile/src/components/DevBanner.tsx`](../../app/apps/mobile/src/components/DevBanner.tsx)

## Production / CI checklist

When building for production (`expo export`, EAS, Cloudflare Pages):

- [ ] Verify the production environment does **not** define any `EXPO_PUBLIC_DEV_*` variable. (Even if defined, `__DEV__` is `false` so the code is unreachable — but defense in depth.)
- [ ] Confirm `EXPO_PUBLIC_DEV_TEST_PASSWORD` is **not** committed to git. The repo's `.gitignore` already excludes `.env`; `.env.example` only contains commented placeholders.
- [ ] After a production build, grep the generated bundle for the dev-shortcut symbols — they should be absent (proves dead-code elimination removed both branches):
  ```bash
  pnpm --filter @kc/mobile exec expo export --platform web
  if grep -rq "devGhostSession\|devAutoSignIn" apps/mobile/dist/; then
    echo "❌ FAIL — dev shortcut code present in production bundle"
    exit 1
  else
    echo "✅ stripped from bundle"
  fi
  ```
  Add this grep to CI to make the dead-code-elimination invariant durable.

## Why this approach (vs alternatives)

- **Why not bypass RLS or fake user data?** Anything that diverges from real Supabase auth drifts from how production behaves — an RLS regression caught in prod but not dev is exactly what we want to avoid. Mode B uses the real auth code path; Mode A is layout-only and surfaces network failures explicitly.
- **Why not Cypress / Playwright with a saved session?** We don't have an E2E suite yet. When we do, this can be deleted in favor of programmatic session injection scoped to test runs.
- **Why an env flag and not a separate build target?** Iteration speed — flip a `.env` line and restart, vs. maintaining a parallel build pipeline.
- **Why ship the dev banner to all dev builds, not just when shortcuts are active?** It IS only when shortcuts are active — the banner reads the same flags and renders nothing otherwise. Goal: impossible to forget you're in shortcut mode while testing.
