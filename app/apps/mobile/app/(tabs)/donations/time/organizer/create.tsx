import React, { useState } from 'react';
import { ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import DateTimePicker from '@react-native-community/datetimepicker';
import { makeUseStyles, spacing, typography, Text } from '@kc/ui';
import { Screen } from '../../../../../src/components/ui/Screen';
import { TextField } from '../../../../../src/components/ui/TextField';
import { PrimaryButton } from '../../../../../src/components/ui/Buttons';
import { volunteerUseCases } from '../../../../../src/services/volunteerComposition';
import { rtlTextAlignStart } from '../../../../../src/lib/rtlTextAlignStart';

const useStyles = makeUseStyles(({ colors }) => ({
  scroll: { padding: spacing.lg, gap: spacing.md },
  label: { ...typography.bodySmall, color: colors.textSecondary, textAlign: rtlTextAlignStart },
  hint: { ...typography.caption, color: colors.textSecondary },
}));

export default function CreateVolunteerOpportunityScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const styles = useStyles();
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [location, setLocation] = useState('');
  const [starts, setStarts] = useState(new Date(Date.now() + 86400000));
  const [ends, setEnds] = useState(new Date(Date.now() + 86400000 + 7200000));
  const [capacity, setCapacity] = useState('10');
  const [busy, setBusy] = useState(false);

  const onCreate = async () => {
    if (!title.trim() || busy) return;
    setBusy(true);
    try {
      const id = await volunteerUseCases.createOpportunity().execute({
        title: title.trim(),
        summary: summary.trim() || null,
        locationLabel: location.trim() || null,
      });
      await volunteerUseCases.addShift().execute(
        id,
        starts.toISOString(),
        ends.toISOString(),
        Math.max(1, Number.parseInt(capacity, 10) || 10),
      );
      await volunteerUseCases.publish().execute(id);
      router.replace({
        pathname: '/(tabs)/donations/time/organizer/[opportunityId]',
        params: { opportunityId: id },
      });
    } catch {
      alert(t('timeVolunteer.errorGeneric'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen blobs="content">
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <TextField label={t('timeVolunteer.fieldTitle')} value={title} onChangeText={setTitle} />
        <TextField label={t('timeVolunteer.fieldSummary')} value={summary} onChangeText={setSummary} multiline />
        <TextField label={t('timeVolunteer.fieldLocation')} value={location} onChangeText={setLocation} />
        <Text style={styles.label}>{t('timeVolunteer.shiftStarts')}</Text>
        <DateTimePicker value={starts} mode="datetime" onChange={(_, d) => d && setStarts(d)} />
        <Text style={styles.label}>{t('timeVolunteer.shiftEnds')}</Text>
        <DateTimePicker value={ends} mode="datetime" onChange={(_, d) => d && setEnds(d)} />
        <TextField
          label={t('timeVolunteer.shiftCapacity')}
          value={capacity}
          onChangeText={setCapacity}
          keyboardType="number-pad"
        />
        <Text style={styles.hint}>{t('timeVolunteer.publishHint')}</Text>
        <PrimaryButton label={t('timeVolunteer.publish')} fullWidth disabled={busy} onPress={() => void onCreate()} />
      </ScrollView>
    </Screen>
  );
}
