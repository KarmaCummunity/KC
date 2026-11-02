import { View } from 'react-native';
import { makeUseStyles, spacing, Text, typography } from '@kc/ui';
import { GhostButton, PrimaryButton } from '../ui/Buttons';

export interface AdminFormActionsProps {
  readonly cancelLabel:    string;
  readonly submitLabel:    string;
  readonly submittingLabel: string;
  readonly isPending:      boolean;
  readonly onCancel:       () => void;
  readonly onSubmit:       () => void;
  readonly errorMsg?:      string | null;
}

export function AdminFormActions({
  cancelLabel, submitLabel, submittingLabel, isPending, onCancel, onSubmit, errorMsg,
}: AdminFormActionsProps) {
  const styles = useStyles();
  return (
    <>
      {errorMsg && <Text style={styles.errorText}>{errorMsg}</Text>}
      <View style={styles.row}>
        {/* Compact admin size (spec 17 §4.3); the submit keeps its "saving" label while blocked. */}
        <GhostButton label={cancelLabel} size="sm" disabled={isPending} onPress={onCancel} />
        <PrimaryButton
          testID="admin-form-submit"
          label={isPending ? submittingLabel : submitLabel}
          size="sm"
          disabled={isPending}
          onPress={onSubmit}
        />
      </View>
    </>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  errorText:      { color: colors.error, fontSize: typography.bodySmall.fontSize },
  row:            { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm, marginTop: spacing.sm },
}));
