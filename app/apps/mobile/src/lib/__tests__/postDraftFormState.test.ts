import { describe, it, expect } from 'vitest';
import {
  isFormStateAtDefaults,
  shouldAutosaveDraft,
  buildDraftPayload,
  POST_DRAFT_DEFAULTS,
  type PostDraftFormState,
} from '../postDraftFormState';

const guards = { ownerId: 'user-A', isHydrating: false, isResumePending: false, isPostCategory: true };

describe('isFormStateAtDefaults', () => {
  it('returns true for the canonical empty state', () => {
    expect(isFormStateAtDefaults(POST_DRAFT_DEFAULTS)).toBe(true);
  });

  it('returns false when title has been typed', () => {
    expect(isFormStateAtDefaults({ ...POST_DRAFT_DEFAULTS, title: 'X' })).toBe(false);
  });

  it('returns false when an image has been uploaded', () => {
    const upload = {
      path: 'p',
      mimeType: 'image/jpeg',
      sizeBytes: 1,
      previewUri: 'file://x',
    } as PostDraftFormState['uploads'][number];
    expect(isFormStateAtDefaults({ ...POST_DRAFT_DEFAULTS, uploads: [upload] })).toBe(false);
  });

  it.each([
    ['type', { type: 'Request' as const }],
    ['category', { category: 'Furniture' as const }],
    ['condition', { condition: 'LikeNew' as const }],
    ['urgency', { urgency: 'today' }],
    ['locationDisplayLevel', { locationDisplayLevel: 'CityOnly' as const }],
    ['visibility', { visibility: 'OnlyMe' as const }],
    ['hideFromCounterparty', { hideFromCounterparty: true }],
    ['description', { description: 'hi' }],
  ])('returns false when only %s diverges from defaults', (_label, diff) => {
    expect(isFormStateAtDefaults({ ...POST_DRAFT_DEFAULTS, ...diff })).toBe(false);
  });
});

describe('shouldAutosaveDraft', () => {
  const dirty: PostDraftFormState = { ...POST_DRAFT_DEFAULTS, title: 'Couch' };

  it('saves when user signed in + not hydrating + not resuming + form dirty', () => {
    expect(shouldAutosaveDraft(guards, dirty)).toBe(true);
  });

  it('refuses to save without an ownerId', () => {
    expect(shouldAutosaveDraft({ ...guards, ownerId: undefined }, dirty)).toBe(false);
  });

  it('refuses to save during hydration', () => {
    expect(shouldAutosaveDraft({ ...guards, isHydrating: true }, dirty)).toBe(false);
  });

  it('refuses to save while the resume banner is pending', () => {
    expect(shouldAutosaveDraft({ ...guards, isResumePending: true }, dirty)).toBe(false);
  });

  it('refuses to save when the form is at canonical defaults', () => {
    expect(shouldAutosaveDraft(guards, POST_DRAFT_DEFAULTS)).toBe(false);
  });

  // FR-POST-001 AC6: the remembered direction is restored on open; it is not draft content.
  it('refuses to save an empty form whose only change is the direction', () => {
    expect(shouldAutosaveDraft(guards, { ...POST_DRAFT_DEFAULTS, type: 'Request' })).toBe(false);
    expect(shouldAutosaveDraft(guards, { ...dirty, type: 'Request' })).toBe(true);
  });

  it('refuses to save while a listing category is open', () => {
    expect(shouldAutosaveDraft({ ...guards, isPostCategory: false }, dirty)).toBe(false);
  });
});

describe('buildDraftPayload', () => {
  it('copies the form state plus ownerId + updatedAt; clones uploads', () => {
    const uploads = [
      { path: 'p1', mimeType: 'image/jpeg', sizeBytes: 1, previewUri: 'file://1' },
    ] as PostDraftFormState['uploads'];
    const state: PostDraftFormState = { ...POST_DRAFT_DEFAULTS, title: 'Lamp', uploads };
    const out = buildDraftPayload('user-A', 1_700_000_000, state);
    expect(out.ownerId).toBe('user-A');
    expect(out.updatedAt).toBe(1_700_000_000);
    expect(out.title).toBe('Lamp');
    expect(out.uploads).toEqual(uploads);
    // uploads is cloned (not the same array reference) — guards against later mutation.
    expect(out.uploads).not.toBe(uploads);
  });
});
