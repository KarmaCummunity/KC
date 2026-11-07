import { useCallback, useMemo, useState } from 'react';
import { Keyboard } from 'react-native';
import { KC_FORM_KEYBOARD_ACCESSORY_ID } from '../lib/platform/formKeyboardConstants';

/** Ref target for chained focus — kit inputs implement `focus()`. */
export interface FocusableFieldRef {
  focus: () => void;
}

export interface FormFieldFocusBindings {
  readonly ref: React.RefObject<FocusableFieldRef | null>;
  readonly onFocus: () => void;
  readonly inputAccessoryViewID: string;
  readonly returnKeyType: 'next' | 'done';
  readonly blurOnSubmit: boolean;
  readonly onSubmitEditing: () => void;
}

/**
 * Ordered text fields: next / previous / dismiss for keyboard toolbars.
 */
export function useFormFieldFocus(fieldCount: number) {
  const refs = useMemo(
    () => Array.from({ length: fieldCount }, () => ({ current: null as FocusableFieldRef | null })),
    [fieldCount],
  );
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  const focusIndex = useCallback(
    (index: number) => {
      if (index < 0 || index >= fieldCount) return;
      refs[index]?.current?.focus();
    },
    [fieldCount, refs],
  );

  const focusNext = useCallback(() => {
    const start = activeIndex ?? -1;
    for (let i = start + 1; i < fieldCount; i++) {
      focusIndex(i);
      return;
    }
    Keyboard.dismiss();
  }, [activeIndex, fieldCount, focusIndex]);

  const focusPrev = useCallback(() => {
    const start = activeIndex ?? fieldCount;
    for (let i = start - 1; i >= 0; i--) {
      focusIndex(i);
      return;
    }
  }, [activeIndex, fieldCount, focusIndex]);

  const dismiss = useCallback(() => {
    Keyboard.dismiss();
  }, []);

  const bindField = useCallback(
    (index: number): FormFieldFocusBindings => {
      const isLast = index >= fieldCount - 1;
      return {
        ref: refs[index]!,
        onFocus: () => setActiveIndex(index),
        inputAccessoryViewID: KC_FORM_KEYBOARD_ACCESSORY_ID,
        returnKeyType: isLast ? 'done' : 'next',
        blurOnSubmit: isLast,
        onSubmitEditing: () => {
          if (isLast) dismiss();
          else focusNext();
        },
      };
    },
    [dismiss, fieldCount, focusNext, refs],
  );

  const canGoPrev = activeIndex !== null && activeIndex > 0;
  const canGoNext = activeIndex !== null && activeIndex < fieldCount - 1;

  return {
    accessoryNativeId: KC_FORM_KEYBOARD_ACCESSORY_ID,
    bindField,
    focusNext,
    focusPrev,
    dismiss,
    canGoPrev,
    canGoNext,
    activeIndex,
  };
}
