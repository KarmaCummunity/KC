// Settings → feed: mute keywords, categories and people (0281/0283 feed_mute_filters),
// plus quiet hours for social notifications (0256).
import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Stack } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ALL_CATEGORIES } from '@kc/domain';
import { makeUseStyles, radius, spacing, typography, useTheme, Text } from '@kc/ui';
import { Chip, TextField } from '../../src/components/ui';
import { useDetailStackScreenOptions } from '../../src/navigation/detailStackScreenOptions';
import { rtlTextAlignStart } from '../../src/lib/rtlTextAlignStart';
import { rowDirectionStart } from '../../src/lib/rtlLayout';
import { container } from '../../src/lib/container';
import { useFeedMuteFilters } from '../../src/hooks/useFeedMuteFilters';
import { useNotificationPreferences } from '../../src/hooks/useNotificationPreferences';
import { QuietHoursSection } from '../../src/components/settings/QuietHoursSection';
import {
  findCategoryMute,
  groupMuteFilters,
  isKeywordMuted,
  normalizeMuteKeyword,
} from '../../src/lib/feedMuteFilters';

export default function FeedSettingsScreen() {
  const options = useDetailStackScreenOptions();
  const { t } = useTranslation();
  const styles = useStyles();
  const { colors } = useTheme();
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
      <Stack.Screen options={{ ...options, headerTitle: t('feedSettings.title') }} />
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Text style={styles.intro}>{t('feedSettings.intro')}</Text>

        <Text style={styles.header}>{t('feedSettings.keywordsTitle')}</Text>
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
          <Pressable style={styles.addBtn} onPress={addKeyword} accessibilityRole="button" testID="feed-settings-keyword-add">
            <Text style={styles.addBtnText}>{t('feedSettings.add')}</Text>
          </Pressable>
        </View>
        {draftError ? <Text style={styles.error}>{draftError}</Text> : null}
        <View style={styles.chips}>
          {grouped.keywords.length === 0 ? <Text style={styles.hint}>{t('feedSettings.keywordsEmpty')}</Text> : null}
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

        <Text style={styles.header}>{t('feedSettings.categoriesTitle')}</Text>
        <Text style={styles.hint}>{t('feedSettings.categoriesHint')}</Text>
        <View style={styles.chips}>
          {ALL_CATEGORIES.map((c) => {
            const muted = findCategoryMute(rows, c);
            return (
              <Chip
                key={c}
                selected={Boolean(muted)}
                onPress={() => (muted ? remove.mutate(muted.filterId) : add.mutate({ kind: 'category', value: c }))}
                label={t(`post.category.${c}`)}
                icon={muted ? 'eye-off-outline' : undefined}
              />
            );
          })}
        </View>

        <Text style={styles.header}>{t('feedSettings.peopleTitle')}</Text>
        {grouped.users.length === 0 ? <Text style={styles.hint}>{t('feedSettings.peopleEmpty')}</Text> : null}
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

        <QuietHoursSection value={prefs.quietHours} onChange={(quietHours) => update({ quietHours })} />
      </ScrollView>
    </>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  body: { paddingBottom: spacing['2xl'] },
  intro: { ...typography.body, color: colors.textSecondary, padding: spacing.base, textAlign: rtlTextAlignStart },
  header: {
    ...typography.caption,
    color: colors.textSecondary,
    paddingHorizontal: spacing.base,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
    textAlign: rtlTextAlignStart,
  },
  hint: { ...typography.caption, color: colors.textDisabled, paddingHorizontal: spacing.base, textAlign: rtlTextAlignStart },
  error: { ...typography.caption, color: colors.error, paddingHorizontal: spacing.base, textAlign: rtlTextAlignStart },
  addRow: { flexDirection: rowDirectionStart, gap: spacing.sm, paddingHorizontal: spacing.base },
  input: {
    flex: 1,
  },
  addBtn: {
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    justifyContent: 'center' as const,
  },
  addBtnText: { ...typography.body, color: colors.textInverse, ...typography.semiBold },
  chips: { flexDirection: rowDirectionStart, flexWrap: 'wrap' as const, gap: spacing.sm, padding: spacing.base },
  personRow: {
    flexDirection: rowDirectionStart,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm,
  },
  personName: { ...typography.body, color: colors.textPrimary, flex: 1 },
  link: { ...typography.body, color: colors.primary, ...typography.semiBold },
}));
