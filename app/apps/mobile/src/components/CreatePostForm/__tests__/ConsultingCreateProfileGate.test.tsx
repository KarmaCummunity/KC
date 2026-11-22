// @vitest-environment jsdom
// FR-KNOW-012 AC1 / D184 — consulting hour create gate: incomplete profile sees the card.
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@kc/ui';
import { ConsultingCreateProfileGate } from '../ConsultingCreateProfileGate';

const push = vi.fn();
let level: number | undefined = 0;
let pending = false;

vi.mock('expo-router', () => ({ useRouter: () => ({ push }) }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock('../../../hooks/useViewerVerificationLevel', () => ({
  useViewerVerificationLevel: () => ({ data: level, isPending: pending }),
}));

function renderGate() {
  const onPublishActionChange = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ThemeProvider mode="light" systemScheme="light" setMode={() => {}}>
        <ConsultingCreateProfileGate onPublishActionChange={onPublishActionChange}>
          <div data-testid="consulting-form-body">form</div>
        </ConsultingCreateProfileGate>
      </ThemeProvider>
    </QueryClientProvider>,
  );
  return { onPublishActionChange };
}

describe('ConsultingCreateProfileGate', () => {
  afterEach(() => {
    cleanup();
    push.mockReset();
    level = 0;
    pending = false;
  });

  it('shows the complete-profile card when the viewer is below level 1', () => {
    const { onPublishActionChange } = renderGate();
    expect(screen.getByTestId('consulting-profile-gate')).toBeTruthy();
    expect(screen.queryByTestId('consulting-form-body')).toBeNull();
    expect(onPublishActionChange).toHaveBeenCalledWith(null, false);
    fireEvent.click(screen.getByTestId('consulting-profile-cta'));
    expect(push).toHaveBeenCalledWith('/edit-profile');
  });

  it('renders the form when the profile is complete (level ≥ 1), without requiring ID', () => {
    level = 1;
    renderGate();
    expect(screen.getByTestId('consulting-form-body')).toBeTruthy();
    expect(screen.queryByTestId('consulting-profile-gate')).toBeNull();
  });
});
