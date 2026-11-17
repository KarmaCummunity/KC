// Mapped to spec: FR-RESP-006 — every form gets (1) keyboard Next / Previous across its fields and
// (2) a jump to the first field with a problem, without per-form wiring.
//
// A `FormScope` (mounted by `Screen`, `FormScreen`, `FormScrollView`, `BottomSheet` and `Modal`)
// creates a controller and provides it through `FormScopeContext`; each field registers itself on
// mount. Order is measured from the screen (reading order), so it never depends on the order fields
// were mounted or on a hand-maintained field count.
import { createContext, useCallback, useContext, useId, useMemo, useRef, useState } from 'react';
import {
  InteractionManager,
  Keyboard,
  Platform,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollView,
} from 'react-native';
import {
  measureFieldPosition,
  sortByReadingOrder,
  type FieldPosition,
  type FieldView,
} from '../../lib/platform/formFieldOrder';
import {
  SCROLL_TOP_PADDING,
  focusForScreenReader,
  scrollFieldWithWindow,
  scrollWebFieldIntoView,
} from '../../lib/platform/scrollIntoView';

/** What a field lets the scope do with it. Read lazily: values must reflect the latest render. */
export interface FormFieldHandle {
  readonly focus: () => void;
  /** Outer view of the field (label + box + message); the unit that is measured and scrolled to. */
  readonly view: () => FieldView | null;
  /** False for disabled / read-only fields, which keyboard navigation skips. */
  readonly isFocusable: () => boolean;
}

