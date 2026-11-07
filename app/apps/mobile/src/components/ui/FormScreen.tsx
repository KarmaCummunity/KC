// Scrollable form body + sticky footer that stays above the keyboard (FR-RESP-006).
import React, { useEffect, useMemo, useState } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';
import { makeUseStyles, spacing } from '@kc/ui';
import { useKeyboardVerticalOffset } from '../../lib/platform/useKeyboardVerticalOffset';
import {
  shellTabBarHeightPx,
  useShellTabBarVisibility,
} from '../../navigation/useShellTabBarVisibility';
import { KeyboardFormAccessory, type KeyboardFormAccessoryProps } from './KeyboardFormAccessory';

export interface FormScreenProps {
  readonly children: React.ReactNode;
  /** Primary CTA rendered below the scroll area (save / continue). */
  readonly footer?: React.ReactNode;
  readonly edges?: readonly Edge[];
  readonly headerless?: boolean;
  readonly headerHeight?: number;
  readonly contentContainerStyle?: StyleProp<ViewStyle>;
  readonly keyboardAccessory?: Omit<KeyboardFormAccessoryProps, 'nativeId'> & { nativeId?: string };
  readonly testID?: string;
  /** Inside an existing `Screen` — skip the outer SafeAreaView. */
  readonly embedded?: boolean;
  /**
   * Lift the sticky footer above the floating shell tab bar. No-op when the bar
   * is hidden. Safe-area bottom is handled by `edges` on the outer SafeAreaView.
   */
  readonly tabBarFooterInset?: boolean;
}

export function FormScreen({
  children,
  footer,
  edges = ['bottom'],
  headerless,
  headerHeight,
  contentContainerStyle,
  keyboardAccessory,
  testID,
  embedded,
  tabBarFooterInset = true,
}: FormScreenProps) {
  const styles = useFormScreenStyles();
  const keyboardOffset = useKeyboardVerticalOffset({ headerless, headerHeight });
  const tabBarVisible = useShellTabBarVisibility();
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  useEffect(() => {
    const show = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      () => setKeyboardOpen(true),
    );
    const hide = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      () => setKeyboardOpen(false),
    );
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  const footerTabBarLift =
    footer && tabBarFooterInset && !keyboardOpen ? shellTabBarHeightPx(tabBarVisible) : 0;
  const scrollStyles = useMemo(
    () => StyleSheet.flatten([styles.scrollContent, contentContainerStyle]),
    [contentContainerStyle, styles.scrollContent],
  );
  const Root = embedded ? View : SafeAreaView;
  const rootProps = embedded
    ? ({ style: styles.fill, testID } as const)
    : ({ style: styles.fill, edges, testID } as const);

  return (
    <Root {...rootProps}>
      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={keyboardOffset}
      >
        <View style={styles.fill}>
          <ScrollView
            style={styles.fill}
            contentContainerStyle={scrollStyles}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {children}
          </ScrollView>
          {keyboardAccessory ? <KeyboardFormAccessory {...keyboardAccessory} /> : null}
          {footer ? (
            <View
              testID="form-screen-footer"
              style={[styles.footer, footerTabBarLift > 0 && { paddingBottom: spacing.base + footerTabBarLift }]}
            >
              {footer}
            </View>
          ) : null}
        </View>
      </KeyboardAvoidingView>
    </Root>
  );
}

const useFormScreenStyles = makeUseStyles(({ colors }) => ({
  fill: { flex: 1, backgroundColor: colors.background },
  scrollContent: { padding: spacing.lg, gap: spacing.base, paddingBottom: spacing.lg },
  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.base,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
  },
}));
