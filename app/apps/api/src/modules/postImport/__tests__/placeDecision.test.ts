import { expect, it } from 'vitest';
import { decidePlace, type PlaceCandidate, type PlaceResolver, resolveRidePlace } from '../placeDecision';

const cand = (level: PlaceCandidate['level'], id: string, score: number, margin = 0): PlaceCandidate => ({
  level, placeId: id, nameHe: `n${id}`, cityId: null, score, margin,
});

it('a clear city match above the floor is picked', () => {
  const r = decidePlace('city', [cand('city', 'a', 0.9), cand('city', 'b', 0.6)]);
  expect(r.status).toEqual('picked');
  expect(r.picked?.placeId).toEqual('a');
});

it('a match below the floor is suggested, not picked', () => {
  const r = decidePlace('city', [cand('city', 'a', 0.8)]);
  expect(r.status).toEqual('suggest');
  expect(r.suggestions.map((c) => c.placeId)).toEqual(['a']);
});

it('two close matches are suggested together (margin under 0.10)', () => {
  const r = decidePlace('city', [cand('city', 'a', 0.95), cand('city', 'b', 0.9)]);
  expect(r.status).toEqual('suggest');
  expect(r.suggestions.length).toEqual(2);
});

it('a lead of exactly 0.10 is enough', () => {
  expect(decidePlace('street', [cand('street', 'a', 1), cand('street', 'b', 0.9)]).status).toEqual('picked');
});

it('at most three suggestions, best first', () => {
  const r = decidePlace('city', [0.7, 0.6, 0.65, 0.55].map((s, i) => cand('city', String(i), s)));
  expect(r.suggestions.map((c) => c.score)).toEqual([0.7, 0.65, 0.6]);
});

it('no candidates means none, and the street floor is lower than the city floor', () => {
  expect(decidePlace('city', []).status).toEqual('none');
  expect(decidePlace('street', [cand('street', 'a', 0.82)]).status).toEqual('picked');
  expect(decidePlace('city', [cand('city', 'a', 0.82)]).status).toEqual('suggest');
});

it('other levels in the list are ignored', () => {
  expect(decidePlace('city', [cand('junction', 'j', 1)]).status).toEqual('none');
});

it('a ride place ranks cities and junctions together and recomputes the margin', async () => {
  const resolve: PlaceResolver = (level) =>
    Promise.resolve(level === 'city' ? [cand('city', 'c', 0.9, 0.9)] : [cand('junction', 'j', 0.85, 0.85)]);
  const r = await resolveRidePlace(resolve, 'x');
  expect(r.status).toEqual('suggest'); // 0.90 vs 0.85: margin 0.05
  expect(r.suggestions.map((c) => c.placeId)).toEqual(['c', 'j']);
});

it('a ride place with no text is none and asks nothing of the catalog', async () => {
  let calls = 0;
  const r = await resolveRidePlace(() => {
    calls++;
    return Promise.resolve([]);
  }, null);
  expect(r.status).toEqual('none');
  expect(calls).toEqual(0);
});
