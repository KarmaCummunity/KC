// @vitest-environment jsdom
// FR-AUTH-015 — which dialog stands between a member and their first meaningful action:
// the full basic-info dialog (onboarding unfinished), the date-of-birth-only dialog (finished
// onboarding but no date of birth, AC1.b), or none.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const m = vi.hoisted(() => ({
  onboardingState: 'completed' as string | null,
  missing: vi.fn(async () => false),
  forget: vi.fn(),
}));

vi.mock('../../store/authStore', () => ({
  useAuthStore: Object.assign(() => null, { getState: () => ({ onboardingState: m.onboardingState }) }),
}));
vi.mock('../../hooks/useDateOfBirthRequirement', () => ({
  useDateOfBirthRequirement: () => ({ isDateOfBirthMissing: m.missing, forgetDateOfBirthAnswer: m.forget }),
}));
// The dialogs are tested on their own; stand-ins show which one is open and let it "save".
vi.mock('../OnboardingSoftGateModal', () => ({
  OnboardingSoftGateModal: ({ visible, onSaved }: { visible: boolean; onSaved: () => void }) =>
    visible ? <button type="button" onClick={onSaved}>basic info dialog</button> : null,
}));
vi.mock('../DateOfBirthGateModal', () => ({
  DateOfBirthGateModal: ({ visible, onSaved }: { visible: boolean; onSaved: () => void }) =>
    visible ? <button type="button" onClick={onSaved}>date of birth dialog</button> : null,
}));

import { SoftGateProvider, useSoftGate } from '../OnboardingSoftGate';

const action = vi.fn();

function Trigger() {
  const { requestSoftGate } = useSoftGate();
  return <button type="button" onClick={() => requestSoftGate(action)}>go</button>;
}

function press() {
  render(<SoftGateProvider><Trigger /></SoftGateProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'go' }));
}

beforeEach(() => {
  m.onboardingState = 'completed';
  m.missing.mockResolvedValue(false);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('SoftGateProvider', () => {
  it('opens the full dialog while onboarding is unfinished and runs the action after saving', async () => {
    m.onboardingState = 'pending_basic_info';
    press();
    expect(action).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole('button', { name: 'basic info dialog' }));
    expect(action).toHaveBeenCalledTimes(1);
    expect(m.forget).toHaveBeenCalled();
  });

  it('opens only the date-of-birth dialog for a finished member without one, then runs the action', async () => {
    m.missing.mockResolvedValue(true);
    press();
    fireEvent.click(await screen.findByRole('button', { name: 'date of birth dialog' }));
    expect(screen.queryByRole('button', { name: 'basic info dialog' })).toBeNull();
    expect(action).toHaveBeenCalledTimes(1);
  });

  it('runs the action at once for a member who has a date of birth', async () => {
    press();
    await vi.waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('button', { name: 'date of birth dialog' })).toBeNull();
  });
});
