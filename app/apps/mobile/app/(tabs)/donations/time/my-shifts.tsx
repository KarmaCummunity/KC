import React from 'react';
import { Pressable } from 'react-native';
import { KcRowCard } from '../../../../src/components/cards/KcRowCard';
import { KcFlashList } from '../../../../src/components/lists/KcFlashList';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { makeUseStyles, spacing, typography, Text } from '@kc/ui';
import { Screen } from '../../../../src/components/ui/Screen';
import { TimeWorldSubScreenChrome } from '../../../../src/components/giving/TimeWorldSubScreenChrome';
import { volunteerUseCases } from '../../../../src/services/volunteerComposition';
import { useShellTabBarScrollInset } from '../../../../src/navigation/useShellTabBarVisibility';

const useStyles = makeUseStyles(({ colors }) => ({
  action: { ...typography.bodySmall, ...typography.semiBold, color: colors.primary },
}));

const ROW = { marginHorizontal: spacing.lg };

function statusLabel(status: string, t: (k: string) => string) {
  if (status === 'waitlisted') return t('timeVolunteer.statusWaitlisted');
  if (status === 'checked_in') return t('timeVolunteer.statusCheckedIn');
  return t('timeVolunteer.statusRegistered');
}

export default function MyVolunteerShiftsScreen() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const styles = useStyles();
  const inset = useShellTabBarScrollInset();
  const qc = useQueryClient();
  const signups = useQuery({
    queryKey: ['volunteer', 'my-signups'],
    queryFn: () => volunteerUseCases.listMySignups().execute(50),
  });

  const onCheckIn = async (signupId: string) => {
    try {
      const result = await volunteerUseCases.checkIn().execute(signupId);
      await qc.invalidateQueries({ queryKey: ['volunteer'] });
      alert(
        t('timeVolunteer.checkInDone', {
          hours: result.hoursLogged,
          karma: result.karmaPoints,
        }),
      );
    } catch {
      alert(t('timeVolunteer.errorGeneric'));
    }
  };

  const onCancel = async (signupId: string) => {
    try {
      await volunteerUseCases.cancelSignup().execute(signupId);
      await qc.invalidateQueries({ queryKey: ['volunteer'] });
    } catch {
      alert(t('timeVolunteer.errorGeneric'));
    }
  };

  const onIcs = async (shiftId: string) => {
    try {
      const ics = await volunteerUseCases.getIcs().execute(shiftId);
      if (!ics) return;
      const { Share } = await import('react-native');
      await Share.share({ message: ics, title: t('timeVolunteer.calendarShareTitle') });
    } catch {
      alert(t('timeVolunteer.errorGeneric'));
    }
  };

  return (
    <>
      <TimeWorldSubScreenChrome activeScreenTestId="time-my-shifts" />
      <Screen blobs="off" hasNativeHeader>
      <KcFlashList
        data={signups.data ?? []}
        keyExtractor={(item) => item.signupId}
        contentContainerStyle={{ paddingBottom: inset, paddingTop: spacing.md }}
        ListEmptyComponent={
          <Text style={{ padding: spacing.lg, textAlign: 'center' }}>
            {signups.isLoading ? t('timeVolunteer.loading') : t('timeVolunteer.myShiftsEmpty')}
          </Text>
        }
        renderItem={({ item }) => {
          const when = new Date(item.startsAt).toLocaleString(
            i18n.language.startsWith('he') ? 'he-IL' : 'en-IL',
            { dateStyle: 'medium', timeStyle: 'short' },
          );
          return (
            <KcRowCard
              testID={`shift-row-${item.signupId}`}
              containerStyle={ROW}
              tone="give"
              badgeLabel={t('marketplace.world.time', { defaultValue: 'time' })}
              placeholderIcon="time-outline"
              title={item.title}
              meta={[`${when}${item.hoursLogged != null ? ` · ${item.hoursLogged}h` : ''}`]}
              statusLabel={statusLabel(item.status, t)}
              onPress={() =>
                router.push({
                  pathname: '/(tabs)/donations/time/opportunity/[opportunityId]',
                  params: { opportunityId: item.opportunityId },
                })
              }
              footer={
                <>
                  {item.status === 'registered' ? (
                    <Pressable onPress={() => onCheckIn(item.signupId)}>
                      <Text style={styles.action}>{t('timeVolunteer.checkIn')}</Text>
                    </Pressable>
                  ) : null}
                  {item.status === 'registered' || item.status === 'waitlisted' ? (
                    <Pressable onPress={() => onCancel(item.signupId)}>
                      <Text style={styles.action}>{t('timeVolunteer.cancelSignup')}</Text>
                    </Pressable>
                  ) : null}
                  <Pressable onPress={() => onIcs(item.shiftId)}>
                    <Text style={styles.action}>{t('timeVolunteer.addCalendar')}</Text>
                  </Pressable>
                </>
              }
            />
          );
        }}
      />
      </Screen>
    </>
  );
}
