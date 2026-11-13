// FR-MOD-002 / FR-CHAT-007 AC3 — report a problem from Settings: an optional category and a
// description (10–500 characters) become a system message in the member's support thread,
// which opens right after. #2096: one submission per tap burst, failures keep the text.
import React, { useCallback, useState } from 'react';
import { Stack, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { SUPPORT_ISSUE_DESCRIPTION_MIN } from '@kc/application';
import { spacing, useTheme } from '@kc/ui';
import { FormScreen, PrimaryButton } from '../../src/components/ui';
import { ReportIssueForm } from '../../src/components/settings/ReportIssueForm';
import { NotifyModal } from '../../src/components/NotifyModal';
import { useShellStackScreenOptions } from '../../src/navigation/shellStackScreenOptions';
import { useReportIssueSubmit } from '../../src/hooks/useReportIssueSubmit';
import { webViewRtl } from '../../src/lib/webRtlStyle';

export default function ReportIssueScreen() {
  const shellStackScreenOptions = useShellStackScreenOptions();
  const router = useRouter();
  const { t } = useTranslation();
  const { colors } = useTheme();
  const [category, setCategory] = useState<string | null>(null);
  const [description, setDescription] = useState('');

  // Replace, not push: back from the support thread returns to Settings, not to a sent form.
  const openSupportThread = useCallback(
    (chatId: string) => router.replace({ pathname: '/chat/[id]', params: { id: chatId } }),
    [router],
  );
  const { busy, notify, submit, dismissNotify } = useReportIssueSubmit(openSupportThread);
  const isValid = description.trim().length >= SUPPORT_ISSUE_DESCRIPTION_MIN;

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
        testID="report-issue-screen"
        edges={['bottom', 'left', 'right']}
        contentContainerStyle={{ padding: spacing.base, gap: spacing.lg, paddingBottom: spacing.xl, ...webViewRtl }}
        footer={
          <PrimaryButton
            testID="report-issue-submit"
            label={busy ? t('settings.reportIssueScreen.submitting') : t('settings.reportIssueScreen.submitBtn')}
            onPress={() => void submit(category, description)}
            loading={busy}
            disabled={!isValid || busy}
            fullWidth
            icon="send-outline"
          />
        }
      >
        <ReportIssueForm
          category={category}
          onCategoryChange={setCategory}
          description={description}
          onDescriptionChange={setDescription}
        />
      </FormScreen>
      <NotifyModal
        visible={notify !== null}
        title={notify?.title ?? ''}
        message={notify?.message ?? ''}
        onDismiss={dismissNotify}
      />
    </>
  );
}
