// FR-ADMIN-031 — restore card of the Demo data screen. Asks for the demo members' password only
// while the server has none saved (AC9), then hands it to `onSeed`.
import { useState } from 'react';
import { View } from 'react-native';
import { MIN_DEMO_PASSWORD_LENGTH } from '@kc/domain';
import { makeUseStyles, radius, spacing } from '@kc/ui';
import { PrimaryButton, TextField } from '../../ui';
import { useLocaleBundle } from '../../../i18n/useLocaleBundle';

interface Props {
  /** True when the server has no saved password hash, so one must be typed. */
  readonly needsPassword: boolean;
  readonly pending: boolean;
  /** What the running restore is doing now; replaces the button label while pending. */
  readonly progressLabel: string | null;
  readonly onSeed: (password: string | undefined) => void;
}

export function DemoDataSeedCard({ needsPassword, pending, progressLabel, onSeed }: Props) {
  const styles = useStyles();
  const t = useLocaleBundle().admin.demoData;
  const [password, setPassword] = useState('');
  // The server enforces the same minimum; checking here saves a round trip.
  const tooShort = needsPassword && password.length < MIN_DEMO_PASSWORD_LENGTH;

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
          testID="admin-demo-password"
        />
      ) : null}
      <PrimaryButton
        label={pending ? (progressLabel ?? t.seeding) : t.seedButton}
        onPress={() => onSeed(needsPassword ? password : undefined)}
        disabled={pending || tooShort}
        fullWidth
        testID="admin-demo-seed"
      />
    </View>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  card: {
    backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md,
    borderWidth: 1, borderColor: colors.border, gap: spacing.md,
  },
}));
