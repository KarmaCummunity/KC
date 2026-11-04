// FR-ADMIN-031 — restore card of the Demo data screen. Asks for the seed users' password only
// when the server has none saved yet, then hands it to `onSeed` (min length checked client-side).
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { makeUseStyles, radius, spacing, typography, Text } from '@kc/ui';
import { TextField } from '../../ui';
import { useLocaleBundle } from '../../../i18n/useLocaleBundle';

/** Mirrors the server rule in admin_seed_demo_data (0592). */
export const MIN_SEED_PASSWORD_LENGTH = 8;

interface Props {
  /** True when the server has no saved password hash, so one must be typed. */
  readonly needsPassword: boolean;
  readonly pending: boolean;
  readonly onSeed: (password: string | undefined) => void;
}

export function DemoDataSeedCard({ needsPassword, pending, onSeed }: Props) {
  const styles = useStyles();
  const t = useLocaleBundle().admin.demoData;
  const [password, setPassword] = useState('');
  const tooShort = needsPassword && password.length < MIN_SEED_PASSWORD_LENGTH;

  return (
    <View style={styles.card}>
      {needsPassword ? (
        <TextField
          label={t.passwordLabel}
          helperText={t.passwordHint}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
        />
      ) : null}
      <Pressable
        accessibilityRole="button"
        disabled={pending || tooShort}
        onPress={() => onSeed(needsPassword ? password : undefined)}
        style={[styles.button, (pending || tooShort) && styles.buttonDisabled]}
      >
        <Text style={styles.buttonLabel}>{pending ? t.seeding : t.seedButton}</Text>
      </Pressable>
    </View>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  card: {
    backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border, gap: spacing.md,
  },
  button: { backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: spacing.md, alignItems: 'center' },
  buttonDisabled: { opacity: 0.5 },
  buttonLabel: { color: colors.textInverse, fontSize: typography.body.fontSize, ...typography.bold },
}));
