// FR-HOUSING-003 AC3 — the housing code of conduct, accepted once per version before the first
// stay request. Copy: `housingStay.conduct` (drafted from docs/legal/drafts/… §1, counsel review
// before launch). The server refuses a stale version, so the version shown is the one accepted.
import React, { useState } from 'react';
import { Switch, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { makeUseStyles, spacing, typography, Text } from '@kc/ui';
import { Modal } from '../../ui/Modal';
import { GhostButton, PrimaryButton } from '../../ui/Buttons';
import { rtlTextAlignStart } from '../../../lib/rtlTextAlignStart';

interface Props {
  readonly visible: boolean;
  readonly busy: boolean;
  readonly onAccept: () => void;
  readonly onDismiss: () => void;
}

export function HousingConductModal({ visible, busy, onAccept, onDismiss }: Props) {
  const { t } = useTranslation();
  const styles = useStyles();
  const [agreed, setAgreed] = useState(false);
  // A missing translation comes back as its key (a string), never crash on it.
  const rawRules: unknown = t('housingStay.conduct.rules', { returnObjects: true });
  const rules = Array.isArray(rawRules) ? (rawRules as readonly string[]) : [];

  return (
    <Modal
      visible={visible}
      onDismiss={onDismiss}
      title={t('housingStay.conduct.title')}
      footer={
        <View style={styles.footer}>
          <PrimaryButton
            testID="housing-conduct-accept"
            label={t('housingStay.conduct.continue')}
            onPress={onAccept}
            disabled={!agreed}
            loading={busy}
          />
          <GhostButton label={t('housingStay.conduct.close')} onPress={onDismiss} />
        </View>
      }
    >
      <Text style={styles.body}>{t('housingStay.conduct.intro')}</Text>
      {rules.map((rule, index) => (
        <Text key={rule} style={styles.body}>{`${index + 1}. ${rule}`}</Text>
      ))}
      <View style={styles.agreeRow}>
        <Switch testID="housing-conduct-agree" value={agreed} onValueChange={setAgreed} />
        <Text style={styles.agreeLabel}>{t('housingStay.conduct.accept')}</Text>
      </View>
    </Modal>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  body: { ...typography.body, color: colors.textPrimary, textAlign: rtlTextAlignStart, marginBottom: spacing.xs },
  agreeRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.sm, marginTop: spacing.md },
  agreeLabel: { ...typography.body, color: colors.textPrimary, flexShrink: 1, textAlign: rtlTextAlignStart },
  footer: { gap: spacing.sm },
}));
