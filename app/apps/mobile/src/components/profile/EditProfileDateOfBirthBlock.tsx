// FR-VERIFY-012 / FR-AUTH-010 — date of birth on Edit profile (required for verification level 1).
// `DateOfBirthField` already draws the label, the hint and the message; this block only places it.
import React from 'react';
import { View } from 'react-native';
import { makeUseStyles, spacing } from '@kc/ui';
import { DateOfBirthField } from '../DateOfBirthField';

type Props = {
  readonly value: string | null;
  readonly onChange: (iso: string | null) => void;
  readonly disabled?: boolean;
  /** The form's message for the date, e.g. an unfinished date on save. */
  readonly errorText?: string;
};

export function EditProfileDateOfBirthBlock({ value, onChange, disabled, errorText }: Props) {
  const styles = useStyles();
  return (
    <View style={styles.field} testID="edit-profile-dob">
      <DateOfBirthField value={value} onChange={onChange} disabled={disabled} errorText={errorText} />
    </View>
  );
}

const useStyles = makeUseStyles(() => ({
  field: { marginBottom: spacing.md },
}));
