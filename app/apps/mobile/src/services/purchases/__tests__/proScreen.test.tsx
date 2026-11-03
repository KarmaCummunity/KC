// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render } from '@testing-library/react';

let flag = false;
vi.mock('expo-router', () => ({ Redirect: ({ href }: { href: string }) => <span>redirect:{href}</span> }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock('../../../hooks/useFeatureFlag', () => ({ useFeatureFlag: () => flag }));

describe('ProPaywallScreen', () => {
  it('redirects home while the pro_paywall flag is off', async () => {
    const { default: Screen } = await import('../../../../app/pro');
    expect(render(<Screen />).container.textContent).toBe('redirect:/');
  });
  it('renders the stub when the flag is on', async () => {
    flag = true;
    const { default: Screen } = await import('../../../../app/pro');
    expect(render(<Screen />).container.textContent).toContain('karma.proComingSoon');
  });
});
