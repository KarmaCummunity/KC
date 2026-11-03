// Building blocks shared by the kit `Modal` and `BottomSheet` (spec 17 §4.1, issue #1284).
//
// - `useOverlayLifecycle` — dismissal (backdrop, Android back, web Escape),
//   the app-wide open-modal count, and the open animation under reduced motion.
// - `useFocusTitleOnOpen` — moves the screen-reader focus to the title on open.
// - `OverlayBackdrop`     — the dimmed, tappable layer behind the surface.
// - `OverlayHeader`       — title row with the accessible close control.
import React, { useCallback, useEffect } from 'react';
import { AccessibilityInfo, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { iconSize, makeUseStyles, radius, spacing, typography, useTheme, Text } from '@kc/ui';
import { useModalHardwareBack } from '../../hooks/useModalHardwareBack';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { rtlTextAlignStart } from '../../lib/rtlTextAlignStart';
import { MIN_TAP_TARGET } from './kitMetrics';

/** Delay before moving screen-reader focus, so the native modal window has mounted. */
const FOCUS_DELAY_MS = 300;

export interface OverlayLifecycle {
  /** Call for any dismiss gesture; a no-op while the overlay is not dismissible. */
  readonly requestClose: () => void;
  /** True when the OS asks for reduced motion: open and close without animating. */
  readonly reducedMotion: boolean;
}

/**
 * Dismissal and motion for an overlay.
 * Registers the overlay with the app's open-modal count (the legal consent gate
 * waits for it) and routes the Android hardware back button to `onDismiss`.
 * On web, React Native Web's `Modal` calls `onRequestClose` on Escape.
 */
export function useOverlayLifecycle(visible: boolean, dismissible: boolean, onDismiss: () => void): OverlayLifecycle {
  const reducedMotion = useReducedMotion();
  const requestClose = useCallback(() => {
    if (dismissible) onDismiss();
  }, [dismissible, onDismiss]);
  useModalHardwareBack(visible, requestClose);
  return { requestClose, reducedMotion };
}

/**
 * Native only: once the overlay opens, move VoiceOver / TalkBack focus to its
 * title so the dialog is announced. On web the `Modal` focus trap moves focus
 * inside, and the surface's `aria-label` names the dialog.
 */
export function useFocusTitleOnOpen(visible: boolean, titleRef: React.RefObject<View | null>): void {
  useEffect(() => {
    if (!visible || Platform.OS === 'web') return;
    const timer = setTimeout(() => {
      if (titleRef.current) AccessibilityInfo.sendAccessibilityEvent(titleRef.current, 'focus');
    }, FOCUS_DELAY_MS);
    return () => clearTimeout(timer);
  }, [visible, titleRef]);
}

/**
 * Dimmed layer behind the surface. Tapping it dismisses (when allowed). It is
 * hidden from assistive tech: the close control is the accessible way out.
 */
export function OverlayBackdrop({ onPress, testID }: Readonly<{ onPress: () => void; testID?: string }>) {
  const styles = useOverlayStyles();
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      style={styles.backdrop}
      aria-hidden
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      focusable={false}
    />
  );
}

interface OverlayHeaderProps {
  readonly title?: string;
  /** Close handler; the ✕ control is shown only when it is given. */
  readonly onClose?: () => void;
  /** Screen-reader name of the ✕ control. Defaults to the localized "Close". */
  readonly closeAccessibilityLabel?: string;
  /** Receives the title node so `useFocusTitleOnOpen` can focus it. */
  readonly titleRef?: React.RefObject<View | null>;
  readonly closeTestID?: string;
}

/**
 * Title on the reading-start side and the ✕ close control on the end side
 * (left in Hebrew). Renders nothing when there is neither a title nor a close.
 */
export function OverlayHeader({ title, onClose, closeAccessibilityLabel, titleRef, closeTestID }: OverlayHeaderProps) {
  const styles = useOverlayStyles();
  const { colors } = useTheme();
  const { t } = useTranslation();
  if (!title && !onClose) return null;
  return (
    // Plain `row`: native mirrors it under forceRTL and web inherits `dir="rtl"`,
    // so the title starts on the reading-start edge.
    <View style={styles.header}>
      {/* An empty title still takes the free space so the ✕ stays on the end side. */}
      <View style={styles.titleSlot} ref={titleRef} accessible={Boolean(title)}>
        {title ? (
          <Text style={styles.title} role="heading">
            {title}
          </Text>
        ) : null}
      </View>
      {onClose ? (
        <Pressable
          onPress={onClose}
          testID={closeTestID}
          role="button"
          aria-label={closeAccessibilityLabel ?? t('general.close')}
          style={({ pressed }) => [styles.close, pressed && styles.closePressed]}
        >
          <Ionicons name="close" size={iconSize['2xl']} color={colors.textSecondary} />
        </Pressable>
      ) : null}
    </View>
  );
}

export const useOverlayStyles = makeUseStyles(({ colors }) => ({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.overlay },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  titleSlot: { flex: 1 },
  title: { ...typography.h3, color: colors.textPrimary, textAlign: rtlTextAlignStart },
  // A full 44pt target; the negative end margin lines the glyph up with the
  // surface padding instead of pushing it inwards.
  close: {
    width: MIN_TAP_TARGET,
    height: MIN_TAP_TARGET,
    marginEnd: -spacing.sm,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closePressed: { backgroundColor: colors.skeleton },
}));
