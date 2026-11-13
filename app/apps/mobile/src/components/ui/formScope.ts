// Mapped to spec: FR-RESP-006 — every form gets (1) keyboard Next / Previous across its fields and
// (2) a jump to the first field with a problem, without per-form wiring.
//
// `FormScreen` creates a controller and provides it through `FormScopeContext`; each `TextField`
// registers itself on mount. Order is measured from the screen (reading order), so it never
// depends on the order fields were mounted or on a hand-maintained field count.
import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import {
  InteractionManager,
  Keyboard,
  Platform,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollView,
} from 'react-native';
import { KC_FORM_KEYBOARD_ACCESSORY_ID } from '../../lib/platform/formKeyboardConstants';
import {
  compareReadingOrder,
  measureFieldPosition,
  type FieldPosition,
  type FieldView,
} from '../../lib/platform/formFieldOrder';
import { SCROLL_TOP_PADDING, scrollFieldWithWindow, scrollWebFieldIntoView } from '../../lib/platform/scrollIntoView';

/** What a field lets the scope do with it. Read lazily: values must reflect the latest render. */
export interface FormFieldHandle {
  readonly focus: () => void;
  /** Outer view of the field (label + box + message); the unit that is measured and scrolled to. */
  readonly view: () => FieldView | null;
  /** False for disabled / read-only fields, which keyboard navigation skips. */
  readonly isFocusable: () => boolean;
}

export interface FormScopeValue {
  /** Whether a focusable field follows the focused one — drives the "next" vs "done" return key. */
  readonly canGoNext: boolean;
  /** True once the form holds 2+ text fields: only then is there anything to navigate between. */
  readonly multiField: boolean;
  readonly accessoryId: string;
  /** Props for the form's `ScrollView`, so a nested scroller can adopt this scope. */
  readonly scrollProps: FormScopeController['scrollProps'];
  register: (id: string, handle: FormFieldHandle) => () => void;
  notifyFocus: (id: string) => void;
  notifyBlur: (id: string) => void;
  /** `scroll` is false on the first render so a form that mounts already invalid does not jump. */
  setInvalid: (id: string, invalid: boolean, scroll: boolean) => void;
  /** Scroll to the top-most field showing an error (re-trigger after a failed submit with unchanged errors). */
  scrollToFirstInvalid: () => void;
  /** Return key pressed in field `id`: focus the next field, or close the keyboard after the last. */
  submitEditing: (id: string) => void;
}

export const FormScopeContext = createContext<FormScopeValue | null>(null);

/** `scrollToFirstInvalid` of the enclosing form; a no-op outside one. Call it when a submit is rejected. */
export function useScrollToFirstInvalid(): () => void {
  return useContext(FormScopeContext)?.scrollToFirstInvalid ?? noop;
}

function noop(): void {}

/** The enclosing form scope, or `null` outside a `FormScreen`. */
export function useFormScopeContext(): FormScopeValue | null {
  return useContext(FormScopeContext);
}

export interface FormScopeController {
  readonly scope: FormScopeValue;
  /** Spread on the form's `ScrollView`. */
  readonly scrollProps: {
    readonly ref: React.RefObject<ScrollView | null>;
    readonly onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
    readonly scrollEventThrottle: number;
  };
  /** Props for `KeyboardFormAccessory`. */
  readonly accessoryProps: {
    readonly canGoPrev: boolean;
    readonly canGoNext: boolean;
    /** Show the toolbar: a field of a multi-field form is focused. */
    readonly visible: boolean;
    readonly onPrev: () => void;
    readonly onNext: () => void;
    readonly onDone: () => void;
  };
  /** Same as `scope.scrollToFirstInvalid`, for the component that owns the controller. */
  readonly scrollToFirstInvalid: () => void;
}

interface OrderedField {
  readonly id: string;
  readonly handle: FormFieldHandle;
  readonly position: FieldPosition;
}

const SCROLL_EVENT_THROTTLE_MS = 16;

/** Mounted, measurable fields in reading order. */
async function orderedFields(
  fields: ReadonlyMap<string, FormFieldHandle>,
  onlyFocusable: boolean,
): Promise<OrderedField[]> {
  const entries = [...fields].filter(([, handle]) => !onlyFocusable || handle.isFocusable());
  const measured = await Promise.all(
    entries.map(async ([id, handle]) => ({ id, handle, position: await measureFieldPosition(handle.view()) })),
  );
  return measured
    .filter((row): row is OrderedField => row.position !== null)
    .sort((a, b) => compareReadingOrder(a.position, b.position));
}

/** Two frames (plus the interaction queue on Android) so layout settles after the keyboard closes. */
function afterLayout(run: () => void): void {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (Platform.OS === 'android') InteractionManager.runAfterInteractions(run);
      else run();
    });
  });
}

