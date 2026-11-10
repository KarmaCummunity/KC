// FR-MOD-002 / FR-CHAT-007 AC3 — collect description + category, submit
// support issue (injects system message), navigate to the support thread.
import React, { useState } from 'react';
import { View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { ChatError } from '@kc/application';
import { iconSize, makeUseStyles, typography, spacing, radius, useTheme, Text } from '@kc/ui';
import { Chip, TextField, FormScreen, PrimaryButton } from '../../src/components/ui';
import { useShellStackScreenOptions } from '../../src/navigation/shellStackScreenOptions';
import { Card } from '../../src/components/ui/Card';
import { container } from '../../src/lib/container';
import { NotifyModal } from '../../src/components/NotifyModal';
import { rtlTextAlignStart } from '../../src/lib/rtlTextAlignStart';
import { webTextRtl, webViewRtl } from '../../src/lib/webRtlStyle';
import { useTranslation } from 'react-i18next';
import { useFormFieldFocus } from '../../src/hooks/useFormFieldFocus';

const CATEGORIES = ['Bug', 'Account', 'Suggestion', 'Other'] as const;
const MAX_DESC = 500;

export default function ReportIssueScreen() {
  const shellStackScreenOptions = useShellStackScreenOptions();
  const router = useRouter();
  const { t } = useTranslation();
  const styles = useReportIssueScreenStyles();
  const { colors } = useTheme();
  const fieldFocus = useFormFieldFocus(1);
  const descField = fieldFocus.bindField(0);
  const [category, setCategory] = useState<string | null>(null);
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [notify, setNotify] = useState<{ title: string; message: string } | null>(null);

  const descTrimmed = description.trim();
  const isValid = descTrimmed.length >= 10;

  const submit = async () => {
    if (!isValid || busy) return;
    setBusy(true);
    try {
      const chat = await container.submitSupportIssue.execute({ category, description: descTrimmed });
      router.replace({ pathname: '/chat/[id]', params: { id: chat.chatId } });
    } catch (err) {
      const errorTitle = t('settings.reportIssueErrorTitle');
      if (err instanceof ChatError && err.code === 'super_admin_not_found') {
        setNotify({ title: errorTitle, message: t('settings.reportIssueScreen.errorAdminNotFound') });
      } else {
        setNotify({ title: errorTitle, message: t('settings.reportIssueScreen.errorGeneric') });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Stack.Screen
        options={{
          ...shellStackScreenOptions,
          headerStyle: { backgroundColor: colors.surface },
          headerTintColor: colors.primary,
          headerTitle: t('settings.reportIssueScreen.title'),
        }}
      />
      <FormScreen
        edges={['bottom', 'left', 'right']}
        contentContainerStyle={{ ...styles.body, ...webViewRtl }}
        keyboardAccessory={{
          canGoPrev: fieldFocus.canGoPrev,
          canGoNext: fieldFocus.canGoNext,
          onPrev: fieldFocus.focusPrev,
          onNext: fieldFocus.focusNext,
          onDone: fieldFocus.dismiss,
        }}
        footer={
          <PrimaryButton
            label={busy ? t('settings.reportIssueScreen.submitting') : t('settings.reportIssueScreen.submitBtn')}
            onPress={submit}
            loading={busy}
            disabled={!isValid}
            fullWidth
            icon="send-outline"
          />
        }
      >
        <View style={styles.introRow}>
          <View style={styles.introIcon}>
            <Ionicons name="chatbubbles-outline" size={iconSize.xl} color={colors.primary} />
          </View>
          <Text style={styles.copy}>{t('settings.reportIssueScreen.copy')}</Text>
        </View>

        <Card padding="base" style={styles.formCard}>
          <Text style={styles.label}>{t('settings.reportIssueScreen.categoryLabel')}</Text>
          <View style={styles.chips}>
            {CATEGORIES.map((cat) => {
              const selected = category === cat;
              return (
                <Chip
                  key={cat}
                  size="md"
                  selected={selected}
                  onPress={() => setCategory(selected ? null : cat)}
                  label={t(`settings.reportIssueScreen.categories.${cat}`)}
                />
              );
            })}
          </View>

          <TextField
            ref={descField.ref}
            label={t('settings.reportIssueScreen.descriptionLabel')}
            style={styles.input}
            multiline
            numberOfLines={6}
            placeholder={t('settings.reportIssueScreen.descriptionPlaceholder')}
            placeholderTextColor={colors.textSecondary}
            value={description}
            onChangeText={setDescription}
            textAlign={rtlTextAlignStart as 'left' | 'right'}
            maxLength={MAX_DESC}
            onFocus={descField.onFocus}
            inputAccessoryViewID={descField.inputAccessoryViewID}
            returnKeyType={descField.returnKeyType}
            blurOnSubmit={descField.blurOnSubmit}
            onSubmitEditing={descField.onSubmitEditing}
          />
          <View style={styles.inputFooter}>
            {descTrimmed.length > 0 && descTrimmed.length < 10 ? (
              <Text style={styles.hint}>{t('settings.reportIssueScreen.descriptionMinLength')}</Text>
            ) : (
              <View />
            )}
            <Text style={styles.counter}>{`${description.length}/${MAX_DESC}`}</Text>
          </View>
        </Card>
      </FormScreen>
      <NotifyModal
        visible={notify !== null}
        title={notify?.title ?? ''}
        message={notify?.message ?? ''}
        onDismiss={() => setNotify(null)}
      />
    </>
  );
}

const useReportIssueScreenStyles = makeUseStyles(({ colors }) => ({
  body: { padding: spacing.base, gap: spacing.lg, paddingBottom: spacing.xl, ...webViewRtl },
  introRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    ...webViewRtl,
  },
  introIcon: {
    width: 44,
    height: 44,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primaryLight,
  },
  copy: {
    ...typography.body,
    flex: 1,
    color: colors.textSecondary,
    textAlign: rtlTextAlignStart,
    lineHeight: 22,
    ...webTextRtl,
  },
  formCard: { gap: spacing.sm, ...webViewRtl },
  label: {
    ...typography.bodySmall,
    color: colors.textPrimary,
    ...typography.semiBold,
    textAlign: rtlTextAlignStart,
    width: '100%',
    ...webTextRtl,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, ...webViewRtl },
  input: {
    minHeight: 140,
    textAlignVertical: 'top',
  },
  inputFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    ...webViewRtl,
  },
  hint: {
    ...typography.caption,
    color: colors.error,
    flex: 1,
    textAlign: rtlTextAlignStart,
    ...webTextRtl,
  },
  counter: { ...typography.caption, color: colors.textSecondary, fontVariant: ['tabular-nums'] },
}));
