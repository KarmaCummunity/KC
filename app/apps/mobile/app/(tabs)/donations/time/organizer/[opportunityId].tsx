import React, { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { makeUseStyles, radius, spacing, typography, Text } from '@kc/ui';
import { Screen } from '../../../../../src/components/ui/Screen';
import { TextField } from '../../../../../src/components/ui/TextField';
import { DangerButton, GhostButton, PrimaryButton } from '../../../../../src/components/ui/Buttons';
import { volunteerUseCases } from '../../../../../src/services/volunteerComposition';
import { rtlTextAlignStart } from '../../../../../src/lib/rtlTextAlignStart';

const useStyles = makeUseStyles(({ colors }) => ({
  scroll: { padding: spacing.lg, gap: spacing.md },
  title: { ...typography.h3, color: colors.textPrimary, textAlign: rtlTextAlignStart },
  shift: {
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceRaised,
    gap: spacing.sm,
  },
  composer: { gap: spacing.sm },
  message: { padding: spacing.lg },
}));

export default function OrganizerOpportunityManageScreen() {
  const { opportunityId } = useLocalSearchParams<{ opportunityId: string }>();
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const styles = useStyles();
  const qc = useQueryClient();
  const [messageShift, setMessageShift] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  const detail = useQuery({
    queryKey: ['volunteer', 'detail', opportunityId],
    queryFn: () => volunteerUseCases.getDetail().execute(String(opportunityId)),
    enabled: Boolean(opportunityId),
  });

  const sendMessage = async () => {
    if (!messageShift || !message.trim()) return;
    try {
      const count = await volunteerUseCases.messageVolunteers().execute(messageShift, message.trim());
      setMessage('');
      setMessageShift(null);
      alert(t('timeVolunteer.messageSent', { count }));
    } catch {
      alert(t('timeVolunteer.errorGeneric'));
    }
  };

  const closeOpp = async () => {
    try {
      await volunteerUseCases.close().execute(String(opportunityId));
      await qc.invalidateQueries({ queryKey: ['volunteer'] });
      router.back();
    } catch {
      alert(t('timeVolunteer.errorGeneric'));
    }
  };

  const d = detail.data;
  if (!d) {
    return (
      <Screen>
        <Text style={styles.message}>{t('timeVolunteer.loading')}</Text>
      </Screen>
    );
  }

  return (
    <Screen blobs="content">
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.title}>{d.title}</Text>
        {d.shifts.map((shift) => {
          const when = new Date(shift.startsAt).toLocaleString(
            i18n.language.startsWith('he') ? 'he-IL' : 'en-IL',
            { dateStyle: 'medium', timeStyle: 'short' },
          );
          return (
            <View key={shift.shiftId} style={styles.shift}>
              <Text>{when}</Text>
              <GhostButton
                label={t('timeVolunteer.manageVolunteers')}
                size="sm"
                onPress={() =>
                  router.push({
                    pathname: '/(tabs)/donations/time/shift/[shiftId]/volunteers',
                    params: { shiftId: shift.shiftId },
                  })
                }
              />
              <GhostButton
                label={t('timeVolunteer.messageVolunteers')}
                size="sm"
                onPress={() => setMessageShift(shift.shiftId)}
              />
            </View>
          );
        })}
        {messageShift ? (
          <View style={styles.composer}>
            <TextField
              label={t('timeVolunteer.messageVolunteers')}
              value={message}
              onChangeText={setMessage}
              placeholder={t('timeVolunteer.messagePlaceholder')}
              multiline
            />
            <PrimaryButton label={t('timeVolunteer.sendMessage')} size="md" onPress={() => void sendMessage()} />
          </View>
        ) : null}
        <DangerButton label={t('timeVolunteer.closeOpportunity')} size="md" onPress={() => void closeOpp()} />
      </ScrollView>
    </Screen>
  );
}
