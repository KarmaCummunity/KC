// Mapped to spec: FR-RESP-006 — a drop-in `ScrollView` for forms that live inside a screen or modal
// that is not a `FormScreen`. Its text fields get keyboard Next / Previous / Done, the right return
// key, and a jump to the first field with a problem — with no per-field wiring.
import React, { useEffect, useRef } from 'react';
import { ScrollView, type ScrollViewProps } from 'react-native';
import { KeyboardFormAccessory } from './KeyboardFormAccessory';
import { FormScopeContext, useFormScopeController } from './formScope';

export interface FormScrollViewProps extends Omit<ScrollViewProps, 'onScroll' | 'scrollEventThrottle'> {
  readonly children: React.ReactNode;
  /**
   * Bump (e.g. a failed-submit counter) to scroll to the first field with an error again — needed
   * when the same errors are still showing and nothing new appeared to trigger the jump.
   */
  readonly jumpToProblemSignal?: number;
}

export function FormScrollView({ children, jumpToProblemSignal = 0, ...scrollProps }: FormScrollViewProps) {
  const form = useFormScopeController();
  const { scrollToFirstInvalid } = form;
  const lastSignal = useRef(jumpToProblemSignal);
  useEffect(() => {
    if (lastSignal.current === jumpToProblemSignal) return;
    lastSignal.current = jumpToProblemSignal;
    scrollToFirstInvalid();
  }, [jumpToProblemSignal, scrollToFirstInvalid]);
  return (
    <FormScopeContext.Provider value={form.scope}>
      <KeyboardFormAccessory {...form.accessoryProps} />
      <ScrollView keyboardShouldPersistTaps="handled" {...scrollProps} {...form.scrollProps}>
        {children}
      </ScrollView>
    </FormScopeContext.Provider>
  );
}