export function useFormScopeController(): FormScopeController {
  const scrollRef = useRef<ScrollView>(null);
  const scrollY = useRef(0);
  const fields = useRef(new Map<string, FormFieldHandle>());
  const invalidIds = useRef(new Set<string>());
  const activeId = useRef<string | null>(null);
  const scrollPending = useRef(false);
  const [nav, setNav] = useState({ canGoPrev: false, canGoNext: true });
  const [multiField, setMultiField] = useState(false);
  const [hasActiveField, setHasActiveField] = useState(false);

  const refreshNav = useCallback(async () => {
    const id = activeId.current;
    const ordered = await orderedFields(fields.current, true);
    const index = ordered.findIndex((row) => row.id === id);
    const next = { canGoPrev: index > 0, canGoNext: index >= 0 && index < ordered.length - 1 };
    setNav((prev) => (prev.canGoPrev === next.canGoPrev && prev.canGoNext === next.canGoNext ? prev : next));
  }, []);

  const move = useCallback(async (delta: 1 | -1) => {
    const ordered = await orderedFields(fields.current, true);
    const index = ordered.findIndex((row) => row.id === activeId.current);
    const target = ordered[index + delta];
    if (target) target.handle.focus();
    else if (delta > 0) Keyboard.dismiss();
  }, []);

  const scrollToFirstInvalid = useCallback(() => {
    const invalid = new Map([...fields.current].filter(([id]) => invalidIds.current.has(id)));
    if (invalid.size === 0) return;
    Keyboard.dismiss();
    afterLayout(async () => {
      const [first] = await orderedFields(invalid, false);
      const view = first?.handle.view();
      const scroll = scrollRef.current;
      if (!first || !view || !scroll) return;
      if (Platform.OS === 'web' && scrollWebFieldIntoView(view)) return;
      scrollFieldWithWindow(scroll, view, scrollY.current, SCROLL_TOP_PADDING);
    });
  }, []);

  const scheduleScrollToInvalid = useCallback(() => {
    // Batch: a failed submit flags several fields in one commit; scroll once, to the top-most.
    if (scrollPending.current) return;
    scrollPending.current = true;
    requestAnimationFrame(() => {
      scrollPending.current = false;
      scrollToFirstInvalid();
    });
  }, [scrollToFirstInvalid]);

  const register = useCallback((id: string, handle: FormFieldHandle) => {
    fields.current.set(id, handle);
    setMultiField(fields.current.size > 1);
    return () => {
      fields.current.delete(id);
      invalidIds.current.delete(id);
      setMultiField(fields.current.size > 1);
    };
  }, []);

  const notifyFocus = useCallback(
    (id: string) => {
      activeId.current = id;
      setHasActiveField(true);
      void refreshNav();
    },
    [refreshNav],
  );

  const notifyBlur = useCallback((id: string) => {
    if (activeId.current !== id) return;
    activeId.current = null;
    setHasActiveField(false);
  }, []);

  const setInvalid = useCallback(
    (id: string, invalid: boolean, scroll: boolean) => {
      if (!invalid) {
        invalidIds.current.delete(id);
        return;
      }
      const isNew = !invalidIds.current.has(id);
      invalidIds.current.add(id);
      // An error on the field being typed in (live validation) must not yank the screen away.
      if (isNew && scroll && activeId.current !== id) scheduleScrollToInvalid();
    },
    [scheduleScrollToInvalid],
  );

  const submitEditing = useCallback(() => void move(1), [move]);

  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    scrollY.current = event.nativeEvent.contentOffset.y;
  }, []);

  const scrollProps = useMemo(
    () => ({ ref: scrollRef, onScroll, scrollEventThrottle: SCROLL_EVENT_THROTTLE_MS }),
    [onScroll],
  );

  const scope = useMemo<FormScopeValue>(
    () => ({
      canGoNext: nav.canGoNext,
      multiField,
      scrollProps,
      accessoryId: KC_FORM_KEYBOARD_ACCESSORY_ID,
      register,
      notifyFocus,
      notifyBlur,
      setInvalid,
      scrollToFirstInvalid,
      submitEditing,
    }),
    [nav.canGoNext, multiField, scrollProps, register, notifyFocus, notifyBlur, setInvalid, scrollToFirstInvalid, submitEditing],
  );

  return {
    scope,
    scrollProps,
    accessoryProps: {
      canGoPrev: nav.canGoPrev,
      canGoNext: nav.canGoNext,
      visible: multiField && hasActiveField,
      onPrev: () => void move(-1),
      onNext: () => void move(1),
      onDone: Keyboard.dismiss,
    },
    scrollToFirstInvalid,
  };
}
