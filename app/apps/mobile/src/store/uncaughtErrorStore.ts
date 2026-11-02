import { create } from 'zustand';

// Holds the fatal uncaught JS error the global handler intercepted (KC#1410).
// `UncaughtErrorGate` renders the recoverable fallback while an error is set;
// clearing it remounts the shell. Not persisted — a cold start always begins
// clean.

interface UncaughtErrorState {
  /** The intercepted fatal error, or null while the app runs normally. */
  error: Error | null;
  /** Shows the fallback. A second fatal while one is shown keeps the first. */
  show: (error: Error) => void;
  /** Dismisses the fallback (the "retry" action). */
  clear: () => void;
}

export const useUncaughtErrorStore = create<UncaughtErrorState>((set, get) => ({
  error: null,
  show: (error) => {
    if (!get().error) set({ error });
  },
  clear: () => set({ error: null }),
}));
