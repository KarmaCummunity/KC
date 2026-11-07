#!/usr/bin/env node
/**
 * Hebrew literal guard (product code). See docs/SSOT/DECISIONS.md **D-24**.
 *
 * **Product policy (D-24, target architecture — not fully enforced here yet):**
 * - MVP is bilingual: Hebrew + English; user-facing copy lives in locale bundles
 *   (`apps/mobile/src/i18n/locales/he/`, `.../locales/en/`) via stable keys, not inline in TS/TSX.
 * - Migrations / PL/pgSQL / triggers must eventually use **indirection** (message keys + parameters,
 *   text resolved from the same locale SSOT or Edge `i18n.json`), not raw natural-language literals
 *   in SQL as the long-term pattern.
 *
 * **What this script does today:** scans text files for Hebrew codepoints; writes a Markdown report;
 * with `--check`, exits non-zero if any match remains **outside** the skip rules below. Hebrew inside
 * skipped trees is ignored so CI stays practical while D-24 refactors are phased in.
 *
 * **Skips (transitional / technical):**
 * - `docs/`, `PRD_V2_NOT_FOR_MVP/`, `app/apps/mobile/app.json` (Expo metadata).
 * - `app/apps/mobile/src/i18n/**` — canonical locale bundles (`he`, future `en`, etc.).
 * - `app/apps/mobile/web-server/i18n/**` — web-server locale bundles (Hono server has no React/i18next runtime).
 * - `supabase/migrations/**`, `supabase/seed.sql` — excluded until SQL adopts D-24 indirection.
 * - `supabase/tests/**` — DB regression tests: fixtures, like `__tests__/**`.
 * - `supabase/functions/**` — Edge bundles (including `i18n.json`).
 * - `__tests__/**`, `*.test.ts(x)`, `*.test.mjs`, `*.test.js` — fixtures.
 * - `tests/e2e/**` — Playwright E2E suite (Hebrew selectors against rendered UI; D-55).
 * - `app/apps/mobile/ios/**` + `.plist` suffix — native permission copy (to be aligned with D-24 / InfoPlist.strings).
 * - Repo-root `AGENTS.md` / `CLAUDE.md` — agent-facing Hebrew examples.
 * - `SKIP_HEBREW_SCAN_EXACT_RELS` — narrow ASCII-path exceptions until moved to locale-backed data.
 * - Anything gitignored (e.g. a local `expo prebuild` android/ tree): in a git checkout only files
 *   git sees are scanned — tracked plus new untracked ones. Outside git, the whole tree is walked.
 *
 * Usage:
 *   node scripts/extract-hebrew-text.mjs [outputPath]
 *   node scripts/extract-hebrew-text.mjs --check [outputPath]   # exit 1 if any violation remains
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const DEFAULT_OUT = path.join(REPO_ROOT, "scripts", "hebrew-text-report.md");

/**
 * Exact repo-relative POSIX paths skipped by the scan (ASCII paths only).
 * Transitional: remove entries as they are replaced by locale-backed or key-only sources (D-24).
 */
const SKIP_HEBREW_SCAN_EXACT_RELS = new Set([
  "app/packages/infrastructure-supabase/src/search/searchConstants.ts",
  // PWA manifest: the `name`/`short_name` are the localized installed-app label
  // (Hebrew is the MVP locale, R-MVP-Core-4). A static manifest.json cannot hold
  // i18next keys, so its localized name is canonical here, not an inline leak.
  "app/apps/mobile/public/manifest.json",
  // Public static legal pages (store privacy-policy / terms URLs). Served without
  // JS so store reviewers and signed-out visitors can read them; bilingual he+en.
  "app/apps/mobile/public/privacy.html",
  "app/apps/mobile/public/terms.html",
  "app/apps/mobile/public/support.html",
  "app/apps/mobile/public/delete-account.html",
  "app/apps/mobile/public/child-safety.html",
]);

