// Weekly schedule inputs are create-only. Ordinary edits must neither invent a
// one-off mode nor restart a series; the series has its own lifecycle controls.
import { KNOWLEDGE_SERIES_DETAIL_KEYS } from '@kc/domain';
import type { ListingFieldSpec } from './listingFieldSpecs';

export function lessonEditFields(
  specs: readonly ListingFieldSpec[],
  details: Readonly<Record<string, unknown>>,
): readonly ListingFieldSpec[] {
  const createOnly = new Set<string>(KNOWLEDGE_SERIES_DETAIL_KEYS);
  return specs.filter((spec) => !createOnly.has(spec.key) &&
    (spec.key !== 'slots' || Array.isArray(details.slots))).map((spec) => {
    if (spec.key !== 'slots') return spec;
    // Only an existing one-off slot list can be edited here. A weekly post has
    // no details.slots; its materialized/booked slots remain owned by the series.
    const { visibleWhen: _createMode, ...slotSpec } = spec;
    return slotSpec;
  });
}

export function lessonEditDetails(details: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const createOnly = new Set<string>(KNOWLEDGE_SERIES_DETAIL_KEYS);
  return Object.fromEntries(Object.entries(details).filter(([key]) => !createOnly.has(key)));
}
