import { test } from "node:test";
import assert from "node:assert/strict";
import { loadRegistry, toMetaPayload } from "./whatsapp-templates.mjs";

const reg = loadRegistry();

test("Meta payload carries name, language, category and body examples", () => {
  const t = reg.templates.find((x) => x.name === "match_found_v1");
  const p = toMetaPayload(t, "en");
  assert.equal(p.name, "match_found_v1");
  assert.equal(p.language, "en");
  assert.equal(p.category, "UTILITY");
  assert.deepEqual(p.components[0].example, { body_text: [t.languages.en.examples] });
});

test("templates without params send no example block", () => {
  const t = reg.templates.find((x) => x.params.length === 0);
  assert.equal(toMetaPayload(t, "he").components[0].example, undefined);
});
