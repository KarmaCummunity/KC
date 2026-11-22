// FR-KNOW-012 AC1 / D184 — wraps consulting-hour create fields in the complete-profile gate.
import React, { type ReactNode } from 'react';
import { ConsultingCreateProfileGate } from './ConsultingCreateProfileGate';

interface Props {
  readonly gated: boolean;
  readonly onPublishActionChange: (action: (() => void) | null, loading: boolean) => void;
  readonly children: ReactNode;
}

/** Wraps consulting-hour fields in the complete-profile gate; other kinds pass through. */
export function ConsultingFields({ gated, onPublishActionChange, children }: Props) {
  if (!gated) return <>{children}</>;
  return (
    <ConsultingCreateProfileGate onPublishActionChange={onPublishActionChange}>
      {children}
    </ConsultingCreateProfileGate>
  );
}
