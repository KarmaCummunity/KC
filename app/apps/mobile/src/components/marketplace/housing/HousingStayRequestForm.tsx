// FR-HOUSING-015 AC1 — the guest's stay request on a stay offer: dates, party, the guardian
// confirmation when children come, and a message to the host. The domain rules run on every
// change so the guest sees what is wrong before sending; the server re-checks everything.
import React, { useState } from 'react';
import { Switch, View } from 'react-native';
import { format } from 'date-fns';
import { useTranslation } from 'react-i18next';
import { makeUseStyles, spacing, typography, Text } from '@kc/ui';
import {
  housingNights,
  housingToday,
  validateStayRequest,
  type HousingOfferTerms,
  type HousingStayRequestInput,
} from '@kc/domain';
import { DateTimeField } from '../../ui/DateTimeField';
import { TextField } from '../../ui/TextField';
import { CountStepper } from '../../CreatePostForm/CountStepper';
import { HandoffActionButton } from '../HandoffActionButton';
import { rtlTextAlignStart } from '../../../lib/rtlTextAlignStart';

interface Props {
  readonly listingId: string;
  readonly terms: HousingOfferTerms;
  readonly busy: boolean;
  readonly onSubmit: (input: HousingStayRequestInput) => void;
}

/** A stored `yyyy-MM-dd` as a local Date for the picker; null when unset. */
const dayToDate = (day: string): Date | null => (day ? new Date(`${day}T00:00`) : null);

export function HousingStayRequestForm({ listingId, terms, busy, onSubmit }: Props) {
  const { t } = useTranslation();
  const styles = useStyles();
  const [checkInDate, setCheckIn] = useState('');
  const [checkOutDate, setCheckOut] = useState('');
  const [adults, setAdults] = useState(1);
  const [minors, setMinors] = useState(0);
  const [minorsGuardianAck, setAck] = useState(false);
  const [message, setMessage] = useState('');

  const input: HousingStayRequestInput = {
    listingId, checkInDate, checkOutDate, adults, minors, message, minorsGuardianAck,
  };
  // Cheap and pure: re-checked on every render, only once both dates are picked.
  const problem = checkInDate && checkOutDate ? validateStayRequest(input, terms, housingToday(new Date())) : null;
  const nights = checkInDate && checkOutDate ? housingNights(checkInDate, checkOutDate) : null;
  const ready = Boolean(checkInDate && checkOutDate) && problem === null;

  return (
    <View style={styles.form} testID="housing-request-form">
      <Text style={typography.h3}>{t('housingStay.requestTitle')}</Text>
      <DateTimeField
        testID="housing-request-check-in"
        mode="date"
        label={t('housingStay.checkIn')}
        placeholder={t('housingStay.pickDate')}
        value={dayToDate(checkInDate)}
        minimumDate={new Date()}
        onChange={(d) => setCheckIn(format(d, 'yyyy-MM-dd'))}
      />
      <DateTimeField
        testID="housing-request-check-out"
        mode="date"
        label={t('housingStay.checkOut')}
        placeholder={t('housingStay.pickDate')}
        value={dayToDate(checkOutDate)}
        minimumDate={dayToDate(checkInDate) ?? new Date()}
        onChange={(d) => setCheckOut(format(d, 'yyyy-MM-dd'))}
      />
      {nights !== null && nights > 0 ? (
        <Text style={styles.caption}>{nights === 1 ? t('housingStay.nightsOne') : t('housingStay.nights', { count: nights })}</Text>
      ) : null}
      <CountStepper value={adults} min={1} max={8} onChange={setAdults} label={t('housingStay.adults')} />
      {terms.childrenOk ? (
        <CountStepper value={minors} min={0} max={7} onChange={setMinors} label={t('housingStay.minors')} />
      ) : null}
      {minors > 0 ? (
        <View style={styles.ackRow}>
          <Switch testID="housing-request-guardian" value={minorsGuardianAck} onValueChange={setAck} />
          <Text style={styles.ackLabel}>{t('housingStay.guardianAck')}</Text>
        </View>
      ) : null}
      <TextField
        testID="housing-request-message"
        label={t('housingStay.message')}
        helperText={t('housingStay.messageHint')}
        value={message}
        onChangeText={setMessage}
        multiline
        maxLength={500}
      />
      {problem ? <Text style={styles.problem} testID="housing-request-problem">{t(`marketplace.errors.${problem}`)}</Text> : null}
      <HandoffActionButton
        testID="housing-request-send"
        label={t('housingStay.send')}
        busy={busy}
        disabled={!ready}
        onPress={() => onSubmit(input)}
      />
    </View>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  form: { gap: spacing.sm },
  caption: { ...typography.caption, color: colors.textSecondary, textAlign: rtlTextAlignStart },
  problem: { ...typography.caption, color: colors.warning, textAlign: rtlTextAlignStart },
  ackRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.sm },
  ackLabel: { ...typography.body, color: colors.textPrimary, flexShrink: 1, textAlign: rtlTextAlignStart },
}));
