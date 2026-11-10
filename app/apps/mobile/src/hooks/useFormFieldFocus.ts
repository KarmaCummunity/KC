import { useCallback, useMemo, useState } from 'react';
import { Keyboard } from 'react-native';
import type { TextInput as KitTextInput } from '@kc/ui';
import { KC_FORM_KEYBOARD_ACCESSORY_ID } from '../lib/platform/formKeyboardConstants';

export interface FormFieldFocusBindings {
  readonly ref: React.RefObject<KitTextInput | null>;
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
    () => Array.from({ length: fieldCount }, () => ({ current: null as KitTextInput | null })),
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
    const next = (activeIndex ?? -1) + 1;
    if (next < fieldCount) {
      focusIndex(next);
      return;
    }
    Keyboard.dismiss();
  }, [activeIndex, fieldCount, focusIndex]);

  const focusPrev = useCallback(() => {
    const prev = (activeIndex ?? fieldCount) - 1;
    if (prev >= 0) focusIndex(prev);
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

/** Props for `FormScreen` / `KeyboardFormAccessory` from `useFormFieldFocus` (FR-RESP-006). */
export function formKeyboardAccessoryProps(
  fieldFocus: Pick<
    ReturnType<typeof useFormFieldFocus>,
    'canGoPrev' | 'canGoNext' | 'focusPrev' | 'focusNext' | 'dismiss'
  >,
) {
  return {
    canGoPrev: fieldFocus.canGoPrev,
    canGoNext: fieldFocus.canGoNext,
    onPrev: fieldFocus.focusPrev,
    onNext: fieldFocus.focusNext,
    onDone: fieldFocus.dismiss,
  } as const;
}
