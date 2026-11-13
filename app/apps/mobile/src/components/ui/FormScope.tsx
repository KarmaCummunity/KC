// Mapped to spec: FR-RESP-006 AC24 — the form scope as a component. `Screen`, `BottomSheet`, `Modal`,
// `FormScreen` and `FormScrollView` each mount one, so any form built on them behaves the same.
import React, { useContext } from 'react';
import { ScrollView, type ScrollViewProps } from 'react-native';
import { KeyboardFormAccessory } from './KeyboardFormAccessory';
import { FormScopeContext, useFormScopeController } from './formScope';

interface FormScopeProps {
  readonly children: React.ReactNode;
  /** Never join an enclosing scope: for overlays (modal, sheet) that are their own native window. */
  readonly isolated?: boolean;
}

/**
 * Starts a form scope, unless an enclosing one already runs (then the inner form simply joins it,
 * so there is never a second toolbar). Renders the Android toolbar row after its children.
 */
export function FormScope({ children, isolated = false }: FormScopeProps) {
  const outer = useContext(FormScopeContext);
  const own = useFormScopeController();
  if (!isolated && outer) return <>{children}</>;
  return (
    <FormScopeContext.Provider value={own.scope}>
      {children}
      <KeyboardFormAccessory {...own.accessoryProps} />
    </FormScopeContext.Provider>
  );
}

/** A `ScrollView` wired to the enclosing form scope (scroll offset + target for jump-to-problem). */
export function FormScopeScrollView(props: ScrollViewProps) {
  const scope = useContext(FormScopeContext);
  return <ScrollView keyboardShouldPersistTaps="handled" {...props} {...scope?.scrollProps} />;
}
