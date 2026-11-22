// @vitest-environment jsdom
// FR-KNOW-012 / D40 — the "not binding advice" notice on consulting hours and rights shelf posts.
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from '@kc/ui';
import { KnowledgeAdviceNotice } from '../KnowledgeAdviceNotice';
import { ConsultingHourDetailsCard } from '../ConsultingHourDetailsCard';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) => (o?.profession ? `${k}:${o.profession}` : k),
  }),
}));
vi.mock('@expo/vector-icons', () => ({
  Ionicons: (props: { testID?: string }) => <span data-testid={props.testID ?? 'icon'} />,
}));
vi.mock('../../../VerificationBadge', () => ({
  VerificationBadge: ({ level }: { level: number }) => <span data-testid={`verification-badge-${level}`} />,
}));

describe('KnowledgeAdviceNotice and ConsultingHourDetailsCard', () => {
  afterEach(() => cleanup());

  it('renders the D40 notice copy keys', () => {
    render(
      <ThemeProvider mode="light" systemScheme="light" setMode={() => {}}>
        <KnowledgeAdviceNotice />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('knowledge-advice-notice')).toBeTruthy();
    expect(screen.getByText('knowledgeTrust.notice.title')).toBeTruthy();
    expect(screen.getByText('knowledgeTrust.notice.body')).toBeTruthy();
  });

  it('shows profession, verification badge and the notice on a consulting hour', () => {
    render(
      <ThemeProvider mode="light" systemScheme="light" setMode={() => {}}>
        <ConsultingHourDetailsCard details={{ profession: 'lawyer' }} verificationLevel={1} />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('consulting-hour-section')).toBeTruthy();
    expect(screen.getByTestId('consulting-profession').textContent).toContain('lawyer');
    expect(screen.getByTestId('verification-badge-1')).toBeTruthy();
    expect(screen.getByTestId('consulting-advice-notice')).toBeTruthy();
  });
});
