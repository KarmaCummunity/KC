// #2278 — the employment world's first slice: a job offer and a job request, with role, scope and
// where; the create form opens as a listing form only once the world is active.
import { describe, expect, it } from 'vitest';
import type { ListingKindOption } from '@kc/domain';
import { findCreateCategory, resolveCreateCategory } from '../createCategories';
import { fieldsForKind, firstMissingRequiredField } from '../listingFieldSpecs';

/** A seeded employment kind: the baseline gives every kind the free `{"type":"object"}` schema. */
function kind(slug: string, direction: ListingKindOption['direction']): ListingKindOption {
  return { kindId: `k-${slug}`, slug, labelEn: slug, labelHe: slug, direction, detailSchema: { type: 'object' } };
}

describe('employment create form (#2278)', () => {
  it('asks a job offer for the role, the scope and where, the role and scope required', () => {
    const specs = fieldsForKind(kind('job_offer', 'give'));
    expect(specs.map((s) => s.key)).toEqual(['role', 'job_scope', 'work_mode']);
    expect(specs.filter((s) => s.required).map((s) => s.key)).toEqual(['role', 'job_scope']);
  });

  it('asks a job request for the role only as required', () => {
    const specs = fieldsForKind(kind('job_request', 'request'));
    expect(specs.map((s) => s.key)).toEqual(['role', 'job_scope', 'work_mode']);
    expect(firstMissingRequiredField(specs, {})?.key).toBe('role');
    expect(firstMissingRequiredField(specs, { role: 'מפתח/ת' })).toBeNull();
  });

  it('keeps job scope option keys apart from the animals boarding option `part_time`', () => {
    const scope = fieldsForKind(kind('job_offer', 'give')).find((s) => s.key === 'job_scope');
    expect(scope && 'options' in scope ? scope.options : []).not.toContain('part_time');
  });

  it('keeps the community-link form while employment is a portal, and opens the listing form once active', () => {
    const employment = findCreateCategory('employment');
    for (const remote of [undefined, {}, { world_employment_enabled: false }]) {
      expect(resolveCreateCategory(employment, remote)).toBe(employment);
    }
    expect(resolveCreateCategory(employment, { world_employment_enabled: true })).toMatchObject({
      id: 'employment', engine: 'listing', worldSlug: 'employment', linkCategory: null,
    });
  });
});