function parseArgs(argv) {
  const user = argv.slice(2);
  const check = user.includes("--check");
  const rest = user.filter((a) => a !== "--check");
  const outArg = rest[0] || null;
  return { check, outArg };
}

const SKIP_DIR_NAMES = new Set([
  "node_modules",
  ".git",
  "Pods",
  "build",
  "dist",
  ".next",
  "coverage",
  ".turbo",
  ".expo",
  "DerivedData",
  ".gradle",
  "__pycache__",
  ".cache",
  "mcps",
]);

const SKIP_FILE_NAMES = new Set([".DS_Store", "package-lock.json", "yarn.lock"]);

const TEXT_EXT = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".md",
  ".mdx",
  ".sql",
  ".yml",
  ".yaml",
  ".toml",
  ".html",
  ".css",
  ".scss",
  ".txt",
  ".svg",
  ".xml",
  ".plist",
  ".gradle",
  ".properties",
  ".env.example",
]);

// Hebrew + Hebrew presentation forms + niqqud / punctuation in block
const HEBREW_RE = /[\u0590-\u05FF\uFB1D-\uFB4F]/;

function shouldSkipDir(name) {
  return SKIP_DIR_NAMES.has(name) || name.startsWith(".");
}

/** Whole subtrees excluded from the scan (repo-relative POSIX paths). See file header (D-24). */
function isSkippedContentTreeRel(relPosix) {
  if (relPosix === "docs" || relPosix.startsWith("docs/")) return true;
  if (relPosix === "PRD_V2_NOT_FOR_MVP" || relPosix.startsWith("PRD_V2_NOT_FOR_MVP/")) {
    return true;
  }
  if (relPosix === "supabase/migrations" || relPosix.startsWith("supabase/migrations/")) {
    return true;
  }
  if (relPosix === "supabase/seed.sql") return true;
  // DB regression tests (supabase/tests/**) are fixtures like __tests__/**, not UI copy.
  if (relPosix === "supabase/tests" || relPosix.startsWith("supabase/tests/")) return true;
  // Fake Hebrew test data for kc-dev (supabase/seed/kc-dev/**) – data, not UI copy.
  if (relPosix.startsWith("supabase/seed/")) return true;
  if (relPosix === "app/apps/mobile/src/i18n" || relPosix.startsWith("app/apps/mobile/src/i18n/")) {
    return true;
  }
  if (
    relPosix === "app/apps/mobile/web-server/i18n" ||
    relPosix.startsWith("app/apps/mobile/web-server/i18n/")
  ) {
    return true;
  }
  if (relPosix === "app/apps/mobile/app.json") return true;
  if (relPosix === "app/apps/mobile/locales" || relPosix.startsWith("app/apps/mobile/locales/")) {
    return true;
  }
  return false;
}

/** Per-path skips: tests, edge functions, native plist copy, agent doc, explicit path exceptions. */
export function isSkippedHebrewScanRel(relPosix) {
  if (isSkippedContentTreeRel(relPosix)) return true;
  if (SKIP_HEBREW_SCAN_EXACT_RELS.has(relPosix)) return true;
  if (relPosix === "CLAUDE.md" || relPosix === "AGENTS.md") return true;
  if (relPosix.includes("/__tests__/")) return true;
  if (
    relPosix.endsWith(".test.ts") ||
    relPosix.endsWith(".test.tsx") ||
    relPosix.endsWith(".test.mjs") ||
    relPosix.endsWith(".test.js") ||
    relPosix.endsWith(".test.cjs")
  ) {
    return true;
  }
  if (relPosix === "supabase/functions" || relPosix.startsWith("supabase/functions/")) return true;
  if (relPosix === "tests/e2e" || relPosix.startsWith("tests/e2e/")) return true;
  if (relPosix.startsWith("app/apps/mobile/ios/") && relPosix.endsWith(".plist")) return true;
  return false;
}

function isProbablyTextFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (TEXT_EXT.has(ext)) return true;
  const base = path.basename(filePath);
  if (base === "Dockerfile" || base.endsWith(".env.example")) return true;
  return false;
}

/**
 * Repo-relative paths git sees (tracked + untracked, minus gitignored) and every parent
 * directory of them, or null when `repoRoot` is not a git checkout.
 */
function gitVisiblePaths(repoRoot) {
  let out;
  try {
    out = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch {
    return null;
  }
  const visible = new Set();
  for (const file of out.split("\0").filter(Boolean)) {
    let p = file;
    while (p !== "." && !visible.has(p)) {
      visible.add(p);
      p = path.posix.dirname(p);
    }
  }
  return visible;
}

function* walk(dir, skipScanAbs, repoRoot, visible) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    const relPosix = path.relative(repoRoot, full).replace(/\\/g, "/");
    if (isSkippedHebrewScanRel(relPosix)) continue;
    if (visible && !visible.has(relPosix)) continue;
    if (ent.isDirectory()) {
      if (shouldSkipDir(ent.name)) continue;
      yield* walk(full, skipScanAbs, repoRoot, visible);
    } else if (ent.isFile()) {
      if (SKIP_FILE_NAMES.has(ent.name)) continue;
      const resolved = path.resolve(full);
      if (resolved === skipScanAbs) continue;
      if (!isProbablyTextFile(full)) continue;
      yield full;
    }
  }
}

function extractFromFile(absPath, repoRoot) {
  let content;
  try {
    content = fs.readFileSync(absPath, "utf8");
  } catch {
    return null;
  }
  const rel = path.relative(repoRoot, absPath);
  const hits = [];
  const lines = content.split(/\r?\n/);
  lines.forEach((line, idx) => {
    if (!HEBREW_RE.test(line)) return;
    hits.push({ line: idx + 1, text: line.trimEnd() });
  });
  return hits.length ? { rel, hits } : null;
}

/**
 * Scan entry point (testable): walk `repoRoot` and return the sorted list of
 * `{ rel, hits }` for every non-skipped text file that contains Hebrew codepoints.
 * `skipScanAbs` is an absolute path to omit from the walk (the report output file).
 */
export function collectHebrewViolations(repoRoot = REPO_ROOT, skipScanAbs = null) {
  const byFile = [];
  for (const abs of walk(repoRoot, skipScanAbs, repoRoot, gitVisiblePaths(repoRoot))) {
    const row = extractFromFile(abs, repoRoot);
    if (row) byFile.push(row);
  }
  byFile.sort((a, b) => a.rel.localeCompare(b.rel));
  return byFile;
}

function main() {
  const { check, outArg } = parseArgs(process.argv);
  const outPath = path.resolve(outArg || DEFAULT_OUT);
  const skipScanAbs = path.normalize(outPath);
  const byFile = collectHebrewViolations(REPO_ROOT, skipScanAbs);

  const iso = new Date().toISOString();
  let md = `# Hebrew text scan\nGenerated: ${iso}\nFiles: **${byFile.length}**\n`;
  byFile.forEach(({ rel, hits }) => {
    md += `## \`${rel.replace(/\\/g, "/")}\`\n`;
    for (const { line, text } of hits) {
      const oneLine = text.replace(/\t/g, " ");
      md += `${line}\t${oneLine}\n`;
    }
    md += "\n";
  });

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, md, "utf8");
  console.log(`Wrote ${byFile.length} files with Hebrew → ${outPath}`);

  if (check) {
    if (byFile.length > 0) {
      console.error(
        `Hebrew scan failed: ${byFile.length} file(s) outside allowed locations. See ${outPath}`,
      );
      for (const { rel } of byFile) console.error(`  - ${rel.replace(/\\/g, "/")}`);
      process.exitCode = 1;
    } else {
      console.log("Hebrew scan OK: 0 violations.");
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
