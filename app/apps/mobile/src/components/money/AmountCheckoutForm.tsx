// Amount form shared by the one-time donation and the standing-order screens
// (FR-DONATE money path, sandbox): an amount field, optional preset amounts, a
// note and the confirm button (spec 17 §4.1, §8.1 call 5 — the bottom action of
// a main flow is an `lg` kit button). `AmountCheckoutScreen` frames it and shows
// the external-provider notice instead while in-app payments are off.
import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, View } from 'react-native';
import { makeUseStyles, spacing, typography, Text } from '@kc/ui';
import type { ExternalDonationKind } from '../../config/featureFlags';
import { useExternalDonations } from '../../hooks/useExternalDonations';
import { Screen } from '../ui/Screen';
import { TextField } from '../ui/TextField';
import { PrimaryButton } from '../ui/Buttons';
import { Chip } from '../ui/Chip';
import { ExternalDonationNotice } from './ExternalDonationNotice';

/** Smallest amount, in shekels, either screen accepts. */
export const MIN_AMOUNT_ILS = 5;

/** The typed amount as a number (a decimal comma is accepted); NaN when it is not one. */
export function parseAmountIls(text: string): number {
  return Number(text.replace(',', '.'));
}

export interface AmountCheckoutFormProps {
  /** Explanation above the field. */
  readonly intro?: string;
  readonly amountLabel: string;
  /** Pre-filled amount, as typed text. */
  readonly initialAmount: string;
  /** One-tap amounts under the field; the one matching the typed amount is selected. */
  readonly presets?: readonly number[];
  /** Small print above the button. */
  readonly note?: string;
  readonly submitLabel: string;
  /** False while something outside the form is missing (e.g. no organisation id). */
  readonly ready: boolean;
  /** Runs the payment for a valid amount; the button shows a spinner until it settles. */
  readonly onSubmit: (amountIls: number) => Promise<void>;
}

export function AmountCheckoutForm(props: AmountCheckoutFormProps) {
  const { intro, amountLabel, initialAmount, presets = [], note, submitLabel, ready, onSubmit } = props;
  const styles = useStyles();
  const [amount, setAmount] = useState(initialAmount);
  const [busy, setBusy] = useState(false);
  const parsed = parseAmountIls(amount);
  const valid = Number.isFinite(parsed) && parsed >= MIN_AMOUNT_ILS;

  const submit = async () => {
    setBusy(true);
    try {
      await onSubmit(parsed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.body}>
        {intro ? <Text style={styles.intro}>{intro}</Text> : null}
        <TextField
          label={amountLabel}
          keyboardType="decimal-pad"
          value={amount}
          onChangeText={setAmount}
          style={styles.amount}
        />
        {presets.length > 0 ? (
          <View style={styles.presets}>
            {presets.map((preset) => (
              <Chip key={preset} label={`₪${preset}`} selected={parsed === preset} onPress={() => setAmount(String(preset))} />
            ))}
          </View>
        ) : null}
        {note ? <Text style={styles.note}>{note}</Text> : null}
        <View style={styles.submit}>
          <PrimaryButton
            label={submitLabel}
            fullWidth
            loading={busy}
            disabled={!valid || !ready}
            onPress={() => void submit()}
          />
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

export interface AmountCheckoutScreenProps extends Omit<AmountCheckoutFormProps, 'ready'> {
  readonly kind: ExternalDonationKind;
  /** The receiving organisation; the confirm stays blocked without one. */
  readonly orgId: string | undefined;
  readonly listingId?: string | null;
}

/** The donation / standing-order screen: the amount form, or the external notice when payments run outside the app. */
export function AmountCheckoutScreen({ kind, orgId, listingId = null, ...form }: AmountCheckoutScreenProps) {
  const { external } = useExternalDonations();
  return (
    <Screen>
      {external && orgId ? (
        <ExternalDonationNotice kind={kind} orgId={orgId} listingId={listingId} />
      ) : (
        <AmountCheckoutForm {...form} ready={Boolean(orgId)} />
      )}
    </Screen>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  fill: { flex: 1 },
  body: { padding: spacing.lg, gap: spacing.md, flex: 1 },
  intro: { ...typography.body, color: colors.textSecondary },
  // The amount is the point of the screen: shown larger than ordinary field text.
  amount: { ...typography.h3, color: colors.textPrimary },
  presets: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  note: { ...typography.caption, color: colors.textSecondary },
  submit: { marginTop: spacing.lg },
}));
