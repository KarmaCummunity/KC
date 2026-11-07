// Inline house-number box beside StreetPicker — label hidden; placeholder + a11y label only.
// Shared by create-adjacent flows (edit post, edit profile) so the field stays vertically aligned.
import React, { forwardRef } from 'react';
import type { TextInput as KitTextInput } from '@kc/ui';
import { useTranslation } from 'react-i18next';
import { TextField, type TextFieldProps } from '../ui/TextField';
import { formStreetNumberInputProps } from '../../lib/platform/formTextInputHints';
import { rtlTextAlignStart } from '../../lib/rtlTextAlignStart';

export type CompactStreetNumberFieldProps = Omit<TextFieldProps, 'label' | 'hideLabel'> & {
  /** Defaults to `profile.streetNumberShort`. */
  readonly placeholder?: string;
};

export const CompactStreetNumberField = forwardRef<KitTextInput, CompactStreetNumberFieldProps>(
  function CompactStreetNumberField({ placeholder, style, maxLength = 10, ...rest }, ref) {
    const { t } = useTranslation();
    const resolvedPlaceholder = placeholder ?? t('profile.streetNumberShort');

    return (
      <TextField
        ref={ref}
        label={t('profile.streetNumberShort')}
        hideLabel
        placeholder={resolvedPlaceholder}
        maxLength={maxLength}
        style={[ { textAlign: rtlTextAlignStart }, style]}
        {...formStreetNumberInputProps}
        {...rest}
      />
    );
  },
);
