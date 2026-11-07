// Scrollable form body + sticky footer that stays above the keyboard (FR-RESP-006).
import React, { useMemo } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';
import { makeUseStyles, spacing } from '@kc/ui';
import { useKeyboardVerticalOffset } from '../../lib/platform/useKeyboardVerticalOffset';
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
}: FormScreenProps) {
  const styles = useFormScreenStyles();
  const keyboardOffset = useKeyboardVerticalOffset({ headerless, headerHeight });
  const scrollStyles = useMemo(
    () => [styles.scrollContent, contentContainerStyle],
    [contentContainerStyle, styles.scrollContent],
  );

  return (
    <SafeAreaView style={styles.fill} edges={edges} testID={testID}>
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
          {footer ? <View style={styles.footer}>{footer}</View> : null}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
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
