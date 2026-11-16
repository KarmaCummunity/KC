// supabase/functions/_shared/post-extraction/schema.ts
// Response schema of the extraction call (Gemini's OpenAPI subset), kept next to the contract
// that validateExtraction enforces (FR-IMPORT-003). Types are the provider's upper-case names.

import { IMPORT_DIRECTIONS, IMPORT_REJECT_REASONS, IMPORT_TIME_KINDS, IMPORT_TIME_PERIODS } from './domain/importTypes.ts';

const str = { type: 'STRING', nullable: true };
const int = { type: 'INTEGER', nullable: true };
const num = { type: 'NUMBER' };

/** Every top-level key validateExtraction reads, in the contract's snake_case. */
export const CONTRACT_KEYS = [
  'is_post', 'reject_reason', 'direction', 'world_slug', 'subcategory', 'title', 'description',
  'place', 'time', 'ride', 'details', 'language', 'confidence',
] as const;

export const EXTRACTION_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  required: ['is_post'],
  properties: {
    is_post: { type: 'BOOLEAN' },
    reject_reason: { type: 'STRING', nullable: true, enum: [...IMPORT_REJECT_REASONS] },
    direction: { type: 'STRING', enum: [...IMPORT_DIRECTIONS] },
    world_slug: str,
    subcategory: str,
    title: str,
    description: str,
    place: {
      type: 'OBJECT',
      properties: { city_text: str, street_text: str, neighborhood_text: str },
    },
    time: {
      type: 'OBJECT',
      properties: {
        kind: { type: 'STRING', enum: [...IMPORT_TIME_KINDS] },
        day_offset: int,
        weekday: int,
        month: int,
        day_of_month: int,
        time_hhmm: str,
        time_period: { type: 'STRING', nullable: true, enum: [...IMPORT_TIME_PERIODS] },
        recurring_weekdays: { type: 'ARRAY', items: { type: 'INTEGER' } },
      },
    },
    ride: {
      type: 'OBJECT',
      nullable: true,
      properties: {
        origin_text: str,
        destination_text: str,
        meeting_texts: { type: 'ARRAY', items: { type: 'STRING' } },
        seats: int,
      },
    },
    details: { type: 'OBJECT', nullable: true },
    language: str,
    confidence: {
      type: 'OBJECT',
      properties: {
        overall: num,
        per_field: {
          type: 'OBJECT',
          properties: {
            direction: num, world: num, subcategory: num, title: num, city: num, time: num,
          },
        },
      },
    },
  },
};
