// @vitest-environment jsdom
// FR-FEED-020 AC2 / FR-DONATE-011 / FR-KNOW-001 — the curated sections of a world's "links and
// knowledge" screen: organizations (opening their site when they have one), related worlds
// (opening that world) and the topic tree; a section with no row is not rendered.
import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { ThemeProvider } from '@kc/ui';
import { emptyWorldContent, type KnowledgeTopic, type WorldContent } from '@kc/domain';

const mocks = vi.hoisted(() => ({ push: vi.fn(), open: vi.fn(), language: 'he' }));

vi.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k, i18n: { language: mocks.language } }) }));
vi.mock('expo-router', () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock('../../../utils/openExternalUrl', () => ({ openExternalUrl: mocks.open }));

import { WorldContentSections } from '../WorldContentSections';

const topic = (slug: string, parentId: string | null, sortOrder: number): KnowledgeTopic => ({
  topicId: slug, slug, parentId, labelHe: `he-${slug}`, labelEn: `en-${slug}`, descriptionHe: null,
  status: 'active', mergedIntoId: null, sortOrder,
});

const CONTENT: WorldContent = {
  worldSlug: 'medical',
  links: [{
    linkId: 'l1', fromWorldSlug: 'medical', toWorldSlug: 'rides', linkSlug: 'medical_ride',
    labelHe: 'נסיעה רפואית', labelEn: 'Medical ride', description: null,
  }, {
    linkId: 'l2', fromWorldSlug: 'medical', toWorldSlug: 'democracy', linkSlug: 'patient_rights',
    labelHe: 'זכויות החולה', labelEn: 'Patient rights', description: null,
  }],
  externalBodies: [
    { bodyId: 'b1', slug: 'mda', worldSlug: 'medical', labelHe: 'מגן דוד אדום', labelEn: 'Magen David Adom', bodyType: 'blood_services', contactUrl: 'https://www.mdais.org' },
    { bodyId: 'b2', slug: 'ezer', worldSlug: 'medical', labelHe: 'עזר', labelEn: 'Ezer', bodyType: 'ngo', contactUrl: null },
  ],
  topics: [topic('first-aid', null, 1), topic('cpr', 'first-aid', 1)],
};

const show = (content: WorldContent) =>
  render(<ThemeProvider mode="light" systemScheme="light" setMode={() => {}}><WorldContentSections content={content} /></ThemeProvider>);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mocks.language = 'he';
});

describe('WorldContentSections', () => {
  it('opens the site of an organization that has one; one without an address is plain text', () => {
    const view = show(CONTENT);
    const withSite = view.getByTestId('world-content-body-mda');
    expect(withSite.textContent).toContain('מגן דוד אדום');
    expect(withSite.textContent).toContain('mdais.org');
    fireEvent.click(withSite);
    expect(mocks.open).toHaveBeenCalledWith('https://www.mdais.org');

    fireEvent.click(view.getByTestId('world-content-body-ezer'));
    expect(mocks.open).toHaveBeenCalledTimes(1);
  });

  it('opens the related world: its own screen, or the generic screen of a link-only world', () => {
    const view = show(CONTENT);
    fireEvent.click(view.getByTestId('world-content-link-medical_ride'));
    expect(mocks.push).toHaveBeenLastCalledWith('/(tabs)/donations/rides');
    fireEvent.click(view.getByTestId('world-content-link-patient_rights'));
    expect(mocks.push).toHaveBeenLastCalledWith('/(tabs)/donations/category/democracy');
  });

  it('shows the topic tree: a root with its children under it', () => {
    const root = show(CONTENT).getByTestId('world-content-topic-first-aid');
    expect(root.textContent).toBe('he-first-aidhe-cpr');
  });

  it('labels rows in English when the interface is in English', () => {
    mocks.language = 'en';
    const view = show(CONTENT);
    expect(view.getByTestId('world-content-body-mda').textContent).toContain('Magen David Adom');
    expect(view.getByTestId('world-content-link-medical_ride').textContent).toContain('Medical ride');
  });

  it('renders no section for a list that is empty', () => {
    const view = show({ ...emptyWorldContent('animals'), links: CONTENT.links });
    expect(view.getByTestId('world-content-related')).toBeTruthy();
    expect(view.queryByTestId('world-content-bodies')).toBeNull();
    expect(view.queryByTestId('world-content-topics')).toBeNull();
  });
});
