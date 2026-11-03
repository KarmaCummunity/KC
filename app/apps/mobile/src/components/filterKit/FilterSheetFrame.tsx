// Mapped to spec: FR-FEED-004 (shared bottom-sheet frame for filter affordances)
import React, { type ReactNode } from 'react';
import type { DimensionValue } from 'react-native';
import { useTranslation } from 'react-i18next';
import { BottomSheet } from '../ui/BottomSheet';
import { GhostButton, PrimaryButton } from '../ui/Buttons';

export interface FilterSheetFrameProps {
  readonly visible: boolean;
  /** Closes the sheet without applying or committing further changes. */
  readonly onDismiss: () => void;
  readonly title: string;
  /** Label and handler of the secondary action that resets every filter. */
  readonly clearLabel?: string;
  readonly onClear: () => void;
  /** Optional label and handler of the primary action when manual apply is needed. */
  readonly applyLabel?: string;
  readonly onApply?: () => void;
  /** Optional cap on sheet height (e.g. '58%' for compact density). */
  readonly maxHeight?: DimensionValue;
  /** The filter sections. */
  readonly children: ReactNode;
}

/**
 * Shared sheet frame: wraps kit `BottomSheet` with a scrollable body and
 * a pinned footer hosting "Clear all" (and optional "Apply" button).
 */
export function FilterSheetFrame({
  visible,
  onDismiss,
  title,
  clearLabel,
  onClear,
  applyLabel,
  onApply,
  maxHeight,
  children,
}: FilterSheetFrameProps) {
  const { t } = useTranslation();
  const resolvedClearLabel = clearLabel ?? t('filters.clearAll');

  return (
    <BottomSheet
      visible={visible}
      onDismiss={onDismiss}
      title={title}
      maxHeight={maxHeight}
      footer={
        <>
          {onApply && applyLabel ? (
            <PrimaryButton label={applyLabel} size="md" fullWidth onPress={onApply} />
          ) : null}
          <GhostButton label={resolvedClearLabel} size="md" fullWidth onPress={onClear} />
        </>
      }
    >
      {children}
    </BottomSheet>
  );
}