export interface FormScopeValue {
  /** Last focusable field in reading order (null until measured): it gets "done", the others "next". */
  readonly lastFocusableId: string | null;
  /** True once the form holds 2+ text fields: only then is there anything to navigate between. */
  readonly multiField: boolean;
  /** iOS `inputAccessoryViewID` of this scope's toolbar; unique per scope so stacked forms never share one. */
  readonly accessoryId: string;
  /** Props for the form's `ScrollView`, so a nested scroller can adopt this scope. */
  readonly scrollProps: FormScopeController['scrollProps'];
  register: (id: string, handle: FormFieldHandle) => () => void;
  notifyFocus: (id: string) => void;
  notifyBlur: (id: string) => void;
  /** Report a field's error state; `appeared` is true only when the error is new since its last render. */
  setInvalid: (id: string, invalid: boolean, appeared: boolean) => void;
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

/** The enclosing form scope, or `null` outside a form. */
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
    readonly nativeId: string;
    /** iOS mounts the toolbar only when there is something to navigate between. */
    readonly enabled: boolean;
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
/** An error that appears this soon after its field lost focus is validate-on-blur, not a rejected submit. */
export const BLUR_VALIDATION_WINDOW_MS = 500;

/** Mounted, measurable fields in reading order. */
async function orderedFields(
  fields: ReadonlyMap<string, FormFieldHandle>,
  onlyFocusable: boolean,
): Promise<OrderedField[]> {
  const entries = [...fields].filter(([, handle]) => !onlyFocusable || handle.isFocusable());
  const measured = await Promise.all(
    entries.map(async ([id, handle]) => ({ id, handle, position: await measureFieldPosition(handle.view()) })),
  );
  return sortByReadingOrder(measured.filter((row): row is OrderedField => row.position !== null));
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
  const accessoryId = `kc-form-keyboard-${useId()}`;
  const scrollRef = useRef<ScrollView>(null);
  const scrollY = useRef(0);
  const fields = useRef(new Map<string, FormFieldHandle>());
  const invalidIds = useRef(new Set<string>());
  /** Errors that appeared since the last scheduled jump; filtered when the jump runs. */
  const appearedIds = useRef(new Set<string>());
  const activeId = useRef<string | null>(null);
  const lastBlur = useRef<{ id: string; at: number } | null>(null);
  const jumpPending = useRef<'explicit' | 'appeared' | null>(null);
  const [nav, setNav] = useState({ canGoPrev: false, canGoNext: true, lastFocusableId: null as string | null });
  const [multiField, setMultiField] = useState(false);
  const [hasActiveField, setHasActiveField] = useState(false);

  const refreshNav = useCallback(async () => {
    const id = activeId.current;
    const ordered = await orderedFields(fields.current, true);
    // A newer focus started while this one measured: its own refresh owns the state.
    if (activeId.current !== id) return;
    const index = ordered.findIndex((row) => row.id === id);
    const next = {
      canGoPrev: index > 0,
      canGoNext: index >= 0 && index < ordered.length - 1,
      lastFocusableId: ordered[ordered.length - 1]?.id ?? null,
    };
    setNav((prev) =>
      prev.canGoPrev === next.canGoPrev && prev.canGoNext === next.canGoNext && prev.lastFocusableId === next.lastFocusableId
        ? prev
        : next,
    );
  }, []);

  const move = useCallback(async (fromId: string | null, delta: 1 | -1) => {
    const ordered = await orderedFields(fields.current, true);
    const index = ordered.findIndex((row) => row.id === fromId);
    // The field was disabled or removed meanwhile: there is no "next" to it, and the top is not it.
    if (index < 0) return;
    const target = ordered[index + delta];
    if (target) target.handle.focus();
    else if (delta > 0) Keyboard.dismiss();
  }, []);

  const jumpNow = useCallback(() => {
    const invalid = new Map([...fields.current].filter(([id]) => invalidIds.current.has(id)));
    if (invalid.size === 0) return;
    Keyboard.dismiss();
    afterLayout(async () => {
      const [first] = await orderedFields(invalid, false);
      const view = first?.handle.view();
      if (!view) return;
      const scroll = scrollRef.current;
      if (Platform.OS === 'web' && scrollWebFieldIntoView(view)) return;
      if (scroll) scrollFieldWithWindow(scroll, view, scrollY.current, SCROLL_TOP_PADDING);
      focusForScreenReader(view);
    });
  }, []);

  /** An error that showed up only because its field was just left (validate-on-blur) while another is typed in. */
  const isBlurValidation = useCallback((id: string) => {
    const blur = lastBlur.current;
    const recent = blur !== null && blur.id === id && Date.now() - blur.at < BLUR_VALIDATION_WINDOW_MS;
    return recent && activeId.current !== null && activeId.current !== id;
  }, []);

  // Batch to one frame: a failed submit flags several fields in one commit (and a bumped submit
  // signal lands in the same commit), so the screen scrolls once, to the top-most problem.
  const scheduleJump = useCallback(
    (kind: 'explicit' | 'appeared') => {
      if (jumpPending.current === 'explicit') return;
      const alreadyScheduled = jumpPending.current !== null;
      jumpPending.current = kind;
      if (alreadyScheduled) return;
      requestAnimationFrame(() => {
        const explicit = jumpPending.current === 'explicit';
        jumpPending.current = null;
        const appeared = [...appearedIds.current];
        appearedIds.current.clear();
        // Live validation must not yank the screen away from the field being typed in.
        const worthJumping = appeared.some((id) => id !== activeId.current && !isBlurValidation(id));
        if (explicit || worthJumping) jumpNow();
      });
    },
    [jumpNow, isBlurValidation],
  );

  const scrollToFirstInvalid = useCallback(() => scheduleJump('explicit'), [scheduleJump]);

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
    lastBlur.current = { id, at: Date.now() };
    if (activeId.current !== id) return;
    activeId.current = null;
    setHasActiveField(false);
  }, []);

  const setInvalid = useCallback(
    (id: string, invalid: boolean, appeared: boolean) => {
      if (!invalid) {
        invalidIds.current.delete(id);
        return;
      }
      invalidIds.current.add(id);
      if (!appeared) return;
      appearedIds.current.add(id);
      scheduleJump('appeared');
    },
    [scheduleJump],
  );

  const submitEditing = useCallback((id: string) => void move(id, 1), [move]);

  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    scrollY.current = event.nativeEvent.contentOffset.y;
  }, []);

  const scrollProps = useMemo(
    () => ({ ref: scrollRef, onScroll, scrollEventThrottle: SCROLL_EVENT_THROTTLE_MS }),
    [onScroll],
  );

  const scope = useMemo<FormScopeValue>(
    () => ({
      lastFocusableId: nav.lastFocusableId,
      multiField,
      scrollProps,
      accessoryId,
      register,
      notifyFocus,
      notifyBlur,
      setInvalid,
      scrollToFirstInvalid,
      submitEditing,
    }),
    [nav.lastFocusableId, multiField, scrollProps, accessoryId, register, notifyFocus, notifyBlur, setInvalid, scrollToFirstInvalid, submitEditing],
  );

  return {
    scope,
    scrollProps,
    accessoryProps: {
      nativeId: accessoryId,
      enabled: multiField,
      canGoPrev: nav.canGoPrev,
      canGoNext: nav.canGoNext,
      visible: multiField && hasActiveField,
      onPrev: () => void move(activeId.current, -1),
      onNext: () => void move(activeId.current, 1),
      onDone: Keyboard.dismiss,
    },
    scrollToFirstInvalid,
  };
}
