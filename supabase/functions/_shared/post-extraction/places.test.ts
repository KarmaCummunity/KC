import { assertEquals } from 'jsr:@std/assert@1';
import { decidePlace, resolveRidePlace, type PlaceCandidate, type PlaceResolver } from './places.ts';

const cand = (level: PlaceCandidate['level'], id: string, score: number, margin = 0): PlaceCandidate => ({
  level, placeId: id, nameHe: `n${id}`, cityId: null, score, margin,
});

Deno.test('a clear city match above the floor is picked', () => {
  const r = decidePlace('city', [cand('city', 'a', 0.9), cand('city', 'b', 0.6)]);
  assertEquals(r.status, 'picked');
  assertEquals(r.picked?.placeId, 'a');
});

Deno.test('a match below the floor is suggested, not picked', () => {
  const r = decidePlace('city', [cand('city', 'a', 0.8)]);
  assertEquals(r.status, 'suggest');
  assertEquals(r.suggestions.map((c) => c.placeId), ['a']);
});

Deno.test('two close matches are suggested together (margin under 0.10)', () => {
  const r = decidePlace('city', [cand('city', 'a', 0.95), cand('city', 'b', 0.9)]);
  assertEquals(r.status, 'suggest');
  assertEquals(r.suggestions.length, 2);
});

Deno.test('a lead of exactly 0.10 is enough', () => {
  assertEquals(decidePlace('street', [cand('street', 'a', 1), cand('street', 'b', 0.9)]).status, 'picked');
});

Deno.test('at most three suggestions, best first', () => {
  const r = decidePlace('city', [0.7, 0.6, 0.65, 0.55].map((s, i) => cand('city', String(i), s)));
  assertEquals(r.suggestions.map((c) => c.score), [0.7, 0.65, 0.6]);
});

Deno.test('no candidates means none, and the street floor is lower than the city floor', () => {
  assertEquals(decidePlace('city', []).status, 'none');
  assertEquals(decidePlace('street', [cand('street', 'a', 0.82)]).status, 'picked');
  assertEquals(decidePlace('city', [cand('city', 'a', 0.82)]).status, 'suggest');
});

Deno.test('other levels in the list are ignored', () => {
  assertEquals(decidePlace('city', [cand('junction', 'j', 1)]).status, 'none');
});

Deno.test('a ride place ranks cities and junctions together and recomputes the margin', async () => {
  const resolve: PlaceResolver = (level) =>
    Promise.resolve(level === 'city' ? [cand('city', 'c', 0.9, 0.9)] : [cand('junction', 'j', 0.85, 0.85)]);
  const r = await resolveRidePlace(resolve, 'x');
  assertEquals(r.status, 'suggest'); // 0.90 vs 0.85: margin 0.05
  assertEquals(r.suggestions.map((c) => c.placeId), ['c', 'j']);
});

Deno.test('a ride place with no text is none and asks nothing of the catalog', async () => {
  let calls = 0;
  const r = await resolveRidePlace(() => {
    calls++;
    return Promise.resolve([]);
  }, null);
  assertEquals(r.status, 'none');
  assertEquals(calls, 0);
});
