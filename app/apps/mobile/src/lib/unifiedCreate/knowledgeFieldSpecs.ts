// Mapped to spec: docs/SSOT/spec/23_knowledge.md (exchange posts) · binding schemas in migration 0395.
// Curated create-form field sets of the knowledge listing kinds. The server requires the topic,
// the format and a single slot (start, end, places) for a course or a lesson.
import type { ListingFieldSpec } from './listingFieldSpecs';

const LEVELS = ['beginner', 'intermediate', 'advanced'] as const;
const MODALITIES = ['in_person', 'video', 'phone'] as const;

const SLOT_FIELDS: readonly ListingFieldSpec[] = [
  { key: 'topic', type: 'text', required: true, maxLength: 80 },
  { key: 'level', type: 'choice', options: LEVELS },
  { key: 'modality', type: 'choice', required: true, options: MODALITIES, defaultValue: 'in_person' },
  { key: 'slot_starts_at', type: 'dateTime', required: true },
  { key: 'slot_ends_at', type: 'dateTime', required: true },
  { key: 'slots_available', type: 'count', min: 1, max: 20, defaultValue: 1 },
];

/** Knowledge kinds keyed by `listing_kinds.slug`; spread into the kit's SPECS_BY_KIND. */
export const KNOWLEDGE_FIELD_SPECS: Readonly<Record<string, readonly ListingFieldSpec[]>> = {
  course: SLOT_FIELDS,
  private_lesson: [...SLOT_FIELDS, { key: 'availability_note', type: 'text', multiline: true, maxLength: 280 }],
  mentorship_request: [
    { key: 'topic', type: 'text', required: true, maxLength: 80 },
    { key: 'level', type: 'choice', options: LEVELS },
    { key: 'preferred_modality', type: 'choice', options: MODALITIES },
  ],
};
