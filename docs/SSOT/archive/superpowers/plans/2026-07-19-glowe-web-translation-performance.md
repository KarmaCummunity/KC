# GLOWE Web Translation Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make GLOWE web UGC translation feel effectively instant with the least possible network and provider calls, and show a rare localized loading indicator only when a translation is genuinely cold.

**Architecture:** A per-field decision ladder in the client driver (same-language short-circuit → sessionStorage cache → batched DB read → batched Edge call), triggered by an IntersectionObserver lookahead instead of post-paint. The one backend change extends the existing `glowe-translate` Edge Function to a batch body that reads all source rows server-side and runs provider calls concurrently. A delayed, interface-language "Translating…" indicator covers the residual cold case.

**Tech Stack:** Plain browser JS (UMD modules, no bundler) for `app/apps/glowe-web`; vitest for JS unit tests; Deno + `@supabase/supabase-js` for Edge Functions; Supabase (`glowe_content_translations`, existing).

**Spec:** [`docs/SSOT/archive/superpowers/specs/2026-07-19-glowe-web-translation-performance-design.md`](../specs/2026-07-19-glowe-web-translation-performance-design.md) → new `FR-TRANSLATE-006`.

## Global Constraints

- **File size cap:** ≤ 300 lines per file; indentation ≤ 3 levels (`pnpm lint:arch`). Split when exceeded — this is why session-cache is its own file.
- **glowe-web is bundler-free:** modules use the UMD pattern (`module.exports` for tests, `window.X` for the browser). New browser globals load via `<script>` tags added to every HTML page that already includes `js/glowe-translate.js`.
- **Tests (JS):** `NODE_OPTIONS=--experimental-require-module pnpm --filter @kc/glowe-web test` (vitest; Node 20.17 needs the flag).
- **Tests (Edge):** `deno test <file>` from repo root.
- **No new migrations, no new tables** — reuse `glowe_content_translations`. **KC path untouched** (`translate`, `content_translations`, `get_post_translations`).
- **Names never translated.** Only the field allow-list in `SOURCE` is eligible.
- **English** in code, comments, commits, PRs; user-visible strings via `GLOWE_TRANSLATIONS`, never inline.
- **Version bump:** the PR(s) into `dev` bump `app/VERSION` PATCH (`node scripts/bump-app-version.mjs`) and update SSOT (`spec/18_translation.md` FR-TRANSLATE-006, `BACKLOG.md`).
- **Reader language:** `getGloweLanguage()` ∈ `{he, en}` (localStorage `gloweLang`, default `en`).

---

## Phase 1 — Client efficiency (no backend)

### Task 1: `sameLanguageSkip` pure helper (AC1)

**Files:**
- Modify: `app/apps/glowe-web/js/glowe-translate.js` (add helper + export in the factory return)
- Test: `app/apps/glowe-web/js/__tests__/glowe-translate.test.js`

**Interfaces:**
- Produces: `GloweTranslate.sameLanguageSkip(text: string, readerLang: string) -> boolean` — `true` when `text` is already in the reader's language and no translation/network is needed.

- [ ] **Step 1: Write the failing tests** — append to `glowe-translate.test.js`:

```js
describe('sameLanguageSkip', () => {
    it('he reader skips text containing Hebrew letters (incl. mixed)', () => {
        expect(GloweTranslate.sameLanguageSkip('שלום עולם', 'he')).toBe(true);
        expect(GloweTranslate.sameLanguageSkip('שלום world', 'he')).toBe(true);
    });
    it('he reader does NOT skip pure-Latin or other scripts', () => {
        expect(GloweTranslate.sameLanguageSkip('Hello world', 'he')).toBe(false);
        expect(GloweTranslate.sameLanguageSkip('Привет', 'he')).toBe(false);
    });
    it('en reader skips pure-Latin text only', () => {
        expect(GloweTranslate.sameLanguageSkip('Hello world', 'en')).toBe(true);
        expect(GloweTranslate.sameLanguageSkip('café 123!', 'en')).toBe(true);
    });
    it('en reader does NOT skip text with non-Latin letters', () => {
        expect(GloweTranslate.sameLanguageSkip('שלום', 'en')).toBe(false);
        expect(GloweTranslate.sameLanguageSkip('Hello שלום', 'en')).toBe(false);
    });
    it('never skips empty / whitespace text (let downstream short-circuit handle it)', () => {
        expect(GloweTranslate.sameLanguageSkip('', 'he')).toBe(false);
        expect(GloweTranslate.sameLanguageSkip('   ', 'en')).toBe(false);
    });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `NODE_OPTIONS=--experimental-require-module pnpm --filter @kc/glowe-web test`
Expected: FAIL — `GloweTranslate.sameLanguageSkip is not a function`.

- [ ] **Step 3: Implement** — in `glowe-translate.js`, inside the factory (before the `return {}`), add:

```js
    // Non-Latin letter blocks (Hebrew/Arabic/Cyrillic/Greek/CJK), mirroring
    // js/glowe-localized-name.js. Used to decide a field's script cheaply.
    const HEBREW = /[֐-׿]/;
    const NON_LATIN = /[֐-׿؀-ۿЀ-ӿͰ-Ͽ一-鿿]/;

    // True when `text` is already in the reader's language, so no network/
    // provider call is needed. Safe heuristic: he => has Hebrew letters;
    // en => no non-Latin letters. Ambiguous/empty falls through to false.
    function sameLanguageSkip(text, readerLang) {
        const t = String(text || '').trim();
        if (!t) return false;
        if (readerLang === 'he') return HEBREW.test(t);
        if (readerLang === 'en') return !NON_LATIN.test(t);
        return false;
    }
