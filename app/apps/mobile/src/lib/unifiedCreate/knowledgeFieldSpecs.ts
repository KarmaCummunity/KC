// Mapped to spec: docs/spec/requirements/23_knowledge.md FR-KNOW-003 AC2 (#2034) · binding schemas in
// migration 0703. Curated create-form field sets of the six knowledge exchange kinds, keyed by
// `listing_kinds.slug`. `fieldsForKind` drops any key the kind's schema does not list, so a field
// here can never reach the server unknown. Legacy kinds (course, private_lesson, mentorship_request)
// are no longer offered and have no form.
import { KNOWLEDGE_SLOTS_MAX } from '@kc/domain';
import type { ListingFieldSpec } from './listingFieldSpecs';

const LEVELS = ['beginner', 'intermediate', 'advanced'] as const;
const MODALITIES = ['in_person', 'video', 'phone'] as const;
const LANGUAGES = ['he', 'en', 'ar', 'ru', 'am', 'fr', 'es', 'other'] as const;
const CADENCES = ['weekly', 'biweekly', 'monthly', 'flexible'] as const;
const AUDIENCES = ['career_change', 'students', 'new_immigrants', 'youth_18plus', 'seniors', 'other'] as const;
const PROFESSIONS = [
  'lawyer',
  'accountant',
  'tax_advisor',
  'social_worker',
  'employment_rights',
  'housing_rights',
  'consumer_rights',
  'other',
] as const;

// A free-text subject until posts link to the topic graph (#2036).
const TOPIC: ListingFieldSpec = { key: 'topic', type: 'text', maxLength: 80 };
const NOTE: ListingFieldSpec = { key: 'availability_note', type: 'text', multiline: true, maxLength: 280 };
const LANGUAGE: ListingFieldSpec = { key: 'language', type: 'multiChoice', options: LANGUAGES };
const SLOTS: ListingFieldSpec = { key: 'slots', type: 'slotList', required: true, maxSlots: KNOWLEDGE_SLOTS_MAX };

export const KNOWLEDGE_FIELD_SPECS: Readonly<Record<string, readonly ListingFieldSpec[]>> = {
  lesson_offer: [
    TOPIC,
    { key: 'level', type: 'choice', options: LEVELS },
    { key: 'modality', type: 'choice', required: true, options: MODALITIES, defaultValue: 'in_person' },
    SLOTS,
    { key: 'capacity_per_slot', type: 'count', required: true, min: 1, max: 20, defaultValue: 1 },
    LANGUAGE,
    NOTE,
  ],
  mentoring_offer: [
    TOPIC,
    { key: 'audience', type: 'multiChoice', options: AUDIENCES },
    { key: 'cadence', type: 'choice', required: true, options: CADENCES, defaultValue: 'weekly' },
    { key: 'modality', type: 'choice', required: true, options: MODALITIES, defaultValue: 'video' },
    { key: 'seats', type: 'count', required: true, min: 1, max: 10, defaultValue: 1 },
    LANGUAGE,
    NOTE,
  ],
  consulting_hour: [
    { key: 'profession', type: 'choice', required: true, options: PROFESSIONS },
    TOPIC,
    { key: 'modality', type: 'choice', required: true, options: MODALITIES, defaultValue: 'video' },
    SLOTS,
    { key: 'capacity_per_slot', type: 'count', required: true, min: 1, max: 5, defaultValue: 1 },
    LANGUAGE,
    NOTE,
    // D40: the giver confirms this is general information, not binding advice (schema const true).
    { key: 'disclaimer_accepted', type: 'toggle', required: true },
  ],
  learning_request: [
    TOPIC,
    { key: 'level', type: 'choice', options: LEVELS },
    { key: 'preferred_modality', type: 'choice', options: MODALITIES },
    LANGUAGE,
    NOTE,
  ],
  mentoring_request: [
    TOPIC,
    { key: 'goal', type: 'text', multiline: true, maxLength: 280 },
    { key: 'cadence', type: 'choice', options: CADENCES },
    { key: 'level', type: 'choice', options: LEVELS },
    { key: 'preferred_modality', type: 'choice', options: MODALITIES },
    LANGUAGE,
  ],
  // The question itself is the post's title and description.
  question: [TOPIC, { key: 'context_url', type: 'text', maxLength: 500 }],
};
