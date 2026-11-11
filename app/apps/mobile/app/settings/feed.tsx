// Settings → feed: mute keywords, worlds and people (feed_mute_filters),
// plus quiet hours for social notifications (0256).
import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Stack } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { makeUseStyles, spacing, typography, useTheme, Text } from '@kc/ui';
import { Chip, TextField } from '../../src/components/ui';
import { PrimaryButton } from '../../src/components/ui/Buttons';
import { useShellStackScreenOptions } from '../../src/navigation/shellStackScreenOptions';
import { rtlTextAlignStart } from '../../src/lib/rtlTextAlignStart';
import { rowDirectionStart } from '../../src/lib/rtlLayout';
import { webTextRtl, webViewRtl } from '../../src/lib/webRtlStyle';
import { container } from '../../src/lib/container';
import { useFeedMuteFilters } from '../../src/hooks/useFeedMuteFilters';
import { useNotificationPreferences } from '../../src/hooks/useNotificationPreferences';
import { FeedSettingsSection } from '../../src/components/settings/FeedSettingsSection';
import { FeedSettingsWorldsSection } from '../../src/components/settings/FeedSettingsWorldsSection';
import type { GivingWorldSlug } from '@kc/domain';
import { QuietHoursSection } from '../../src/components/settings/QuietHoursSection';
import {
  groupMuteFilters,
  isKeywordMuted,
  normalizeMuteKeyword,
} from '../../src/lib/feedMuteFilters';

export default function FeedSettingsScreen() {
  const options = useShellStackScreenOptions();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const styles = useStyles();
  const { list, add, remove } = useFeedMuteFilters();
  const { prefs, update } = useNotificationPreferences();
  const [draft, setDraft] = useState('');
  const [draftError, setDraftError] = useState<string | null>(null);

  const rows = useMemo(() => list.data ?? [], [list.data]);
  const grouped = useMemo(() => groupMuteFilters(rows), [rows]);
  const userIds = grouped.users.map((u) => u.filterValue);
  const names = useQuery({
    queryKey: ['feed-muted-user-names', userIds],
    enabled: userIds.length > 0,
    queryFn: async () => {
      const users = await Promise.all(userIds.map((id) => container.userRepo.findById(id).catch(() => null)));
      return Object.fromEntries(userIds.map((id, i) => [id, users[i]?.displayName ?? null]));
    },
  });

  const addKeyword = () => {
    const kw = normalizeMuteKeyword(draft);
    if (!kw) {
      setDraftError(t('feedSettings.keywordInvalid'));
      return;
    }
    if (isKeywordMuted(rows, kw)) {
      setDraftError(t('feedSettings.keywordDuplicate'));
      return;
    }
    setDraftError(null);
    setDraft('');
    add.mutate({ kind: 'keyword', value: kw });
  };

  return (
    <>
      <Stack.Screen
        options={{
          ...options,
          headerStyle: { backgroundColor: colors.surface },
          headerTintColor: colors.primary,
          headerTitle: t('feedSettings.title'),
        }}
      />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Text style={styles.intro}>{t('feedSettings.intro')}</Text>

        <FeedSettingsWorldsSection
          rows={rows}
          onAdd={(world: GivingWorldSlug) => add.mutate({ kind: 'world', value: world })}
          onRemove={(id) => remove.mutate(id)}
        />

        <FeedSettingsSection title={t('feedSettings.keywordsTitle')}>
          <View style={styles.addRow}>
            <TextField
              label={t('feedSettings.keywordPlaceholder')}
              containerStyle={styles.input}
              value={draft}
              onChangeText={(v) => {
                setDraft(v);
                if (draftError) setDraftError(null);
              }}
              onSubmitEditing={addKeyword}
              placeholder={t('feedSettings.keywordPlaceholder')}
              returnKeyType="done"
              maxLength={120}
              textAlign={rtlTextAlignStart}
              accessibilityLabel={t('feedSettings.keywordPlaceholder')}
              testID="feed-settings-keyword-input"
            />
            <PrimaryButton
              label={t('feedSettings.add')}
              size="md"
              onPress={addKeyword}
              testID="feed-settings-keyword-add"
            />
          </View>
          {draftError ? <Text style={styles.error}>{draftError}</Text> : null}
          <View style={styles.chips}>
            {grouped.keywords.length === 0 ? <Text style={styles.inlineHint}>{t('feedSettings.keywordsEmpty')}</Text> : null}
            {grouped.keywords.map((k) => (
              <Chip
                key={k.filterId}
                variant="removable"
                size="sm"
                label={k.filterValue}
                onRemove={() => remove.mutate(k.filterId)}
                removeAccessibilityLabel={t('feedSettings.unmuteA11y', { value: k.filterValue })}
              />
            ))}
          </View>
        </FeedSettingsSection>

        <FeedSettingsSection title={t('feedSettings.peopleTitle')}>
          {grouped.users.length === 0 ? (
            <Text style={styles.inlineHint}>{t('feedSettings.peopleEmpty')}</Text>
          ) : null}
          {grouped.users.map((u) => (
            <View key={u.filterId} style={styles.personRow}>
              <Text style={styles.personName} numberOfLines={1}>
                {names.data?.[u.filterValue] ?? t('feedSettings.unknownPerson')}
              </Text>
              <Pressable onPress={() => remove.mutate(u.filterId)} accessibilityRole="button" hitSlop={8}>
                <Text style={styles.link}>{t('feedSettings.unmute')}</Text>
              </Pressable>
            </View>
          ))}
        </FeedSettingsSection>

        <FeedSettingsSection title={t('notifications.quietHoursSection')}>
          <QuietHoursSection
            hideSectionTitle
            value={prefs.quietHours}
            onChange={(quietHours) => update({ quietHours })}
          />
        </FeedSettingsSection>
      </ScrollView>
    </>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  scroll: { flex: 1, backgroundColor: colors.background, ...webViewRtl },
  body: { padding: spacing.base, paddingBottom: spacing['3xl'], gap: spacing.lg, ...webViewRtl },
  intro: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: rtlTextAlignStart,
    marginBottom: spacing.sm,
    ...webTextRtl,
  },
  inlineHint: {
    ...typography.caption,
    color: colors.textDisabled,
    textAlign: rtlTextAlignStart,
    paddingHorizontal: spacing.base,
    paddingBottom: spacing.sm,
    ...webTextRtl,
  },
  error: {
    ...typography.caption,
    color: colors.error,
    paddingHorizontal: spacing.base,
    paddingBottom: spacing.sm,
    textAlign: rtlTextAlignStart,
    ...webTextRtl,
  },
  addRow: {
    flexDirection: rowDirectionStart,
    alignItems: 'flex-end' as const,
    gap: spacing.sm,
    paddingHorizontal: spacing.base,
    paddingBottom: spacing.sm,
    ...webViewRtl,
  },
  input: { flex: 1 },
  chips: {
    flexDirection: rowDirectionStart,
    flexWrap: 'wrap' as const,
    gap: spacing.sm,
    paddingHorizontal: spacing.base,
    paddingBottom: spacing.base,
    ...webViewRtl,
  },
  personRow: {
    flexDirection: rowDirectionStart,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    ...webViewRtl,
  },
  personName: { ...typography.body, color: colors.textPrimary, flex: 1, textAlign: rtlTextAlignStart, ...webTextRtl },
  link: { ...typography.body, color: colors.primary, ...typography.semiBold },
}));