```

Then add `sameLanguageSkip: sameLanguageSkip,` to the object literal returned by the factory (next to `needsTranslation`).

- [ ] **Step 4: Run to verify pass**

Run: `NODE_OPTIONS=--experimental-require-module pnpm --filter @kc/glowe-web test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/apps/glowe-web/js/glowe-translate.js app/apps/glowe-web/js/__tests__/glowe-translate.test.js
git commit -m "feat(glowe): client-side same-language translation short-circuit (FR-TRANSLATE-006)"
```

---

### Task 2: Bounded sessionStorage cache (AC2)

**Files:**
- Create: `app/apps/glowe-web/js/glowe-session-cache.js`
- Create: `app/apps/glowe-web/js/__tests__/glowe-session-cache.test.js`
- Modify: every HTML page that includes `js/glowe-translate.js` — add `<script src="js/glowe-session-cache.js"></script>` (or the correct relative path) immediately **before** the `glowe-translate.js` tag.

**Interfaces:**
- Produces: `GloweSessionCache.key(type,id,field,target) -> string`
- Produces: `GloweSessionCache.create(storage, cap) -> { get(key), put(key, value), clear() }` — `value` is a string (translated text) or the sentinel `''` (resolved: no translation). `get` returns `undefined` on miss. Bounded to `cap` entries, oldest evicted.

- [ ] **Step 1: Write the failing tests** — `glowe-session-cache.test.js`:

```js
import { describe, it, expect } from 'vitest';
import GloweSessionCache from '../glowe-session-cache.js';

function fakeStorage() {
    const m = new Map();
    return {
        getItem: (k) => (m.has(k) ? m.get(k) : null),
        setItem: (k, v) => { m.set(k, String(v)); },
        removeItem: (k) => { m.delete(k); },
    };
}

describe('GloweSessionCache.key', () => {
    it('builds a stable composite key', () => {
        expect(GloweSessionCache.key('glowe_post', 'post-1', 'title', 'en'))
            .toBe('glowe_post|post-1|title|en');
    });
});

