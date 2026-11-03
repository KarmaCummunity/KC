// Shared bottom sheet — the one sheet for menus, pickers and short forms (spec 17 §4.1, issue #1284).
//
//   <BottomSheet visible={open} onDismiss={close} title="..." footer={<PrimaryButton ... />}>
//     {options}
//   </BottomSheet>
//
// Anatomy: a dimmed backdrop (`colors.overlay`) and a surface docked to the
// bottom edge (`surfaceRaised`, top corners `radius.xl`, `shadow.modal`, a
// border in dark mode) with a grab handle, the header (title + ✕), a scrolling
// body and an optional footer. The surface pads itself above the home
// indicator, lifts with the keyboard on iOS, and stops at 640pt wide on
// tablets / desktop web so it does not stretch across the screen.
//
// Dismissal: backdrop tap, the ✕ control, Android back and web Escape all call
// `onDismiss`; `dismissible={false}` ignores all four and hides the ✕.
//
// Motion: the backdrop fades and the surface slides up from the bottom edge.
// Under reduced motion both appear instantly.
//
// Accessibility: on open, VoiceOver / TalkBack focus moves to the title and
// iOS keeps it inside the sheet; on web the dialog element is named by the
// title and its focus trap moves focus inside. The ✕ is a named 44pt button;
// the grab handle is decorative and hidden from assistive tech.
import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Easing,
  KeyboardAvoidingView,
  Modal as RNModal,
  type DimensionValue,
  Platform,
  ScrollView,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { makeUseStyles, radius, shadow, shellDimensions, spacing } from '@kc/ui';
import { OverlayBackdrop, OverlayHeader, useFocusTitleOnOpen, useOverlayLifecycle } from './overlayParts';

/** Slide-up duration, in milliseconds. */
const SLIDE_IN_MS = 260;
/** Grab handle size, in points (a layout size). */
const HANDLE_WIDTH = 36;
const HANDLE_HEIGHT = 4;

export interface BottomSheetProps {
  /** Whether the sheet is shown. */
  readonly visible: boolean;
  /** Called on backdrop tap, the ✕ control, Android back and web Escape (when dismissible). */
  readonly onDismiss: () => void;
  /** Heading of the sheet; also its screen-reader name. */
  readonly title?: string;
  /** False makes the sheet blocking: no backdrop, back or ✕ dismissal. Defaults to true. */
  readonly dismissible?: boolean;
  /** Screen-reader name of the ✕ control. Defaults to the localized "Close". */
  readonly closeAccessibilityLabel?: string;
  /**
   * Wrap the body in a ScrollView (default). Pass false when the body brings
   * its own virtualized list (FlatList / SectionList), which must not nest in a ScrollView.
   */
  readonly scrollable?: boolean;
  /**
   * Cap on the surface height, as a share of the screen (e.g. `'60%'`) for a
   * compact sheet that keeps the screen behind it in view. Defaults to the
   * full height under the status-bar gap.
   */
  readonly maxHeight?: DimensionValue;
  /** Actions pinned under the body (they do not scroll away). */
  readonly footer?: React.ReactNode;
  readonly children?: React.ReactNode;
  /** Test ID of the sheet surface; the backdrop and ✕ get `-backdrop` / `-close` suffixes. */
  readonly testID?: string;
}

/**
 * Slide-up for the surface: 0 → 1 while the sheet opens. Starts fully open
 * under reduced motion. The value restarts each time the sheet becomes visible.
 */
function useSlideIn(visible: boolean, reducedMotion: boolean): Animated.Value {
  const progress = useRef(new Animated.Value(reducedMotion ? 1 : 0)).current;
  useEffect(() => {
    if (!visible) return;
    if (reducedMotion) {
      progress.setValue(1);
      return;
    }
    progress.setValue(0);
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: SLIDE_IN_MS,
      easing: Easing.out(Easing.cubic),
      // RN-Web has no native animation driver.
      useNativeDriver: Platform.OS !== 'web',
    });
    animation.start();
    return () => animation.stop();
  }, [visible, reducedMotion, progress]);
  return progress;
}

