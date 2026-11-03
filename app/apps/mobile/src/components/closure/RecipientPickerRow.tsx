// FR-CLOSURE-003 AC2 — recipient picker row: avatar + name + optional city,
// selectable radio. Used inside ClosureSheet's Step 2.
import { Pressable, View } from 'react-native';
import { KCImage } from '../ui/KCImage';
import { useTranslation } from 'react-i18next';
import { makeUseStyles, radius, spacing, typography, Text } from '@kc/ui';
import type { ClosureCandidate } from '@kc/application';
import { rowDirectionStart } from '../../lib/rtlLayout';
import { rtlTextAlignStart } from '../../lib/rtlTextAlignStart';

interface Props {
  candidate: ClosureCandidate;
  selected: boolean;
  onPress: () => void;
}

export function RecipientPickerRow({ candidate, selected, onPress }: Props) {
  const styles = useStyles();
  const { t } = useTranslation();
  const name = candidate.fullName ?? t('profile.fallbackName');
  return (
    <Pressable onPress={onPress} style={[styles.row, selected && styles.rowSelected]}>
      <View style={[styles.radio, selected && styles.radioSelected]}>
        {selected ? <View style={styles.radioDot} /> : null}
      </View>
      {candidate.avatarUrl ? (
        <KCImage uri={candidate.avatarUrl} style={styles.avatar} />
      ) : (
        <View style={[styles.avatar, styles.avatarPlaceholder]}>
          <Text style={styles.avatarInitial}>{name[0] ?? '?'}</Text>
        </View>
      )}
      <View style={styles.text}>
        <Text style={styles.name} numberOfLines={1}>
          {name}
        </Text>
        {candidate.cityName ? (
          <Text style={styles.city} numberOfLines={1}>
            {candidate.cityName}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  row: {
    flexDirection: rowDirectionStart,
    alignItems: 'center',
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: spacing.md,
  },
  rowSelected: { backgroundColor: colors.primarySurface },
  radio: {
    width: 22,
    height: 22,
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioSelected: { borderColor: colors.primary },
  radioDot: { width: 12, height: 12, borderRadius: radius.sm, backgroundColor: colors.primary },
  avatar: { width: 40, height: 40, borderRadius: radius.full },
  avatarPlaceholder: {
    backgroundColor: colors.skeleton,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: { ...typography.bodyLarge, ...typography.semiBold, color: colors.textPrimary },
  text: { flex: 1 },
  name: { ...typography.bodyLarge, color: colors.textPrimary, textAlign: rtlTextAlignStart, ...typography.medium },
  city: { ...typography.bodySmall, color: colors.textSecondary, textAlign: rtlTextAlignStart, marginTop: spacing.xs / 2 },
}));
