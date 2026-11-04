// FR-AUTH-015 — Soft gate before first meaningful action
// Provider + hook. Modal lives in OnboardingSoftGateModal.tsx.
import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { useAuthStore } from '../store/authStore';
import { DateOfBirthGateModal } from './DateOfBirthGateModal';
import { OnboardingSoftGateModal } from './OnboardingSoftGateModal';
import { useDateOfBirthRequirement } from '../hooks/useDateOfBirthRequirement';

type DeferredAction = () => void | Promise<void>;

interface SoftGateContextValue {
  /**
   * If onboarding_state === 'pending_basic_info', open the soft-gate modal and
   * run `action` after Save (FR-AUTH-015 AC3). A member who finished onboarding but has no
   * date of birth gets a dialog asking only for it (AC1.b). Cancel = no side effects (AC2).
   * Otherwise, run `action` immediately.
   */
  requestSoftGate: (action: DeferredAction) => void;
}

const SoftGateContext = createContext<SoftGateContextValue | null>(null);

export function useSoftGate(): SoftGateContextValue {
  const ctx = useContext(SoftGateContext);
  if (!ctx) throw new Error('useSoftGate must be used inside <SoftGateProvider>');
  return ctx;
}

export function SoftGateProvider({ children }: Readonly<{ children: React.ReactNode }>) {
  const [pending, setPending] = useState<DeferredAction | null>(null);
  /** Which dialog the pending action waits on. */
  const [dialog, setDialog] = useState<'basicInfo' | 'dateOfBirth'>('basicInfo');
  const { isDateOfBirthMissing, forgetDateOfBirthAnswer } = useDateOfBirthRequirement();

  const requestSoftGate = useCallback((action: DeferredAction) => {
    const state = useAuthStore.getState().onboardingState;
    if (state === 'pending_basic_info') {
      setDialog('basicInfo');
      setPending(() => action);
      return;
    }
    void (async () => {
      if (await isDateOfBirthMissing()) {
        setDialog('dateOfBirth');
        setPending(() => action);
      } else {
        await action();
      }
    })();
  }, [isDateOfBirthMissing]);

  const handleClose = useCallback(() => setPending(null), []);

  const handleSaved = useCallback(() => {
    forgetDateOfBirthAnswer();
    setPending((current) => {
      if (current) void current();
      return null;
    });
  }, [forgetDateOfBirthAnswer]);

  const value = useMemo(() => ({ requestSoftGate }), [requestSoftGate]);

  return (
    <SoftGateContext.Provider value={value}>
      {children}
      <OnboardingSoftGateModal
        visible={pending !== null && dialog === 'basicInfo'}
        onClose={handleClose}
        onSaved={handleSaved}
      />
      <DateOfBirthGateModal
        visible={pending !== null && dialog === 'dateOfBirth'}
        onClose={handleClose}
        onSaved={handleSaved}
      />
    </SoftGateContext.Provider>
  );
}