/** Bottom-docked modal sheet in the brand style. Renders nothing while `visible` is false. */
export function BottomSheet({
  visible,
  onDismiss,
  title,
  dismissible = true,
  closeAccessibilityLabel,
  scrollable = true,
  maxHeight,
  footer,
  children,
  testID,
}: BottomSheetProps) {
  const styles = useSheetStyles();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const titleRef = useRef<View>(null);
  const { requestClose, reducedMotion } = useOverlayLifecycle(visible, dismissible, onDismiss);
  const progress = useSlideIn(visible, reducedMotion);
  useFocusTitleOnOpen(visible, titleRef);

  // Starts one window height below its resting place, i.e. fully off screen.
  const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [windowHeight, 0] });

  return (
    <RNModal
      visible={visible}
      transparent
      // Draw under the Android status bar so the backdrop dims the whole screen.
      statusBarTranslucent
      animationType={reducedMotion ? 'none' : 'fade'}
      onRequestClose={requestClose}
      // Web: React Native Web renders this wrapper as the `role="dialog"` element; name it by the title.
      aria-label={Platform.OS === 'web' ? title : undefined}
    >
      <KeyboardAvoidingView
        // iOS only: Android resizes the window for the keyboard itself.
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={[styles.frame, { paddingTop: insets.top + spacing['3xl'] }]}
      >
        <OverlayBackdrop onPress={requestClose} testID={testID ? `${testID}-backdrop` : undefined} />
        <Animated.View
          testID={testID}
          // iOS: keep VoiceOver inside the sheet while it is open.
          accessibilityViewIsModal
          style={[
            styles.surface,
            maxHeight !== undefined && { maxHeight },
            // Clear the home indicator / gesture bar, with at least the base gutter.
            { paddingBottom: insets.bottom + spacing.base, transform: [{ translateY }] },
          ]}
        >
          <View style={styles.handle} aria-hidden importantForAccessibility="no-hide-descendants" />
          <OverlayHeader
            title={title}
            onClose={dismissible ? onDismiss : undefined}
            closeAccessibilityLabel={closeAccessibilityLabel}
            titleRef={titleRef}
            closeTestID={testID ? `${testID}-close` : undefined}
          />
          {scrollable ? (
            <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent} keyboardShouldPersistTaps="handled">
              {children}
            </ScrollView>
          ) : (
            <View style={styles.body}>{children}</View>
          )}
          {footer ? <View style={styles.footer}>{footer}</View> : null}
        </Animated.View>
      </KeyboardAvoidingView>
    </RNModal>
  );
}

const useSheetStyles = makeUseStyles(({ colors, isDark }) => ({
  frame: { flex: 1, justifyContent: 'flex-end', alignItems: 'center' },
  surface: {
    width: '100%',
    maxWidth: shellDimensions.contentMaxTablet,
    maxHeight: '100%',
    gap: spacing.md,
    paddingTop: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderTopStartRadius: radius.xl,
    borderTopEndRadius: radius.xl,
    backgroundColor: colors.surfaceRaised,
    ...shadow.modal,
    shadowColor: colors.shadow,
    // The shadow is invisible on the dark backdrop, so dark mode outlines the top and sides instead.
    borderWidth: isDark ? 1 : 0,
    borderBottomWidth: 0,
    borderColor: colors.border,
  },
  handle: {
    alignSelf: 'center',
    width: HANDLE_WIDTH,
    height: HANDLE_HEIGHT,
    borderRadius: radius.full,
    backgroundColor: colors.borderStrong,
  },
  // `flexShrink` lets a long body scroll inside the capped surface height.
  body: { flexShrink: 1 },
  bodyContent: { gap: spacing.sm },
  footer: { gap: spacing.sm },
}));
