// D33 / D61 — the signed-in user's current suspension, if any. Set by
// useEnforceAccountGate; read by SuspensionBanner. Not persisted: the gate
// re-checks on every launch and every minute.
import { create } from 'zustand';

export type Suspension = { readonly reason: string; readonly until: string | null };

type SuspensionState = {
  suspension: Suspension | null;
  setSuspension: (suspension: Suspension | null) => void;
};

export const useSuspensionStore = create<SuspensionState>((set) => ({
  suspension: null,
  setSuspension: (suspension) => set({ suspension }),
}));
