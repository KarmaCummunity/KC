// FR-RIDE-041 — one-time driver declaration acceptance sheet.
// Opens from RideCreateSheet when the user tries to publish an offer
// without an existing declaration, or proactively from a future Settings
// row. Three required checkboxes; submit calls
// AcceptDriverDeclarationUseCase.
// The frame, dismissal and motion come from the kit `BottomSheet` (spec 17 §4.1);
// the accept button is pinned in its footer.
import React, { useState } from 'react';
import { Pressable } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { iconSize, makeUseStyles, spacing, typography, useTheme, Text } from '@kc/ui';

import { BottomSheet } from '../../../components/ui/BottomSheet';
import { PrimaryButton } from '../../../components/ui/Buttons';
import { rtlTextAlignStart } from '../../../lib/rtlTextAlignStart';
import { rowDirectionStart } from '../../../lib/rtlLayout';
import { getAcceptDriverDeclarationUseCase } from '../composition/ridesComposition';

interface Props {
  readonly visible: boolean;
  readonly onClose: () => void;
  /** Fires once the declaration is accepted (so the caller can retry the publish). */
  readonly onAccepted: () => void;
}

export function DriverDeclarationSheet({ visible, onClose, onAccepted }: Props) {
  const { t } = useTranslation();
  const styles = useStyles();

  const [license, setLicense] = useState(false);
  const [insurance, setInsurance] = useState(false);
  const [noProfit, setNoProfit] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const allTrue = license && insurance && noProfit;

  const handleAccept = async () => {
    if (!allTrue) return;
    setBusy(true);
    setError(null);
    try {
      await getAcceptDriverDeclarationUseCase().execute();
      onAccepted();
      onClose();
    } catch {
      setError(t('donations.rides.declaration.error'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <BottomSheet
      visible={visible}
      onDismiss={onClose}
      title={t('donations.rides.declaration.title')}
      footer={
        <PrimaryButton
          label={t('donations.rides.declaration.accept')}
          size="md"
          fullWidth
          loading={busy}
          disabled={!allTrue}
          onPress={() => void handleAccept()}
        />
      }
    >
      <Text style={styles.intro}>{t('donations.rides.declaration.intro')}</Text>

      <DeclarationRow
        checked={license}
        onToggle={() => setLicense((v) => !v)}
        label={t('donations.rides.declaration.license')}
      />
      <DeclarationRow
        checked={insurance}
        onToggle={() => setInsurance((v) => !v)}
        label={t('donations.rides.declaration.insurance')}
      />
      <DeclarationRow
        checked={noProfit}
        onToggle={() => setNoProfit((v) => !v)}
        label={t('donations.rides.declaration.noProfit')}
      />

      {error ? <Text style={styles.errorText}>{error}</Text> : null}
    </BottomSheet>
  );
}

function DeclarationRow({
  checked,
  onToggle,
  label,
}: Readonly<{
  checked: boolean;
  onToggle: () => void;
  label: string;
}>) {
  const { colors } = useTheme();
  const styles = useStyles();
  return (
    <Pressable style={styles.row} onPress={onToggle} accessibilityRole="checkbox">
      <Ionicons
        name={checked ? 'checkbox' : 'square-outline'}
        size={iconSize['2xl']}
        color={checked ? colors.primary : colors.textSecondary}
      />
      <Text style={styles.rowText}>{label}</Text>
    </Pressable>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  intro: { ...typography.body, color: colors.textSecondary, textAlign: rtlTextAlignStart },
  row: {
    flexDirection: rowDirectionStart,
    alignItems: 'flex-start' as const,
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  rowText: { ...typography.body, color: colors.textPrimary, flex: 1, textAlign: rtlTextAlignStart },
  errorText: { ...typography.caption, color: colors.error, textAlign: rtlTextAlignStart },
}));
