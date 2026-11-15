import React from 'react';
import { View } from 'react-native';
import { KcFlashList } from '../../../../../src/components/lists/KcFlashList';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { makeUseStyles, spacing, Text } from '@kc/ui';
import { isPostEnded } from '@kc/domain';
import { KcRowCard } from '../../../../../src/components/cards/KcRowCard';
import { Screen } from '../../../../../src/components/ui/Screen';
import { TimeWorldSubScreenChrome } from '../../../../../src/components/giving/TimeWorldSubScreenChrome';
import { PrimaryButton } from '../../../../../src/components/ui/Buttons';
import { volunteerUseCases } from '../../../../../src/services/volunteerComposition';
import { useShellTabBarScrollInset } from '../../../../../src/navigation/useShellTabBarVisibility';
import { createRouteFor } from '../../../../../src/lib/unifiedCreate/createCategories';

const useStyles = makeUseStyles(() => ({
  create: { margin: spacing.lg },
  empty: { padding: spacing.lg, textAlign: 'center' as const },
}));

const ROW = { marginHorizontal: spacing.lg };

export default function OrganizerVolunteerListScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const styles = useStyles();
  const inset = useShellTabBarScrollInset();
  const list = useQuery({
    queryKey: ['volunteer', 'organizer'],
    queryFn: () => volunteerUseCases.listOrganizer().execute(50),
  });

  return (
    <>
      <TimeWorldSubScreenChrome activeScreenTestId="time-organizer" />
      <Screen blobs="off" hasNativeHeader>
      <KcFlashList
        data={list.data ?? []}
        keyExtractor={(item) => item.opportunityId}
        contentContainerStyle={{ paddingBottom: inset }}
        ListHeaderComponent={
          <View style={styles.create}>
            <PrimaryButton
              label={t('timeVolunteer.createOpportunity')}
              size="md"
              // A new offer opens the one create form on the time world's offer side, where a member
              // of an organization also chooses between a volunteer shift and an event (G1 step 5).
              onPress={() => router.push(createRouteFor('time', 'give'))}
            />
          </View>
        }
        ListEmptyComponent={
          !list.isLoading ? (
            <Text style={styles.empty}>{t('timeVolunteer.organizerEmpty')}</Text>
          ) : null
        }
        renderItem={({ item }) => (
          <KcRowCard
            testID={`organizer-row-${item.opportunityId}`}
            containerStyle={ROW}
            tone="give"
            badgeLabel={t('marketplace.world.time', { defaultValue: 'time' })}
            placeholderIcon="time-outline"
            title={item.title}
            statusLabel={t(`marketplace.listingStatus.${item.status}`, { defaultValue: item.status })}
            closed={isPostEnded(item.status) || item.status === 'paused'}
            closedLabel={t('cards.closed')}
            onPress={() =>
              router.push({
                pathname: '/(tabs)/donations/time/organizer/[opportunityId]',
                params: { opportunityId: item.opportunityId },
              })
            }
          />
        )}
      />
      </Screen>
    </>
  );
}
