// @vitest-environment jsdom
// #1037 — housing create gate unlocks at complete profile; no ID-verification CTA.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const router = { push: vi.fn() };
let viewerLevel: { isPending: boolean; data: number | undefined } = {
  isPending: false,
  data: 1,
};

vi.mock('expo-router', () => ({ useRouter: () => router }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@kc/ui', () => ({
  Text: ({ children, ...rest }: { children?: React.ReactNode; testID?: string }) => (
    <span data-testid={rest.testID}>{children}</span>
  ),
  useTheme: () => ({ colors: { textInverse: '#fff' } }),
}));
vi.mock('react-native', () => ({
  View: ({ children, testID }: { children?: React.ReactNode; testID?: string }) => (
    <div data-testid={testID}>{children}</div>
  ),
  Text: ({ children, testID }: { children?: React.ReactNode; testID?: string }) => (
    <span data-testid={testID}>{children}</span>
  ),
  TouchableOpacity: ({
    children,
    onPress,
    testID,
  }: {
    children?: React.ReactNode;
    onPress?: () => void;
    testID?: string;
  }) => (
    <button type="button" data-testid={testID} onClick={onPress}>
      {children}
    </button>
  ),
  ActivityIndicator: ({ testID }: { testID?: string }) => <div data-testid={testID} />,
}));
vi.mock('../../../hooks/useViewerVerificationLevel', () => ({
  useViewerVerificationLevel: () => viewerLevel,
}));
vi.mock('../../../screens/tabs/create.styles', () => ({
  useCreatePostStyles: () => ({
    section: {},
    sectionLabel: {},
    sectionHint: {},
    publishBtn: {},
    publishBtnText: {},
  }),
}));

import { HousingCreateVerificationGate } from '../HousingCreateVerificationGate';

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  viewerLevel = { isPending: false, data: 1 };
});

describe('HousingCreateVerificationGate', () => {
  it('hides the verification gate and CTA at complete-profile (max live level)', () => {
    render(
      <HousingCreateVerificationGate header={<span>hdr</span>} onPublishActionChange={() => {}}>
        <span data-testid="housing-form">form</span>
      </HousingCreateVerificationGate>,
    );
    expect(screen.getByTestId('housing-form')).toBeTruthy();
    expect(screen.queryByTestId('housing-verify-gate')).toBeNull();
    expect(screen.queryByTestId('housing-verify-cta')).toBeNull();
  });

  it('routes incomplete profiles to edit-profile, never to identity verification', () => {
    viewerLevel = { isPending: false, data: 0 };
    const onPublishActionChange = vi.fn();
    render(
      <HousingCreateVerificationGate header={<span>hdr</span>} onPublishActionChange={onPublishActionChange}>
        <span data-testid="housing-form">form</span>
      </HousingCreateVerificationGate>,
    );
    expect(screen.getByTestId('housing-verify-gate')).toBeTruthy();
    expect(screen.queryByTestId('housing-form')).toBeNull();
    fireEvent.click(screen.getByTestId('housing-verify-cta'));
    expect(router.push).toHaveBeenCalledWith('/edit-profile');
    expect(router.push).not.toHaveBeenCalledWith('/identity-verification');
  });
});
