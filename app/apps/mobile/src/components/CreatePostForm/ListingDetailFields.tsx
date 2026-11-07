// Mapped to spec: FR-POST-001 AC6 — the category-specific fields of the listing form.
// Renders the curated field set of one listing kind (lib/unifiedCreate/listingFieldSpecs)
// with a purpose-built control per field type, styled like the rest of the create form.
import React from 'react';
import { format } from 'date-fns';
import { Switch, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Text } from '@kc/ui';
import { formDecimalInputProps, formIntegerInputProps } from '../../lib/platform/formTextInputHints';
import { TextField } from '../ui/TextField';
import { useCreatePostStyles } from '../../screens/tabs/create.styles';
import { DateTimeField } from '../ui/DateTimeField';
import { clampWholeNumber, visibleDetailSpecs, type ListingFieldSpec } from '../../lib/unifiedCreate/listingFieldSpecs';
import { detailField } from '../../lib/unifiedCreate/listingFormProblem';
import { CountStepper } from './CountStepper';
import { ListingFieldFrame, useListingFieldProblem } from './ListingFieldFrame';
import { Chip } from '../ui/Chip';

type Details = Readonly<Record<string, unknown>>;

interface Props {
  readonly specs: readonly ListingFieldSpec[];
  readonly details: Details;
  readonly onChange: (key: string, value: unknown) => void;
  readonly disabled?: boolean;
}

/** Field types whose control (the kit TextField) renders its own label and error state. */
const SELF_LABELLED: ReadonlySet<ListingFieldSpec['type']> = new Set(['text', 'amount', 'integer']);

export function ListingDetailFields({ specs, details, onChange, disabled = false }: Props) {
  const styles = useCreatePostStyles();
  return (
    <>
      {visibleDetailSpecs(specs, details).map((spec) => {
        const selfLabelled = SELF_LABELLED.has(spec.type);
        return (
          <ListingFieldFrame
            key={spec.key}
            field={detailField(spec.key)}
            label={selfLabelled ? null : <FieldLabel spec={spec} />}
            outlined={!selfLabelled}
            style={styles.section}
            testID={`listing-field-${spec.key}`}
          >
            <FieldControl spec={spec} value={details[spec.key]} onChange={onChange} disabled={disabled} />
          </ListingFieldFrame>
        );
      })}
    </>
  );
}

function FieldLabel({ spec }: { readonly spec: ListingFieldSpec }) {
  const { t } = useTranslation();
  const styles = useCreatePostStyles();
  return (
    <Text style={styles.sectionLabel}>
      {t(`marketplace.field.${spec.key}`)}
      {spec.required ? <Text style={styles.required}> *</Text> : null}
    </Text>
  );
}

interface ControlProps {
  readonly spec: ListingFieldSpec;
  readonly value: unknown;
  readonly onChange: (key: string, value: unknown) => void;
  readonly disabled: boolean;
}

