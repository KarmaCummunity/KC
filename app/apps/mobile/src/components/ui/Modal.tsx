// Shared modal dialog — the one centred dialog for every screen (spec 17 §4.1, issue #1284).
//
//   <Modal visible={open} onDismiss={close} title="..." footer={<PrimaryButton ... />}>
//     <Text>...</Text>
//   </Modal>
//
// Anatomy: a dimmed backdrop (`colors.overlay`) and a centred surface
// (`surfaceRaised`, `radius.xl`, `shadow.modal`, a border in dark mode where the
// shadow does not show) holding the header (title + ✕), the body and an
// optional footer for actions. The surface stays inside the safe area.
//
// Dismissal: backdrop tap, the ✕ control, Android back and web Escape all call
// `onDismiss`. A blocking dialog (`dismissible={false}`) ignores all four and
// hides the ✕, so the footer actions are the only way out.
//
// Accessibility: on open, VoiceOver / TalkBack focus moves to the title and
// iOS keeps it inside the surface; on web the dialog element is named by the
// title and its focus trap moves focus inside. The ✕ is a named 44pt button.
// Motion: fades in, or appears instantly under reduced motion.
//
// This wraps React Native's `Modal`; app code uses this component (or
// `BottomSheet`) instead of a raw `<Modal` (brand guard `rawModal`).
import React, { useRef } from 'react';
import { Platform, Modal as RNModal, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { makeUseStyles, radius, shadow, spacing } from '@kc/ui';
import { OverlayBackdrop, OverlayHeader, useFocusTitleOnOpen, useOverlayLifecycle } from './overlayParts';

/** Widest the dialog grows on tablets and desktop web, in points (a layout size). */
const DIALOG_MAX_WIDTH = 440;

export interface ModalProps {
  /** Whether the dialog is shown. */
  readonly visible: boolean;
  /** Called on backdrop tap, the ✕ control, Android back and web Escape (when dismissible). */
  readonly onDismiss: () => void;
  /** Heading of the dialog; also its screen-reader name. */
  readonly title?: string;
  /** False makes the dialog blocking: no backdrop, back or ✕ dismissal. Defaults to true. */
  readonly dismissible?: boolean;
  /** Screen-reader name of the ✕ control. Defaults to the localized "Close". */
  readonly closeAccessibilityLabel?: string;
  /** Actions under the body (e.g. a primary and a ghost button). */
  readonly footer?: React.ReactNode;
  readonly children?: React.ReactNode;
  /** Test ID of the dialog surface; the backdrop and ✕ get `-backdrop` / `-close` suffixes. */
  readonly testID?: string;
}

/** Centred modal dialog in the brand style. Renders nothing while `visible` is false. */
export function Modal({
  visible,
  onDismiss,
  title,
  dismissible = true,
  closeAccessibilityLabel,
  footer,
  children,
  testID,
}: ModalProps) {
  const styles = useModalStyles();
  const insets = useSafeAreaInsets();
  const titleRef = useRef<View>(null);
  const { requestClose, reducedMotion } = useOverlayLifecycle(visible, dismissible, onDismiss);
  useFocusTitleOnOpen(visible, titleRef);

  // Keep the surface clear of notches and home indicators, with at least the base gutter.
  const safeFrame = {
    paddingTop: insets.top + spacing.base,
    paddingBottom: insets.bottom + spacing.base,
    paddingStart: insets.left + spacing.base,
    paddingEnd: insets.right + spacing.base,
  };

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
      <View style={[styles.frame, safeFrame]}>
        <OverlayBackdrop onPress={requestClose} testID={testID ? `${testID}-backdrop` : undefined} />
        {/* iOS: keep VoiceOver inside the surface while the dialog is open. */}
        <View testID={testID} style={styles.surface} accessibilityViewIsModal>
          <OverlayHeader
            title={title}
            onClose={dismissible ? onDismiss : undefined}
            closeAccessibilityLabel={closeAccessibilityLabel}
            titleRef={titleRef}
            closeTestID={testID ? `${testID}-close` : undefined}
          />
          {children}
          {footer ? <View style={styles.footer}>{footer}</View> : null}
        </View>
      </View>
    </RNModal>
  );
}

const useModalStyles = makeUseStyles(({ colors, isDark }) => ({
  frame: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  surface: {
    width: '100%',
    maxWidth: DIALOG_MAX_WIDTH,
    maxHeight: '100%',
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.xl,
    backgroundColor: colors.surfaceRaised,
    ...shadow.modal,
    shadowColor: colors.shadow,
    // The shadow is invisible on the dark backdrop, so dark mode outlines the surface instead.
    borderWidth: isDark ? 1 : 0,
    borderColor: colors.border,
  },
  footer: { gap: spacing.sm, marginTop: spacing.xs },
}));
