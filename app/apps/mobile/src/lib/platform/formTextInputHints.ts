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

/** Clock time such as `18:30` — digits plus the colon, no letters. */
export const formTimeInputProps = {
  keyboardType: 'numbers-and-punctuation',
  autoCapitalize: 'none',
  autoCorrect: false,
} as const satisfies Partial<TextInputProps>;

/** Person name — capitalise each word, let the OS offer contact-name autofill. */
export const formNameInputProps = {
  autoCapitalize: 'words',
  autoComplete: 'name',
  textContentType: 'name',
} as const satisfies Partial<TextInputProps>;

/** Password — masked, never capitalised or autocorrected. */
export const formPasswordInputProps = {
  secureTextEntry: true,
  autoCapitalize: 'none',
  autoCorrect: false,
  autoComplete: 'password',
  textContentType: 'password',
} as const satisfies Partial<TextInputProps>;

/**
 * Semantic kind of a form field. `TextField` maps it to the right on-screen keyboard
 * and autofill hints, so every form picks its keyboard the same way.
 */
export type FormInputKind =
  | 'text'
  | 'name'
  | 'email'
  | 'phone'
  | 'integer'
  | 'decimal'
  | 'url'
  | 'date'
  | 'time'
  | 'streetNumber'
  | 'password';

export const formInputKindProps: Readonly<Record<FormInputKind, Partial<TextInputProps>>> = {
  text: {},
  name: formNameInputProps,
  email: formEmailInputProps,
  phone: formPhoneInputProps,
  integer: formIntegerInputProps,
  decimal: formDecimalInputProps,
  url: formUrlInputProps,
  date: formIsoDateInputProps,
  time: formTimeInputProps,
  streetNumber: formStreetNumberInputProps,
  password: formPasswordInputProps,
};
