// Mapped to spec: docs/spec/10_challenges.md, 05 §5.12 — the challenges world: open community
// challenges, the ones I joined and the ones I opened. The launch-flag gate (D60) is in _layout.
import React, { useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { CHALLENGE_LIST_VIEWS, type ChallengeListView } from '@kc/domain';
import { makeUseStyles, spacing, typography, Text } from '@kc/ui';
import { KcFlashList } from '../../../../src/components/lists/KcFlashList';
import { Screen } from '../../../../src/components/ui/Screen';
import { Chip } from '../../../../src/components/ui/Chip';
import { PrimaryButton } from '../../../../src/components/ui/Buttons';
import { ChallengeRow } from '../../../../src/components/challenges/ChallengeRow';
import { CHALLENGES_QUERY_KEY, challengeUseCases } from '../../../../src/services/challengeComposition';
import { useShellTabBarScrollInset } from '../../../../src/navigation/useShellTabBarVisibility';
import { createRouteFor } from '../../../../src/lib/unifiedCreate/createCategories';
import { rowDirectionStart } from '../../../../src/lib/rtlLayout';
import { rtlTextAlignStart } from '../../../../src/lib/rtlTextAlignStart';

const useStyles = makeUseStyles(({ colors }) => ({
  header: { padding: spacing.lg, gap: spacing.md },
  intro: { ...typography.body, color: colors.textSecondary, textAlign: rtlTextAlignStart },
  chips: { flexDirection: rowDirectionStart, flexWrap: 'wrap', gap: spacing.sm },
  empty: { ...typography.body, color: colors.textSecondary, textAlign: 'center', padding: spacing.lg },
}));

export default function ChallengesWorldScreen() {
  const { t } = useTranslation();
  const styles = useStyles();
  const router = useRouter();
  const inset = useShellTabBarScrollInset();
  const [view, setView] = useState<ChallengeListView>('discover');
  const challenges = useQuery({
    queryKey: [CHALLENGES_QUERY_KEY, 'list', view],
    queryFn: () => challengeUseCases.list().execute(view),
  });

  return (
    <Screen blobs="content">
      <KcFlashList
        data={challenges.data ?? []}
        keyExtractor={(item) => item.challengeId}
        contentContainerStyle={{ paddingBottom: inset }}
        ListHeaderComponent={
          <View style={styles.header}>
            <Text style={styles.intro}>{t('challenges.intro')}</Text>
            <PrimaryButton
              label={t('challenges.openChallenge')}
              fullWidth
              onPress={() => router.push(createRouteFor('challenges'))}
              testID="challenges-open"
            />
            <View style={styles.chips}>
              {CHALLENGE_LIST_VIEWS.map((value) => (
                <Chip
                  key={value}
                  label={t(`challenges.views.${value}`)}
                  selected={value === view}
                  onPress={() => setView(value)}
                  testID={`challenges-view-${value}`}
                />
              ))}
            </View>
          </View>
        }
        ListEmptyComponent={
          <Text style={styles.empty}>
            {challenges.isLoading ? t('challenges.loading') : t(`challenges.empty.${view}`)}
          </Text>
        }
        renderItem={({ item }) => (
          <ChallengeRow
            challenge={item}
            onPress={(challengeId) =>
              router.push({ pathname: '/(tabs)/donations/challenges/[challengeId]', params: { challengeId } })
            }
          />
        )}
      />
    </Screen>
  );
}