/** Picks the control for one field; each branch writes the value type the schema expects. */
function FieldControl({ spec, value, onChange, disabled }: ControlProps) {
  const { t } = useTranslation();
  const set = (next: unknown) => onChange(spec.key, next);
  const label = `${t(`marketplace.field.${spec.key}`)}${spec.required ? ' *' : ''}`;
  const errorText = useListingFieldProblem(detailField(spec.key)) ?? undefined;

  switch (spec.type) {
    case 'choice':
      return (
        <ChipRow
          options={spec.options}
          isOn={(o) => value === o}
          // Tapping the selected chip of an optional field clears it.
          onPress={(o) => set(value === o && !spec.required ? undefined : o)}
          label={(o) => t(`marketplace.option.${o}`)}
          disabled={disabled}
        />
      );
    case 'multiChoice': {
      const selected = Array.isArray(value) ? (value as string[]) : [];
      return (
        <ChipRow
          options={spec.options}
          isOn={(o) => selected.includes(o)}
          onPress={(o) => set(selected.includes(o) ? selected.filter((x) => x !== o) : [...selected, o])}
          label={(o) => t(`marketplace.option.${o}`)}
          disabled={disabled}
        />
      );
    }
    case 'duration':
      return (
        <ChipRow
          options={spec.options}
          isOn={(o) => value === o}
          onPress={set}
          label={(o) => t(`post.unifiedCreate.duration.${o}`)}
          disabled={disabled}
        />
      );
    case 'count':
      return (
        <CountStepper
          value={typeof value === 'number' ? value : spec.defaultValue}
          min={spec.min}
          max={spec.max}
          onChange={set}
          disabled={disabled}
          label={t(`marketplace.field.${spec.key}`)}
        />
      );
    case 'dateTime':
      return (
        <DateTimeField
          testID={`listing-date-${spec.key}`}
          value={typeof value === 'string' && value ? new Date(value) : null}
          onChange={(d) => set(d.toISOString())}
          label={t(`marketplace.field.${spec.key}`)}
          placeholder={t('post.unifiedCreate.pickDate')}
          minimumDate={new Date()}
          disabled={disabled}
        />
      );
    case 'date':
      return (
        <DateTimeField
          testID={`listing-date-${spec.key}`}
          mode="date"
          // A stored `yyyy-MM-dd` is a local calendar day: read it at local midnight.
          value={typeof value === 'string' && value ? new Date(`${value}T00:00`) : null}
          onChange={(d) => set(format(d, 'yyyy-MM-dd'))}
          label={t(`marketplace.field.${spec.key}`)}
          placeholder={t('post.unifiedCreate.pickDate')}
          minimumDate={new Date()}
          disabled={disabled}
        />
      );
    case 'time':
      return (
        <DateTimeField
          testID={`listing-time-${spec.key}`}
          mode="time"
          value={timeOfDay(typeof value === 'string' && value ? value : spec.defaultValue)}
          onChange={(d) => set(format(d, 'HH:mm'))}
          label={t(`marketplace.field.${spec.key}`)}
          placeholder={spec.defaultValue}
          disabled={disabled}
        />
      );
    case 'fixed':
      return null;
    case 'amount':
      return (
        <TextField
          label={label}
          errorText={errorText}
          {...formDecimalInputProps}
          value={typeof value === 'number' ? String(value) : ''}
          onChangeText={(text) => {
            const n = Number.parseFloat(text);
            set(Number.isFinite(n) ? Math.min(Math.max(n, 0), spec.max) : undefined);
          }}
          placeholder={t('post.unifiedCreate.amountPlaceholder', { max: spec.max })}
          editable={!disabled}
        />
      );
    case 'integer':
      return (
        <TextField
          testID={`listing-integer-${spec.key}`}
          label={label}
          errorText={errorText}
          {...formIntegerInputProps}
          value={typeof value === 'number' ? String(value) : ''}
          onChangeText={(text) => set(clampWholeNumber(text, spec.min, spec.max))}
          placeholder={t('post.unifiedCreate.integerPlaceholder', { min: spec.min, max: spec.max })}
          editable={!disabled}
        />
      );
    case 'text':
      return (
        <TextField
          label={label}
          errorText={errorText}
          value={typeof value === 'string' ? value : ''}
          onChangeText={set}
          multiline={spec.multiline}
          maxLength={spec.maxLength}
          editable={!disabled}
        />
      );
    case 'toggle':
      return <Switch value={value === true} onValueChange={set} disabled={disabled} />;
  }
}

/** A stored `HH:mm` as today's Date at that local time, for the time picker. */
function timeOfDay(hhmm: string): Date {
  const [hours = 0, minutes = 0] = hhmm.split(':').map(Number);
  const d = new Date();
  d.setHours(hours, minutes, 0, 0);
  return d;
}

interface ChipRowProps<T extends string | number> {
  readonly options: readonly T[];
  readonly isOn: (o: T) => boolean;
  readonly onPress: (o: T) => void;
  readonly label: (o: T) => string;
  readonly disabled: boolean;
}

/** Wrapping row of kit filter chips, the same chips as the items form's subcategory row. */
function ChipRow<T extends string | number>({ options, isOn, onPress, label, disabled }: ChipRowProps<T>) {
  const styles = useCreatePostStyles();
  return (
    <View style={styles.chipWrap}>
      {options.map((o) => (
        <Chip key={String(o)} label={label(o)} selected={isOn(o)} onPress={() => onPress(o)} disabled={disabled} />
      ))}
    </View>
  );
}
