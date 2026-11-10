import React, { useEffect, useState } from 'react';
import {
  InputAccessoryView,
  Keyboard,
  Platform,
  Pressable,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { makeUseStyles, spacing, typography, Text } from '@kc/ui';
import { KC_FORM_KEYBOARD_ACCESSORY_ID } from '../../lib/platform/formKeyboardConstants';

interface ToolbarProps {
  readonly canGoPrev: boolean;
  readonly canGoNext: boolean;
  readonly onPrev: () => void;
  readonly onNext: () => void;
  readonly onDone: () => void;
}

function AccessoryToolbar({ canGoPrev, canGoNext, onPrev, onNext, onDone }: ToolbarProps) {
  const styles = useToolbarStyles();
  const { t } = useTranslation();
  return (
    <View style={styles.bar}>
      <Pressable
        onPress={onPrev}
        disabled={!canGoPrev}
        style={[styles.sideBtn, !canGoPrev && styles.sideBtnDisabled]}
        accessibilityRole="button"
        accessibilityLabel={t('common.formKeyboard.prev')}
      >
        <Text style={[styles.sideLabel, !canGoPrev && styles.sideLabelDisabled]}>
          {t('common.formKeyboard.prev')}
        </Text>
      </Pressable>
      <Pressable
        onPress={onDone}
        style={styles.doneBtn}
        accessibilityRole="button"
        accessibilityLabel={t('common.formKeyboard.done')}
      >
        <Text style={styles.doneLabel}>{t('common.formKeyboard.done')}</Text>
      </Pressable>
      <Pressable
        onPress={onNext}
        disabled={!canGoNext}
        style={[styles.sideBtn, !canGoNext && styles.sideBtnDisabled]}
        accessibilityRole="button"
        accessibilityLabel={t('common.formKeyboard.next')}
      >
        <Text style={[styles.sideLabel, !canGoNext && styles.sideLabelDisabled]}>
          {t('common.formKeyboard.next')}
        </Text>
      </Pressable>
    </View>
  );
}

export interface KeyboardFormAccessoryProps extends ToolbarProps {
  readonly nativeId?: string;
}

/** iOS: toolbar mounted in `InputAccessoryView`. Android: row shown while keyboard is open. */
export function KeyboardFormAccessory(props: KeyboardFormAccessoryProps) {
  const { nativeId = KC_FORM_KEYBOARD_ACCESSORY_ID, ...toolbar } = props;
  const styles = useToolbarStyles();
  const [keyboardOpen, setKeyboardOpen] = useState(false);

  useEffect(() => {
    if (Platform.OS === 'ios') return;
    const show = Keyboard.addListener(
      Platform.OS === 'android' ? 'keyboardDidShow' : 'keyboardWillShow',
      () => setKeyboardOpen(true),
    );
    const hide = Keyboard.addListener(
      Platform.OS === 'android' ? 'keyboardDidHide' : 'keyboardWillHide',
      () => setKeyboardOpen(false),
    );
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  if (Platform.OS === 'ios') {
    return (
      <InputAccessoryView nativeID={nativeId}>
        <AccessoryToolbar {...toolbar} />
      </InputAccessoryView>
    );
  }

  if (!keyboardOpen) return null;
  return (
    <View style={styles.androidWrap}>
      <AccessoryToolbar {...toolbar} />
    </View>
  );
}

const useToolbarStyles = makeUseStyles(({ colors }) => ({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
    minHeight: 44,
  },
  sideBtn: { minWidth: 72, paddingVertical: spacing.xs, alignItems: 'center' },
  sideBtnDisabled: { opacity: 0.35 },
  sideLabel: { ...typography.button, color: colors.primary },
  sideLabelDisabled: { color: colors.textDisabled },
  doneBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: spacing.sm,
    backgroundColor: colors.primarySurface,
  },
  doneLabel: { ...typography.button, color: colors.primary },
  androidWrap: { borderTopWidth: 1, borderTopColor: colors.border },
}));
