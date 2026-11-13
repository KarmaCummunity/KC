// Mapped to spec: FR-RESP-006 — a drop-in `ScrollView` for forms that live inside a screen or modal
// that is not a `FormScreen`. Its text fields get keyboard Next / Previous / Done, the right return
// key, and a jump to the first field with a problem — with no per-field wiring.
import React, { useContext, useEffect, useRef } from 'react';
import type { ScrollViewProps } from 'react-native';
import { FormScope, FormScopeScrollView } from './FormScope';
import { FormScopeContext } from './formScope';

export interface FormScrollViewProps extends Omit<ScrollViewProps, 'onScroll' | 'scrollEventThrottle'> {
  readonly children: React.ReactNode;
  /**
   * Bump (e.g. a failed-submit counter) to scroll to the first field with an error again — needed
   * when the same errors are still showing and nothing new appeared to trigger the jump.
   */
  readonly jumpToProblemSignal?: number;
}

export function FormScrollView({ children, jumpToProblemSignal = 0, ...scrollProps }: FormScrollViewProps) {
  return (
    <FormScope>
      <JumpOnSignal signal={jumpToProblemSignal} />
      <FormScopeScrollView {...scrollProps}>{children}</FormScopeScrollView>
    </FormScope>
  );
}

/** Scrolls to the first problem field whenever `signal` changes (not on mount). */
function JumpOnSignal({ signal }: { readonly signal: number }) {
  const scrollToFirstInvalid = useContext(FormScopeContext)?.scrollToFirstInvalid;
  const last = useRef(signal);
  useEffect(() => {
    if (last.current === signal) return;
    last.current = signal;
    scrollToFirstInvalid?.();
  }, [signal, scrollToFirstInvalid]);
  return null;
}
