// FR-KNOW-001: the knowledge topic graph vocabulary and its pure rules.
import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../errors';
import {
  buildKnowledgeTopicTree,
  isKnowledgeShelfSlug,
  KNOWLEDGE_SHELF_SLUGS,
  type KnowledgeTopic,
  normalizeKnowledgeText,
  validateKnowledgeTopicProposal,
  validateKnowledgeTopicSelection,
} from '../knowledgeTopics';

function topic(overrides: Partial<KnowledgeTopic> & Pick<KnowledgeTopic, 'topicId' | 'slug'>): KnowledgeTopic {
  return {
    parentId: null,
    labelHe: overrides.slug,
    labelEn: overrides.slug,
    descriptionHe: null,
    status: 'active',
    mergedIntoId: null,
    sortOrder: 0,
    ...overrides,
  };
}

describe('knowledge shelves (D100)', () => {
  it('lists the six sub-categories of the knowledge world', () => {
    expect(KNOWLEDGE_SHELF_SLUGS).toHaveLength(6);
    expect(isKnowledgeShelfSlug('rights_legal_aid')).toBe(true);
    expect(isKnowledgeShelfSlug('tech')).toBe(false);
  });
});

describe('normalizeKnowledgeText', () => {
  it('lower-cases, folds punctuation to spaces and collapses whitespace', () => {
    expect(normalizeKnowledgeText('  Python,  3.12! ')).toBe('python 3 12');
  });

  it('strips niqqud and folds Hebrew final letters like the database does', () => {
    expect(normalizeKnowledgeText('פייתוֹן')).toBe('פייתונ');
    expect(normalizeKnowledgeText("ג'אווה-סקריפט")).toBe(normalizeKnowledgeText('ג אווה סקריפט'));
  });

  it('treats null and undefined as empty', () => {
    expect(normalizeKnowledgeText(null)).toBe('');
    expect(normalizeKnowledgeText(undefined)).toBe('');
  });
});

describe('validateKnowledgeTopicProposal', () => {
  it('trims and lower-cases a valid proposal', () => {
    expect(
      validateKnowledgeTopicProposal({
        slug: ' Rust ',
        labelHe: ' ראסט ',
        labelEn: ' Rust ',
        parentSlug: ' programming ',
        descriptionHe: '  ',
      }),
    ).toEqual({ slug: 'rust', labelHe: 'ראסט', labelEn: 'Rust', parentSlug: 'programming', descriptionHe: null });
  });

  it('rejects a slug that is not kebab-case', () => {
    expect(() => validateKnowledgeTopicProposal({ slug: 'Bad Slug!', labelHe: 'x', labelEn: 'x' })).toThrow(
      ValidationError,
    );
  });

  it('rejects an empty or overlong label and names the field', () => {
    expect(() => validateKnowledgeTopicProposal({ slug: 'ok', labelHe: '', labelEn: 'x' })).toThrow(
      expect.objectContaining({ field: 'labelHe' }),
    );
    expect(() =>
      validateKnowledgeTopicProposal({ slug: 'ok', labelHe: 'x', labelEn: 'y'.repeat(81) }),
    ).toThrow(expect.objectContaining({ field: 'labelEn' }));
  });

  it('rejects an overlong description', () => {
    expect(() =>
      validateKnowledgeTopicProposal({ slug: 'ok', labelHe: 'x', labelEn: 'x', descriptionHe: 'd'.repeat(281) }),
    ).toThrow(expect.objectContaining({ field: 'descriptionHe' }));
  });
});

describe('buildKnowledgeTopicTree', () => {
  it('nests children under parents in sort order and leaves merged topics out', () => {
    const tree = buildKnowledgeTopicTree([
      topic({ topicId: 'p', slug: 'programming', sortOrder: 1 }),
      topic({ topicId: 'l', slug: 'languages', sortOrder: 2 }),
      topic({ topicId: 'js', slug: 'javascript', parentId: 'p', sortOrder: 2 }),
      topic({ topicId: 'py', slug: 'python', parentId: 'p', sortOrder: 1 }),
      topic({ topicId: 'old', slug: 'old-python', parentId: 'p', status: 'merged', mergedIntoId: 'py' }),
    ]);

    expect(tree.map((node) => node.slug)).toEqual(['programming', 'languages']);
    expect(tree[0]?.children.map((node) => node.slug)).toEqual(['python', 'javascript']);
    expect(tree[1]?.children).toEqual([]);
  });

  it('renders an orphan (parent not in the list) as a root instead of dropping it', () => {
    const tree = buildKnowledgeTopicTree([topic({ topicId: 'py', slug: 'python', parentId: 'missing' })]);
    expect(tree.map((node) => node.slug)).toEqual(['python']);
  });
});

describe('validateKnowledgeTopicSelection', () => {
  it('accepts one primary and up to four distinct additional topics', () => {
    expect(() => validateKnowledgeTopicSelection('a', ['b', 'c', 'd', 'e'])).not.toThrow();
  });

  it('rejects a missing primary, repeats and more than four additional topics', () => {
    expect(() => validateKnowledgeTopicSelection('', [])).toThrow(ValidationError);
    expect(() => validateKnowledgeTopicSelection('a', ['a'])).toThrow(ValidationError);
    expect(() => validateKnowledgeTopicSelection('a', ['b', 'b'])).toThrow(ValidationError);
    expect(() => validateKnowledgeTopicSelection('a', ['b', 'c', 'd', 'e', 'f'])).toThrow(ValidationError);
  });
});
