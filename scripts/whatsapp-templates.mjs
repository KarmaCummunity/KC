#!/usr/bin/env node
/**
 * WhatsApp templates as code (issue #936).
 * Source of truth: supabase/functions/_shared/whatsapp/templates.json
 *
 *   node scripts/whatsapp-templates.mjs payloads        # print Meta create payloads (dry run, default)
 *   node scripts/whatsapp-templates.mjs sql             # print the VALUES rows for the DB seed migration
 *   node scripts/whatsapp-templates.mjs submit --yes    # POST to Meta (needs env, see below)
 *
 * submit reads WHATSAPP_CLOUD_API_TOKEN, WHATSAPP_WABA_ID and optional
 * WHATSAPP_GRAPH_API_VERSION from the environment. It never prints the token.
 * Follow docs/agents/WHATSAPP_TEMPLATES.md before submitting.
 */

import fs from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
export const REGISTRY_PATH = path.join(REPO_ROOT, "supabase/functions/_shared/whatsapp/templates.json");
const LANGS = ["he", "en"];

export function loadRegistry(file = REGISTRY_PATH) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

/** Meta Graph `POST /{waba_id}/message_templates` body for one name + language. */
export function toMetaPayload(t, lang) {
  const v = t.languages[lang];
  const body = { type: "BODY", text: v.body };
  if (t.params.length > 0) body.example = { body_text: [v.examples] };
  return { name: t.name, language: lang, category: t.category, components: [body] };
}

const sqlQuote = (s) => `'${String(s).replaceAll("'", "''")}'`;

export function toSqlValues(reg) {
  const rows = [];
  for (const t of reg.templates) {
    for (const lang of LANGS) {
      rows.push(
        `  (${sqlQuote(t.name)}, ${sqlQuote(lang)}, ${sqlQuote(t.category.toLowerCase())}, ` +
          `${sqlQuote(t.languages[lang].body)}, ${sqlQuote(JSON.stringify(t.params))}, ${reg.version})`,
      );
    }
  }
  return rows.join(",\n");
}

async function submit(reg) {
  const token = process.env.WHATSAPP_CLOUD_API_TOKEN;
  const waba = process.env.WHATSAPP_WABA_ID;
  const version = process.env.WHATSAPP_GRAPH_API_VERSION || "v21.0";
  if (!token || !waba) {
    console.error("Set WHATSAPP_CLOUD_API_TOKEN and WHATSAPP_WABA_ID (never commit them).");
    process.exit(2);
  }
  let failed = 0;
  for (const t of reg.templates) {
    for (const lang of LANGS) {
      const res = await fetch(`https://graph.facebook.com/${version}/${encodeURIComponent(waba)}/message_templates`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(toMetaPayload(t, lang)),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok) {
        console.log(`✓ ${t.name}/${lang}: id=${json.id ?? "?"} status=${json.status ?? "?"}`);
      } else {
        failed++;
        console.error(`✗ ${t.name}/${lang}: HTTP ${res.status} ${json?.error?.message ?? ""}`);
      }
    }
  }
  if (failed) process.exit(1);
}

async function main() {
  const [cmd = "payloads", ...rest] = process.argv.slice(2);
  const reg = loadRegistry();
  if (cmd === "sql") {
    console.log(toSqlValues(reg));
  } else if (cmd === "payloads") {
    for (const t of reg.templates) for (const lang of LANGS) console.log(JSON.stringify(toMetaPayload(t, lang)));
  } else if (cmd === "submit") {
    if (!rest.includes("--yes")) {
      console.error("Refusing to submit without --yes. Run `payloads` first and follow the checklist.");
      process.exit(2);
    }
    await submit(reg);
  } else {
    console.error(`Unknown command: ${cmd}`);
    process.exit(2);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
