// Mapped to spec: FR-RESP-006 AC26 / AC29 — a text field of an admin form: the kit TextField with the
// keyboard of its kind and its own error line, like every other form.
import { TextField } from '../ui/TextField';
import type { FormInputKind } from '../../lib/platform/formTextInputHints';

export interface AdminFormFieldProps {
  readonly label: string;
  readonly value: string;
  readonly onChange: (v: string) => void;
  readonly multiline?: boolean;
  /** What the field holds (an amount is `decimal`, a count or four digits `integer`). */
  readonly inputKind?: FormInputKind;
  /** What is wrong with the value; shown under the field. */
  readonly errorText?: string;
  readonly required?: boolean;
}

export function AdminFormField({
  label, value, onChange, multiline = false, inputKind = 'text', errorText, required,
}: AdminFormFieldProps) {
  return (
    <TextField
      label={label}
      value={value}
      onChangeText={onChange}
      multiline={multiline}
      inputKind={inputKind}
      errorText={errorText}
      required={required}
    />
  );
}
