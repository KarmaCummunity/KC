import React, { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { makeUseStyles, radius, spacing, typography, Text } from '@kc/ui';
import { Screen } from '../../../../../src/components/ui/Screen';
import { PrimaryButton, SecondaryButton } from '../../../../../src/components/ui/Buttons';
import { volunteerUseCases } from '../../../../../src/services/volunteerComposition';
import { useAuthStore } from '../../../../../src/store/authStore';

const useStyles = makeUseStyles(({ colors }) => ({
  scroll: { padding: spacing.lg, gap: spacing.md },
  title: { ...typography.h2, color: colors.textPrimary },
  summary: { ...typography.body, color: colors.textSecondary },
  shift: {
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceRaised,
    gap: spacing.xs,
  },
  shiftMeta: { ...typography.caption, color: colors.textSecondary },
  action: { marginTop: spacing.sm },
  message: { padding: spacing.lg },
}));

export default function VolunteerOpportunityDetailScreen() {
  const { opportunityId } = useLocalSearchParams<{ opportunityId: string }>();
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const styles = useStyles();
  const qc = useQueryClient();
  const userId = useAuthStore((s) => s.session?.userId ?? null);
  const [busyShift, setBusyShift] = useState<string | null>(null);

  const detail = useQuery({
    queryKey: ['volunteer', 'detail', opportunityId],
    queryFn: () => volunteerUseCases.getDetail().execute(String(opportunityId)),
    enabled: Boolean(opportunityId),
  });

  const onSignUp = async (shiftId: string, waitlist: boolean) => {
    if (!userId) return;
    setBusyShift(shiftId);
    try {
      await volunteerUseCases.signUp().execute(shiftId);
      await qc.invalidateQueries({ queryKey: ['volunteer'] });
      alert(waitlist ? t('timeVolunteer.statusWaitlisted') : t('timeVolunteer.statusRegistered'));
    } catch {
      alert(t('timeVolunteer.errorGeneric'));
    } finally {
      setBusyShift(null);
    }
  };

  const d = detail.data;
  if (!d && detail.isLoading) {
    return (
      <Screen>
        <Text style={styles.message}>{t('timeVolunteer.loading')}</Text>
      </Screen>
    );
  }
  if (!d) {
    return (
      <Screen>
        <Text style={styles.message}>{t('timeVolunteer.errorGeneric')}</Text>
      </Screen>
    );
  }

  const isOrganizer = userId != null && d.organizerId === userId;

  return (
    <Screen blobs="content">
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.title}>{d.title}</Text>
        {d.locationLabel ? <Text style={styles.summary}>{d.locationLabel}</Text> : null}
        {d.summary ? <Text style={styles.summary}>{d.summary}</Text> : null}
        {isOrganizer ? (
          <SecondaryButton
            label={t('timeVolunteer.organizerLink')}
            size="md"
            onPress={() =>
              router.push({
                pathname: '/(tabs)/donations/time/organizer/[opportunityId]',
                params: { opportunityId: d.opportunityId },
              })
            }
          />
        ) : null}
        {d.shifts.map((shift) => {
          const when = `${new Date(shift.startsAt).toLocaleString(i18n.language.startsWith('he') ? 'he-IL' : 'en-IL', {
            dateStyle: 'medium',
            timeStyle: 'short',
          })} – ${new Date(shift.endsAt).toLocaleTimeString(i18n.language.startsWith('he') ? 'he-IL' : 'en-IL', {
            timeStyle: 'short',
          })}`;
          const mine = shift.myStatus;
          return (
            <View key={shift.shiftId} style={styles.shift}>
              <Text style={styles.shiftMeta}>{when}</Text>
              <Text style={styles.shiftMeta}>
                {t('timeVolunteer.slotsOpen', { count: shift.slotsOpen })} ({shift.filled}/{shift.capacity})
              </Text>
              {mine && mine !== 'cancelled' ? (
                <Text style={styles.shiftMeta}>{mine}</Text>
              ) : (
                <View style={styles.action}>
                  <PrimaryButton
                    label={shift.slotsOpen <= 0 ? t('timeVolunteer.waitlist') : t('timeVolunteer.signUp')}
                    size="md"
                    disabled={busyShift === shift.shiftId}
                    onPress={() => void onSignUp(shift.shiftId, shift.slotsOpen <= 0)}
                  />
                </View>
              )}
            </View>
          );
        })}
      </ScrollView>
    </Screen>
  );
}
