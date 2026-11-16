// Mapped to spec: docs/spec/05_giving_worlds.md §5.11 (employment, first slice).
import { describe, expect, it } from 'vitest';
import { EMPLOYMENT_FIELD_SPECS } from '../employmentFieldSpecs';
import { fieldsForKind } from '../listingFieldSpecs';
// eslint-disable-next-line no-restricted-imports -- test asserts every employment label exists in he and en
import { employmentFieldLabels as heFields, employmentOptionLabels as heOptions } from '../../../i18n/locales/he/donations.employmentFields';
// eslint-disable-next-line no-restricted-imports -- test asserts every employment label exists in he and en
import { employmentFieldLabels as enFields, employmentOptionLabels as enOptions } from '../../../i18n/locales/en/donations.employmentFields';

const KINDS = ['job_offer', 'job_request'] as const;

describe('employment create-form field specs', () => {
  it('gives both kinds a required role and scope and an optional area', () => {
    for (const slug of KINDS) {
      const specs = EMPLOYMENT_FIELD_SPECS[slug]!;
      expect(specs.map((s) => s.key)).toEqual(['job_role', 'job_scope', 'job_area']);
      expect(specs.filter((s) => s.required).map((s) => s.key)).toEqual(['job_role', 'job_scope']);
    }
  });

  it('is wired into the kit and labels every field and option in he and en', () => {
    for (const slug of KINDS) {
      const specs = fieldsForKind({ slug, detailSchema: { type: 'object' } } as never);
      expect(specs.map((s) => s.key)).toEqual(['job_role', 'job_scope', 'job_area']);
      for (const [fields, options] of [[heFields, heOptions], [enFields, enOptions]] as const) {
        for (const spec of specs) {
          expect((fields as Record<string, string>)[spec.key], spec.key).toBeTruthy();
          if (spec.type !== 'choice') continue;
          for (const o of spec.options) expect((options as Record<string, string>)[o], o).toBeTruthy();
        }
      }
    }
  });
});
