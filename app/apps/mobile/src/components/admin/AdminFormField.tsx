import { TextField } from '../ui/TextField';

export interface AdminFormFieldProps {
  readonly label: string;
  readonly value: string;
  readonly onChange: (v: string) => void;
  readonly multiline?: boolean;
  readonly keyboardNumeric?: boolean;
}

export function AdminFormField({
  label, value, onChange, multiline = false, keyboardNumeric = false,
}: AdminFormFieldProps) {
  return (
    <TextField
      label={label}
      value={value}
      onChangeText={onChange}
      multiline={multiline}
      keyboardType={keyboardNumeric ? 'decimal-pad' : 'default'}
    />
  );
}