describe('GloweSessionCache.create', () => {
    it('round-trips values and misses on unknown keys', () => {
        const c = GloweSessionCache.create(fakeStorage(), 10);
        expect(c.get('a')).toBe(undefined);
        c.put('a', 'Hello');
        expect(c.get('a')).toBe('Hello');
    });
    it('stores the empty-string sentinel (resolved: no translation)', () => {
        const c = GloweSessionCache.create(fakeStorage(), 10);
        c.put('a', '');
        expect(c.get('a')).toBe('');
    });
    it('evicts the oldest entry past the cap', () => {
        const c = GloweSessionCache.create(fakeStorage(), 2);
        c.put('a', '1'); c.put('b', '2'); c.put('c', '3');
        expect(c.get('a')).toBe(undefined);
        expect(c.get('b')).toBe('2');
        expect(c.get('c')).toBe('3');
    });
    it('clear() empties the cache', () => {
        const c = GloweSessionCache.create(fakeStorage(), 10);
        c.put('a', '1'); c.clear();
        expect(c.get('a')).toBe(undefined);
    });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `NODE_OPTIONS=--experimental-require-module pnpm --filter @kc/glowe-web test`
Expected: FAIL — cannot find `../glowe-session-cache.js`.

- [ ] **Step 3: Implement** — `glowe-session-cache.js`:

```js
// GloWe translation session cache (FR-TRANSLATE-006).
// A bounded key->string store over a Storage-like object (sessionStorage in the
// browser, a fake in tests). Persists resolved translations AND same-language
// decisions (empty-string sentinel) so re-renders and cross-page navigation on
// this multi-page static site cost zero network. Order index lives in one key.
(function (root, factory) {
    const api = factory();
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    root.GloweSessionCache = api;
})(typeof self !== 'undefined' ? self : this, function () {
    const PREFIX = 'gtr:';        // per-entry key prefix
    const INDEX = 'gtr:index';    // ordered list of entry keys (oldest first)

    function key(type, id, field, target) {
        return type + '|' + id + '|' + field + '|' + target;
    }

    function readIndex(storage) {
        try { return JSON.parse(storage.getItem(INDEX) || '[]'); } catch (_e) { return []; }
    }
    function writeIndex(storage, list) {
        try { storage.setItem(INDEX, JSON.stringify(list)); } catch (_e) { /* quota: ignore */ }
    }

    function create(storage, cap) {
        const limit = cap > 0 ? cap : 500;
        return {
            get(k) {
                const v = storage.getItem(PREFIX + k);
                return v === null ? undefined : v;
            },
            put(k, value) {
                try {
                    if (storage.getItem(PREFIX + k) === null) {
                        const list = readIndex(storage);
                        list.push(k);
                        while (list.length > limit) storage.removeItem(PREFIX + list.shift());
                        writeIndex(storage, list);
                    }
                    storage.setItem(PREFIX + k, String(value));
                } catch (_e) { /* quota / private-mode: degrade to no-op */ }
            },
            clear() {
                readIndex(storage).forEach((k) => storage.removeItem(PREFIX + k));
                writeIndex(storage, []);
            },
        };
    }

    return { key: key, create: create };
});
```

- [ ] **Step 4: Run to verify pass**

Run: `NODE_OPTIONS=--experimental-require-module pnpm --filter @kc/glowe-web test`
Expected: PASS.

- [ ] **Step 5: Add the script tag to pages** — for each HTML file that includes `glowe-translate.js`, add the session-cache script immediately before it. Find them:

```bash
grep -rl 'glowe-translate.js' app/apps/glowe-web --include='*.html'
```

For each, insert (matching that file's relative path prefix, e.g. `js/` or `../js/`):

```html
<script src="js/glowe-session-cache.js"></script>
```

- [ ] **Step 6: Commit**

```bash
git add app/apps/glowe-web/js/glowe-session-cache.js app/apps/glowe-web/js/__tests__/glowe-session-cache.test.js app/apps/glowe-web/index.html app/apps/glowe-web/pages/*.html
git commit -m "feat(glowe): bounded sessionStorage cache for translations (FR-TRANSLATE-006)"
```

---

### Task 3: `mapLimit` + concurrent miss path (AC5)

**Files:**
- Modify: `app/apps/glowe-web/js/glowe-translate.js` (add `mapLimit` helper + export; use it in `scan`)
- Test: `app/apps/glowe-web/js/__tests__/glowe-translate.test.js`

**Interfaces:**
- Produces: `GloweTranslate.mapLimit(items: any[], limit: number, fn: (item)=>Promise<any>) -> Promise<any[]>` — resolves `fn` over `items` with at most `limit` concurrent, preserving input order in the result.

- [ ] **Step 1: Write the failing test** — append to `glowe-translate.test.js`:

```js
describe('mapLimit', () => {
    it('preserves order and caps concurrency', async () => {
        let active = 0, peak = 0;
        const fn = (n) => new Promise((res) => {
            active++; peak = Math.max(peak, active);
            setTimeout(() => { active--; res(n * 2); }, 5);
        });
        const out = await GloweTranslate.mapLimit([1, 2, 3, 4, 5], 2, fn);
        expect(out).toEqual([2, 4, 6, 8, 10]);
        expect(peak).toBeLessThanOrEqual(2);
    });
    it('handles an empty list', async () => {
        expect(await GloweTranslate.mapLimit([], 3, async () => 1)).toEqual([]);
    });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `NODE_OPTIONS=--experimental-require-module pnpm --filter @kc/glowe-web test`
Expected: FAIL — `mapLimit is not a function`.

- [ ] **Step 3: Implement** — add to the factory in `glowe-translate.js` and export it:

```js
    // Resolve fn over items with bounded concurrency, preserving order.
    async function mapLimit(items, limit, fn) {
        const out = new Array(items.length);
        let next = 0;
        const n = Math.max(1, Math.min(limit, items.length));
        async function worker() {
            while (next < items.length) {
                const i = next++;
                out[i] = await fn(items[i], i);
            }
        }
        const workers = [];
        for (let w = 0; w < n; w++) workers.push(worker());
        await Promise.all(workers);
        return out;
    }
```

- [ ] **Step 4: Run to verify pass**

Run: `NODE_OPTIONS=--experimental-require-module pnpm --filter @kc/glowe-web test`
Expected: PASS.

- [ ] **Step 5: Wire the driver to resolve concurrently** — in the browser driver's `scan()`, replace the sequential `for (const e of entries) await processCard(...)` with a concurrent pass, and short-circuit + session-cache each field inside `resolveField`. Update `resolveField` to consult, in order: `sameLanguageSkip` → session cache → `cacheMap` → `translateMiss`, writing resolutions back to the session cache. (Detailed driver rewrite for the batch call lands in Task 7; here only the concurrency + ladder wiring changes.)

Concretely, change the tail of `scan()` to:

```js
        entries.forEach(function (e) { e.card.setAttribute('data-tr-done', '1'); });
        const ids = Array.from(new Set(entries.map(function (e) { return e.id; })));
        const cacheMap = await readCache(sb, ids, target);
        await T.mapLimit(entries, 6, function (e) { return processCard(sb, e, target, cacheMap); });
```

and make `processCard` resolve its fields concurrently too:

```js
        async function processCard(sb, entry, target, cacheMap) {
            const applied = await T.mapLimit(entry.fields, 6, async function (f) {
                const source = (f.el.textContent || '').trim();
                const norm = await resolveField(sb, entry, f, target, cacheMap);
                return norm && T.needsTranslation(norm.sourceLanguage, target)
                    && applyTranslation(f.el, source, norm.translated);
            });
            if (applied.some(Boolean)) injectToggle(entry.card, target);
        }
```

- [ ] **Step 6: Browser-verify on dev** (per repo practice)

Load a cold cross-language feed; confirm cards translate roughly together (not one-by-one over ~30s) and `data-tr-done` is set once. Use the Browser pane: `read_network_requests` filtered to `glowe-translate` should show the calls firing concurrently, not serialized.

- [ ] **Step 7: Commit**

```bash
git add app/apps/glowe-web/js/glowe-translate.js app/apps/glowe-web/js/__tests__/glowe-translate.test.js
git commit -m "feat(glowe): resolve translation misses concurrently (FR-TRANSLATE-006)"
```

---

## Phase 2 — Batched translation (backend)

### Task 4: `translateMany` shared helper (AC4, AC10)

**Files:**
- Create: `supabase/functions/_shared/translation/batch.ts`
- Create: `supabase/functions/_shared/translation/batch.test.ts`

**Interfaces:**
- Produces: `translateMany(provider: TranslationProvider, inputs: ProviderInput[], concurrency: number) -> Promise<(ProviderResult | null)[]>` — order-preserving; a per-item provider failure yields `null` at that index (never throws).

- [ ] **Step 1: Write the failing test** — `batch.test.ts`:

```ts
import { assertEquals } from 'jsr:@std/assert@1';
import { translateMany } from './batch.ts';
import type { ProviderInput, ProviderResult, TranslationProvider } from './provider.ts';

class FakeProvider implements TranslationProvider {
  active = 0; peak = 0;
  translate(input: ProviderInput): Promise<ProviderResult> {
    this.active++; this.peak = Math.max(this.peak, this.active);
    return new Promise((res, rej) => setTimeout(() => {
      this.active--;
      if (input.text === 'BOOM') { rej(new Error('x')); return; }
      res({ translatedText: input.text.toUpperCase(), detectedSourceLanguage: 'he', confidence: null, model: 'fake' });
    }, 5));
  }
}

Deno.test('translateMany preserves order and caps concurrency', async () => {
  const p = new FakeProvider();
  const inputs = ['a', 'b', 'c', 'd'].map((t) => ({ text: t, targetLanguage: 'en' }));
  const out = await translateMany(p, inputs, 2);
  assertEquals(out.map((r) => r?.translatedText), ['A', 'B', 'C', 'D']);
  assertEquals(p.peak <= 2, true);
});

Deno.test('translateMany yields null for a failing item', async () => {
  const p = new FakeProvider();
  const inputs = [{ text: 'ok', targetLanguage: 'en' }, { text: 'BOOM', targetLanguage: 'en' }];
  const out = await translateMany(p, inputs, 2);
  assertEquals(out[0]?.translatedText, 'OK');
  assertEquals(out[1], null);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `deno test supabase/functions/_shared/translation/batch.test.ts`
Expected: FAIL — cannot find `./batch.ts`.

- [ ] **Step 3: Implement** — `batch.ts`:

```ts
// supabase/functions/_shared/translation/batch.ts
// Order-preserving, bounded-concurrency fan-out over a TranslationProvider.
// The default GoogleFreeProvider translates one string per request, so a batch
// of N misses becomes N concurrent provider calls behind ONE Edge round-trip.
// A per-item failure resolves to null (caller renders source) — never throws.
import type { ProviderInput, ProviderResult, TranslationProvider } from './provider.ts';

export async function translateMany(
  provider: TranslationProvider,
  inputs: ProviderInput[],
  concurrency: number,
): Promise<(ProviderResult | null)[]> {
  const out = new Array<ProviderResult | null>(inputs.length).fill(null);
  let next = 0;
  const workers: Promise<void>[] = [];
  const n = Math.max(1, Math.min(concurrency, inputs.length));
  const worker = async () => {
    while (next < inputs.length) {
      const i = next++;
      try { out[i] = await provider.translate(inputs[i]); }
      catch { out[i] = null; }
    }
  };
  for (let w = 0; w < n; w++) workers.push(worker());
  await Promise.all(workers);
  return out;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `deno test supabase/functions/_shared/translation/batch.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/translation/batch.ts supabase/functions/_shared/translation/batch.test.ts
git commit -m "feat(translation): bounded-concurrency translateMany helper (FR-TRANSLATE-006)"
```

---

### Task 5: Extract GLOWE source registry (AC10, duplication gate)

**Files:**
- Create: `supabase/functions/_shared/translation/gloweSource.ts`
- Create: `supabase/functions/_shared/translation/gloweSource.test.ts`
- Modify: `supabase/functions/glowe-translate/index.ts` (import `SOURCE` + `resolveField` from the shared module; delete the local copies)

**Interfaces:**
- Produces: `SOURCE: Record<string, SourceEntry>`, `resolveField(src, field) -> { column, index } | null`, `type SourceEntry`. Moved verbatim from `glowe-translate/index.ts` (lines 31–84).

- [ ] **Step 1: Write the failing test** — `gloweSource.test.ts`:

```ts
import { assertEquals } from 'jsr:@std/assert@1';
import { SOURCE, resolveField } from './gloweSource.ts';

Deno.test('resolveField maps scalar and array-element fields', () => {
  assertEquals(resolveField(SOURCE.glowe_post, 'title'), { column: 'title', index: null });
  assertEquals(resolveField(SOURCE.glowe_opportunity, 'requirements.2'), { column: 'requirements', index: 2 });
});

Deno.test('resolveField rejects unknown / non-array-index fields', () => {
  assertEquals(resolveField(SOURCE.glowe_post, 'author_name'), null);
  assertEquals(resolveField(SOURCE.glowe_post, 'title.0'), null); // title is not an arrayField
});
```

- [ ] **Step 2: Run to verify failure**

Run: `deno test supabase/functions/_shared/translation/gloweSource.test.ts`
Expected: FAIL — cannot find `./gloweSource.ts`.

- [ ] **Step 3: Implement** — create `gloweSource.ts` with the `SourceEntry` interface, the `SOURCE` constant, and `resolveField` moved verbatim from `glowe-translate/index.ts:31-84`, each `export`ed. Then in `index.ts` replace those lines with:

```ts
import { SOURCE, resolveField, type SourceEntry } from '../_shared/translation/gloweSource.ts';
```

(Remove the now-duplicated `SourceEntry`, `SOURCE`, and `resolveField` definitions from `index.ts`.)

- [ ] **Step 4: Run to verify pass + type-check the function**

Run: `deno test supabase/functions/_shared/translation/gloweSource.test.ts`
Run: `deno check supabase/functions/glowe-translate/index.ts`
Expected: tests PASS; `deno check` clean.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/translation/gloweSource.ts supabase/functions/_shared/translation/gloweSource.test.ts supabase/functions/glowe-translate/index.ts
git commit -m "refactor(translation): extract GLOWE source registry to _shared (FR-TRANSLATE-006)"
```

---

### Task 6: Batch body in `glowe-translate` Edge Function (AC4)

**Files:**
- Modify: `supabase/functions/glowe-translate/index.ts`

**Interfaces:**
- Consumes: `SOURCE`, `resolveField` (Task 5); `translateMany` (Task 4); `getCached`, `putIfAbsent`, `CacheKey`, `CacheRow` (`./cache.ts`); `isTranslatable`, `needsTranslation`, `isSupportedTarget`, `selectProvider`.
- Produces: request accepts legacy `{contentType,contentId,field,targetLanguage}` **or** batch `{targetLanguage, items:[{contentType,contentId,field}]}`; response `{ results: [{ contentType, contentId, field, status, translation? }] }`. Legacy single-item request still also returns its existing `{status, translation?}` shape for backward compatibility.

- [ ] **Step 1: Add a `resolveOne` unit that returns a result for one item** — extract the current per-request logic (source-row read → short-circuit → cache → provider → upsert) into an async function `resolveOne(svc, provider, item, targetLanguage): Promise<Result>` where `Result = { contentType, contentId, field, status: 'translated'|'cached'|'skipped', translation?: CacheRow }`. Reuse the existing body of the handler (lines ~133–200) verbatim inside it, returning the `Result` object instead of `Response`.

- [ ] **Step 2: Normalize the request to an item list** — after `isSupportedTarget`, build:

```ts
type Item = { contentType: string; contentId: string; field: string };
function toItems(body: Record<string, unknown>): { targetLanguage: string; items: Item[] } | null {
  const target = body.targetLanguage;
  if (typeof target !== 'string' || !target) return null;
  if (Array.isArray(body.items)) {
    const items = body.items.filter((it): it is Item =>
      !!it && typeof it === 'object'
      && typeof (it as Item).contentType === 'string'
      && typeof (it as Item).contentId === 'string'
      && typeof (it as Item).field === 'string');
    return { targetLanguage: target, items };
  }
  if (typeof body.contentType === 'string' && typeof body.contentId === 'string' && typeof body.field === 'string') {
    return { targetLanguage: target, items: [{ contentType: body.contentType, contentId: body.contentId, field: body.field }] };
  }
  return null;
}
```

- [ ] **Step 3: Validate + resolve the batch** — replace the single-item tail of the handler with:

```ts
  const parsed = toItems(raw as Record<string, unknown>);
  if (!parsed || parsed.items.length === 0) return json({ error: 'invalid_body' }, 400, hdrs);
  if (!isSupportedTarget(parsed.targetLanguage)) return json({ error: 'unsupported_language' }, 400, hdrs);

  // Drop items whose (contentType, field) is not in the allow-list — non-fatal.
  const valid = parsed.items.filter((it) => {
    const src = SOURCE[it.contentType];
    return src && resolveField(src, it.field);
  });

  const svc = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const provider = selectProvider();
  const results = await Promise.all(
    valid.map((it) => resolveOne(svc, provider, it, parsed.targetLanguage)),
  );

  // Legacy single-item body keeps its original response shape.
  const isLegacy = !Array.isArray((raw as Record<string, unknown>).items);
  if (isLegacy) {
    const r = results[0];
    return json(r ? { status: r.status, translation: r.translation } : { status: 'skipped' }, 200, hdrs);
  }
  return json({ results }, 200, hdrs);
```

Note: `resolveOne`'s provider call already runs inside `Promise.all`, giving the concurrent fan-out (AC4). For very large batches, cap fan-out by wrapping the provider step with `translateMany` in a follow-up; the initial cap is enforced client-side (Task 7 sends ≤ 24 items/request).

- [ ] **Step 4: Type-check**

Run: `deno check supabase/functions/glowe-translate/index.ts`
Expected: clean.

- [ ] **Step 5: Deploy to dev + contract-verify**

Deploy the function to dev (Supabase MCP `deploy_edge_function` or `supabase functions deploy glowe-translate`). Then verify both shapes with the dev anon key:

```bash
# batch shape
curl -s -X POST "$SUPABASE_URL/functions/v1/glowe-translate" \
  -H "Authorization: Bearer $ANON_KEY" -H 'Content-Type: application/json' \
  -d '{"targetLanguage":"en","items":[{"contentType":"glowe_post","contentId":"<real-hebrew-post-id>","field":"title"}]}'
# expect: {"results":[{"contentType":"glowe_post",...,"status":"translated"|"cached","translation":{...}}]}

# legacy shape still works
curl -s -X POST "$SUPABASE_URL/functions/v1/glowe-translate" \
  -H "Authorization: Bearer $ANON_KEY" -H 'Content-Type: application/json' \
  -d '{"contentType":"glowe_post","contentId":"<real-hebrew-post-id>","field":"title","targetLanguage":"en"}'
# expect: {"status":"translated"|"cached","translation":{...}}
```

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/glowe-translate/index.ts
git commit -m "feat(glowe): accept batch body in glowe-translate edge function (FR-TRANSLATE-006)"
```

---

### Task 7: Client sends one batched request per window (AC4)

**Files:**
- Modify: `app/apps/glowe-web/js/glowe-translate.js` (driver: replace per-field `translateMiss` with a single batched invoke)

**Interfaces:**
- Consumes: batch endpoint from Task 6.
- Produces: after cache read, all genuine misses in a scan are collected and sent as one `functions.invoke('glowe-translate', { body: { targetLanguage, items } })`; results are mapped back by `(contentType|contentId|field)`.

- [ ] **Step 1: Collect misses instead of firing per field** — in `scan()`, after `readCache`, build the miss list by walking entries/fields and applying the ladder (`sameLanguageSkip` → session cache → `cacheMap`). Only fields that fall through become `items`. Send once:

```js
        const missItems = [];              // {entry, f, item}
        entries.forEach(function (e) {
            e.fields.forEach(function (f) {
                const source = (f.el.textContent || '').trim();
                if (!source || T.sameLanguageSkip(source, target)) return;
                const ck = sessionKey(e, f, target);
                const cached = SC ? SC.get(ck) : undefined;
                if (cached !== undefined) { f._pre = cached; return; }
                if (cacheMap[T.cacheMapKey(e.type, e.id, f.field)]) return; // handled by DB path
                missItems.push({ entry: e, f: f, item: { contentType: e.type, contentId: e.id, field: f.field } });
            });
        });
        let resultMap = {};
        if (missItems.length) {
            resultMap = await batchTranslate(sb, missItems.map(function (m) { return m.item; }), target);
        }
```

where `sessionKey(e,f,target) = window.GloweSessionCache.key(e.type, e.id, f.field, target)` and `SC` is a module-level cache created once via `window.GloweSessionCache.create(window.sessionStorage, 500)`.

- [ ] **Step 2: Implement `batchTranslate`** — add to the driver:

```js
        // POST all misses in one call; map results by (type|id|field). Chunks to
        // <=24 items/request to bound server fan-out. Failures degrade to source.
        async function batchTranslate(sb, items, target) {
            const map = {};
            for (let i = 0; i < items.length; i += 24) {
                const chunk = items.slice(i, i + 24);
                try {
                    const { data, error } = await sb.functions.invoke('glowe-translate', {
                        body: { targetLanguage: target, items: chunk },
                    });
                    if (error || !data || !Array.isArray(data.results)) continue;
                    data.results.forEach(function (r) {
                        const k = r.contentType + '|' + r.contentId + '|' + r.field;
                        map[k] = (r.status !== 'skipped') ? T.normalizeTranslation(r.translation) : null;
                        if (!map[k]) skip.add(T.tupleKey(r.contentType, r.contentId, r.field, target));
                    });
                } catch (_e) { /* leave source text in place */ }
            }
            return map;
        }
```

- [ ] **Step 3: Apply results + persist to session cache** — replace `processCard`/`resolveField` application so each field uses, in order: `f._pre` (session-cache hit) → `cacheMap` DB hit → `resultMap[type|id|field]`. On any applied translation, `SC.put(sessionKey, translated)`; on a resolved same-language/skip, `SC.put(sessionKey, '')`. Inject the toggle when any field applied.

- [ ] **Step 4: Clear session cache on language switch** — in `app.js` `setGloweLanguage(...)` (find it after `localStorage.setItem(GLOWE_LANG_KEY, lang)`), add:

```js
    if (window.GloweSessionCache && window.sessionStorage) {
        window.GloweSessionCache.create(window.sessionStorage, 500).clear();
    }
```

- [ ] **Step 5: Browser-verify on dev**

- Hebrew reader + Hebrew feed: `read_network_requests` filtered to `glowe-translate` shows **zero** calls.
- English reader + Hebrew feed (cold): exactly **one** `glowe-translate` request per ≤24-item window; text swaps in ~1–3s.
- Navigate away and back: second visit fires **zero** calls (session cache).

- [ ] **Step 6: Commit**

```bash
git add app/apps/glowe-web/js/glowe-translate.js app/apps/glowe-web/js/app.js
git commit -m "feat(glowe): batch translation requests + session-cache application (FR-TRANSLATE-006)"
```

---

## Phase 3 — Viewport prefetch

### Task 8: IntersectionObserver lookahead + rAF flush (AC6, AC7)

**Files:**
- Modify: `app/apps/glowe-web/js/glowe-translate.js` (driver trigger)

**Interfaces:**
- Produces: discovery registers each new `[data-tr-card]:not([data-tr-registered])` with an `IntersectionObserver({ rootMargin: '800px 0px' })`; on intersect, the card is unobserved, marked `data-tr-done`, and pushed to a pending set flushed on `requestAnimationFrame` into the existing batched resolve (`readCache` + `batchTranslate`). `GloweTranslate.scan()` keeps working (it registers rather than translates).

- [ ] **Step 1: Replace the immediate-translate boot with register+observe** — refactor `scan()` into `register(root)` (collect cards, `setAttribute('data-tr-registered','1')`, `io.observe(card)`) and a separate `flush()` that runs the existing collect→readCache→batchTranslate→apply pipeline over the **pending** (intersected) cards only. Keep the MutationObserver but point it at `register`. Keep `window.GloweTranslate.scan = register` for existing callers.

```js
        const pending = new Set();
        let rafId = 0;
        const io = ('IntersectionObserver' in window)
            ? new IntersectionObserver(function (entries) {
                let any = false;
                entries.forEach(function (en) {
                    if (!en.isIntersecting) return;
                    io.unobserve(en.target);
                    pending.add(en.target); any = true;
                });
                if (any) scheduleFlush();
            }, { rootMargin: '800px 0px' })
            : null;

        function scheduleFlush() {
            if (rafId) return;
            rafId = requestAnimationFrame(function () { rafId = 0; flush(); });
        }
```

- [ ] **Step 2: `register` + no-IO fallback** — if `io` is null (old browsers), `register` falls back to adding cards straight to `pending` + `scheduleFlush()` (current always-translate behavior). Otherwise it observes.

- [ ] **Step 3: `flush` over the settled window** — `flush()` drains `pending` into an array, runs `collectCards` semantics on those cards, then the Task-7 pipeline (mark `data-tr-done`, `readCache`, ladder, `batchTranslate`, apply). No 150ms debounce anywhere on the translate path.

- [ ] **Step 4: Browser-verify on dev**

- Load a long cold feed: `read_network_requests` shows translation requests for the **top** cards immediately, and more firing as you scroll — before each card reaches the viewport (lookahead). Off-screen-and-never-scrolled cards fire **no** request.

- [ ] **Step 5: Commit**

```bash
git add app/apps/glowe-web/js/glowe-translate.js
git commit -m "feat(glowe): viewport-lookahead prefetch for translations (FR-TRANSLATE-006)"
```

---

## Phase 4 — Loading indicator

### Task 9: Delayed, localized "Translating…" (AC8)

**Files:**
- Modify: `app/apps/glowe-web/js/app.js` (`GLOWE_TRANSLATIONS.he`)
- Modify: `app/apps/glowe-web/css/styles.css` (`.tr-pending`)
- Modify: `app/apps/glowe-web/js/glowe-translate.js` (show/hide indicator around the batch call)

**Interfaces:**
- Consumes: `translateGloweTree` (localizes the injected English label), the reserved `.tr-slot`.
- Produces: a `.tr-pending` element rendered into a card's `.tr-slot` iff a translation for that card is still in flight 400ms after the batch call started; removed on resolve.

- [ ] **Step 1: Add the localized label** — in `app.js`, add to `GLOWE_TRANSLATIONS.he` (next to `'Show original'`):

```js
        'Translating…': 'מתרגם…',
```

- [ ] **Step 2: Add CSS** — in `styles.css`, near `.tr-toggle`:

```css
.tr-pending {
    display: block;
    font-size: 0.85em;
    opacity: 0.6;
    font-style: italic;
    margin-top: 4px;
}
```

- [ ] **Step 3: Show/hide around the batch** — in the driver, when a card has ≥1 miss going into `batchTranslate`, start a 400ms timer that appends `<span class="tr-pending">Translating…</span>` (then `localizeLabel(span)` = `translateGloweTree(span)`) into the card's `.tr-slot`; clear the timer and remove the span when the card's fields resolve (translation applied or all skipped). Source text stays in place throughout (no layout shift — the indicator is a separate block in the slot).

```js
        function startPending(card) {
            const slot = card.querySelector(':scope > .tr-slot, .tr-slot');
            if (!slot || slot.closest('[data-tr-card]') !== card) return null;
            const timer = setTimeout(function () {
                if (slot.querySelector('.tr-pending')) return;
                const span = document.createElement('span');
                span.className = 'tr-pending';
                span.textContent = 'Translating…'; // localized to interface lang below
                slot.appendChild(span);
                localizeLabel(span);
            }, 400);
            return function stop() {
                clearTimeout(timer);
                const el = slot.querySelector('.tr-pending');
                if (el) el.remove();
            };
        }
```

Call `const stop = startPending(entry.card)` before awaiting the card's resolution, and `stop && stop()` in a `finally`.

- [ ] **Step 4: Browser-verify on dev** (light + dark, RTL)

- Force a cold miss (clear the row from `glowe_content_translations` for one post, or throttle the network): the "מתרגם…"/"Translating…" line appears after ~0.4s under the header, in the **interface** language, then disappears when text swaps. Source text does not move (no scroll shift). Warm/same-language reload: indicator never appears.

- [ ] **Step 5: Commit**

```bash
git add app/apps/glowe-web/js/app.js app/apps/glowe-web/css/styles.css app/apps/glowe-web/js/glowe-translate.js
git commit -m "feat(glowe): delayed localized translating indicator (FR-TRANSLATE-006)"
```

---

## Task 10: SSOT + version bump (ships with the PR)

**Files:**
- Modify: `docs/SSOT/spec/18_translation.md` (mark FR-TRANSLATE-006 status), `docs/SSOT/BACKLOG.md` (flip status)
- Modify: `app/VERSION` + `app/apps/glowe-web/js/glowe-version.js` (PATCH bump)

- [ ] **Step 1: Add FR-TRANSLATE-006** to `spec/18_translation.md` with the AC list from the design doc §6, status `🟡 In progress` → `✅ Done` when the phases land.
- [ ] **Step 2: BACKLOG** — add/flip the FR-TRANSLATE-006 row.
- [ ] **Step 3: Version bump**

Run: `node scripts/bump-app-version.mjs`
Expected: `app/VERSION` and `glowe-version.js` PATCH incremented together.

- [ ] **Step 4: Pre-push gates**

```bash
cd app && pnpm typecheck && pnpm test && pnpm lint
```
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add docs/SSOT/spec/18_translation.md docs/SSOT/BACKLOG.md app/VERSION app/apps/glowe-web/js/glowe-version.js
git commit -m "docs(ssot): record FR-TRANSLATE-006 + bump app version"
```

---

## Self-review notes

- **Spec coverage:** AC1→T1, AC2→T2, AC3 (preserved, no task needed — `readCache` untouched), AC4→T4/T6/T7, AC5→T3, AC6→T8, AC7→T8, AC8→T9, AC9 (covered by T7 skip-map + T8 viewport scope + degrade-to-source throughout), AC10→T4/T5.
- **Phasing:** Phases 1 (T1–T3) and 4 (T9) ship value with no backend; Phase 2 (T4–T7) needs the Edge deploy; Phase 3 (T8) is the trigger rewrite. Each phase can be its own PR (each bumps PATCH + updates SSOT via Task 10's steps).
- **Type consistency:** `sameLanguageSkip`, `mapLimit`, `GloweSessionCache.key/create`, `translateMany`, `resolveOne`, `toItems`, `batchTranslate`, `startPending` names are used consistently across tasks.
