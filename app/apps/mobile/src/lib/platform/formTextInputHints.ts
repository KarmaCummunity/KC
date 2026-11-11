import type { TextInputProps } from 'react-native';

/** Email fields (sign-in, CRM, research contact). */
export const formEmailInputProps = {
  keyboardType: 'email-address',
  autoCapitalize: 'none',
  autoCorrect: false,
  autoComplete: 'email',
  inputMode: 'email',
  textContentType: 'emailAddress',
} as const satisfies Partial<TextInputProps>;

/** Contact phone — digits-first; dashes are allowed when pasted. */
export const formPhoneInputProps = {
  keyboardType: 'phone-pad',
  autoComplete: 'tel',
  inputMode: 'tel',
  textContentType: 'telephoneNumber',
} as const satisfies Partial<TextInputProps>;

/** Street / house number — digits with an optional letter suffix (e.g. 12a). */
export const formStreetNumberInputProps = {
  keyboardType: 'numbers-and-punctuation',
} as const satisfies Partial<TextInputProps>;

export const formIntegerInputProps = {
  keyboardType: 'number-pad',
  inputMode: 'numeric',
} as const satisfies Partial<TextInputProps>;

export const formDecimalInputProps = {
  keyboardType: 'decimal-pad',
  inputMode: 'decimal',
} as const satisfies Partial<TextInputProps>;

export const formUrlInputProps = {
  keyboardType: 'url',
  autoCapitalize: 'none',
  autoCorrect: false,
  autoComplete: 'url',
  inputMode: 'url',
} as const satisfies Partial<TextInputProps>;

/** ISO `YYYY-MM-DD` and similar date strings. */
export const formIsoDateInputProps = {
  keyboardType: 'numbers-and-punctuation',
  autoCapitalize: 'none',
  autoCorrect: false,
} as const satisfies Partial<TextInputProps>;
