# Karma Community (KC)

**Karma Community** is a social platform for giving, requesting help, rides, chat,
and community moderation — backed by **Supabase** and the **Expo / React Native**
app in `app/apps/mobile/`.

## Preview

- **KC production** (`main`): [https://karma-community-kc.com/](https://karma-community-kc.com/)
- **Dev web** (`dev` branch): Cloudflare Pages deploy at `https://dev.karma-community.pages.dev/`
  (see [`docs/SSOT/ENVIRONMENTS.md`](docs/SSOT/ENVIRONMENTS.md))

## Quickstart

1. **Clone** this repository.
2. **Start local Supabase** (Docker required): from the repo root, run `./scripts/dev-up.sh`.
3. **Install dependencies:** `cd app && pnpm install`
4. **Configure env:** copy [`app/.env.example`](app/.env.example) to `app/.env.local` and fill in
   the local API URL and anon key from `supabase status`.
5. **Run the app:** `cd app && pnpm mobile` (or `pnpm ios` / `pnpm android`).

Never use hosted dev/prod credentials in local `.env.local`.

## Repository map

```
app/
├── apps/mobile/       # KC mobile + web export (Expo)
├── packages/          # domain, application, infrastructure-supabase, ui
supabase/              # migrations, RLS, Edge Functions
docs/SSOT/             # specs, backlog, decisions
```


## Agents & deploy

| Doc | Purpose |
| --- | --- |
| [`docs/agents/OPERATING_MODEL.md`](docs/agents/OPERATING_MODEL.md) | Who ships what; PR → `dev` → deploy |
| [`docs/agents/MIGRATION_RANGES.md`](docs/agents/MIGRATION_RANGES.md) | Claim SQL version ranges before writing migrations |
| [`docs/agents/ARCHITECTURE.md`](docs/agents/ARCHITECTURE.md) | Apps / packages / supabase map |
| [`docs/agents/DEPLOY.md`](docs/agents/DEPLOY.md) | DB + web + mobile deploy pointers |
| [`docs/agents/RELEASE.md`](docs/agents/RELEASE.md) | Versioning, TestFlight / Play internal, rollback |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) and [AGENTS.md](AGENTS.md) for workflow rules.
Open PRs against **`dev`**, not `main`.

## License

See [LICENSE](LICENSE). Inbound contributions: [CLA.md](CLA.md).
