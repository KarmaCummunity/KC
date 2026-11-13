// Mapped to spec: FR-RESP-006 — lets any text input (`TextField` or a bare `TextInput`) join the
// enclosing `FormScreen` / `FormScrollView` scope.
import { useEffect, useId, useRef } from 'react';
import type { TextInputProps } from 'react-native';
import type { TextInput } from '@kc/ui';
import type { FieldView } from '../../lib/platform/formFieldOrder';
import { useFormScopeContext } from './formScope';

const NOT_FOCUSABLE = (): boolean => false;
const NOTHING_TO_FOCUS = (): void => {};

interface ScopeFieldArgs {
  readonly inputRef: React.RefObject<TextInput | null>;
  /** The element measured for ordering and scrolling: the field's wrapper, or the input itself. */
  readonly viewRef: React.RefObject<FieldView | null>;
  readonly editable?: boolean;
  /** Whether the field currently shows a validation error. */
  readonly hasError?: boolean;
  readonly multiline?: boolean;
}

export interface FormScopeFieldProps {
  readonly onFocus: () => void;
  readonly onBlur: () => void;
  readonly onSubmitEditing: () => void;
  /** Spread on the `TextInput` *before* the caller's own props so those still win. */
  readonly inputProps: Partial<TextInputProps>;
}

/**
 * Registers the field with the form scope (no-op outside one, or when the form wires its own
 * toolbar), reports its error state, and supplies the return-key / toolbar props.
 * Call the returned `onFocus` / `onBlur` / `onSubmitEditing` from the input's handlers.
 */
export function useFormScopeField({
  inputRef,
  viewRef,
  editable = true,
  hasError = false,
  multiline = false,
}: ScopeFieldArgs): FormScopeFieldProps {
  const id = useId();
  const found = useFormScopeContext();
  const scope = found?.autoNavigation ? found : null;
  // The registry reads this lazily, so it always sees the latest render without re-registering.
  const editableRef = useRef(editable);
  editableRef.current = editable;
  const firstRender = useRef(true);
  const register = scope?.register;
  const setInvalid = scope?.setInvalid;

  useEffect(() => {
    return register?.(id, {
      focus: () => inputRef.current?.focus(),
      view: () => viewRef.current,
      isFocusable: () => editableRef.current,
    });
  }, [register, id, inputRef, viewRef]);

  useEffect(() => {
    // Skip the scroll on mount: only an error that appears later (a failed submit) should move the screen.
    setInvalid?.(id, hasError, !firstRender.current);
    firstRender.current = false;
  }, [setInvalid, id, hasError]);

  return {
    onFocus: () => scope?.notifyFocus(id),
    onBlur: () => scope?.notifyBlur(id),
    onSubmitEditing: () => scope?.submitEditing(id),
    inputProps: scope
      ? {
          inputAccessoryViewID: scope.accessoryId,
          // A multiline field keeps its newline key; the keyboard toolbar still moves between fields.
          ...(multiline ? {} : { returnKeyType: scope.canGoNext ? 'next' : 'done', blurOnSubmit: !scope.canGoNext }),
        }
      : {},
  };
}

/**
 * Lets a non-text part of a form (photo picker, city / street pickers, a chip group) take part in
 * "jump to the first problem": while `hasError` is true the form scrolls to `viewRef`.
 * Keyboard navigation skips it.
 */
export function useFormScopeAnchor(viewRef: React.RefObject<FieldView | null>, hasError: boolean): void {
  const id = useId();
  const scope = useFormScopeContext();
  const register = scope?.register;
  const setInvalid = scope?.setInvalid;
  const firstRender = useRef(true);

  useEffect(() => {
    return register?.(id, { focus: NOTHING_TO_FOCUS, view: () => viewRef.current, isFocusable: NOT_FOCUSABLE });
  }, [register, id, viewRef]);

  useEffect(() => {
    setInvalid?.(id, hasError, !firstRender.current);
    firstRender.current = false;
  }, [setInvalid, id, hasError]);
}
