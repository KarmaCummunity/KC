// Shared sheet for the report and ban flows (FR-MOD-001, FR-MOD-007, FR-CHAT-010,
// FR-ADMIN-004): pick one reason, add an optional note, submit. Built on the kit
// `BottomSheet`, `TextField` and buttons (spec 17 §4.1).
//
// Footer: the submit action first, then a ghost cancel. `destructive` (a ban)
// puts the submit on the red `DangerButton` (D94) and outlines the chosen reason
// in `error` instead of the brand colour.
import React from 'react';
import { Pressable, View } from 'react-native';
import { makeUseStyles, radius, spacing, typography, Text } from '@kc/ui';
import { rtlTextAlignStart } from '../../lib/rtlTextAlignStart';
import { BottomSheet } from '../ui/BottomSheet';
import { DangerButton, GhostButton, PrimaryButton } from '../ui/Buttons';
import { TextField } from '../ui/TextField';

/** One choosable reason: its stored value and its translated label. */
export interface ReasonOption<T extends string> {
  readonly value: T;
  readonly label: string;
}

export interface ReasonNoteSheetProps<T extends string> {
  readonly visible: boolean;
  /** Called by every dismiss path and by the cancel button. */
  readonly onClose: () => void;
  readonly title: string;
  /** Optional caption above the reasons; it also names the radio group. */
  readonly reasonLabel?: string;
  readonly reasons: readonly ReasonOption<T>[];
  readonly reason: T;
  readonly onReasonChange: (reason: T) => void;
  /** Label of the note field. */
  readonly noteLabel: string;
  readonly note: string;
  readonly onNoteChange: (note: string) => void;
  readonly noteMaxLength?: number;
  readonly submitLabel: string;
  /**
   * Text shown on the submit button while submitting. Without it the button
   * keeps `submitLabel` and shows the kit spinner instead.
   */
  readonly submittingLabel?: string;
  readonly submitting: boolean;
  readonly onSubmit: () => void;
  readonly cancelLabel: string;
  /** A destructive submit (ban): red `DangerButton` and an `error` outline on the chosen reason. */
  readonly destructive?: boolean;
}

/** Reason radio list + note field + submit / cancel footer, in a bottom sheet. */
export function ReasonNoteSheet<T extends string>(props: ReasonNoteSheetProps<T>) {
  const { visible, onClose, title, reasonLabel, submitting, destructive } = props;
  const styles = useReasonNoteSheetStyles();
  const SubmitButton = destructive ? DangerButton : PrimaryButton;
  const submitText = submitting && props.submittingLabel ? props.submittingLabel : props.submitLabel;
  return (
    <BottomSheet
      visible={visible}
      onDismiss={onClose}
      title={title}
      footer={
        <>
          <SubmitButton
            label={submitText}
            size="md"
            fullWidth
            onPress={props.onSubmit}
            disabled={submitting}
            loading={submitting && !props.submittingLabel}
          />
          <GhostButton label={props.cancelLabel} size="md" fullWidth onPress={onClose} disabled={submitting} />
        </>
      }
    >
      {reasonLabel ? <Text style={styles.caption}>{reasonLabel}</Text> : null}
      <View role="radiogroup" aria-label={reasonLabel ?? title} style={styles.reasons}>
        {props.reasons.map((option) => (
          <ReasonRow
            key={option.value}
            label={option.label}
            selected={props.reason === option.value}
            destructive={destructive}
            onPress={() => props.onReasonChange(option.value)}
          />
        ))}
      </View>
      <TextField
        label={props.noteLabel}
        value={props.note}
        onChangeText={props.onNoteChange}
        multiline
        maxLength={props.noteMaxLength}
      />
    </BottomSheet>
  );
}

interface ReasonRowProps {
  readonly label: string;
  readonly selected: boolean;
  readonly destructive?: boolean;
  readonly onPress: () => void;
}

/** One reason, announced as a radio button with its checked state. */
function ReasonRow({ label, selected, destructive, onPress }: ReasonRowProps) {
  const styles = useReasonNoteSheetStyles();
  return (
    <Pressable
      onPress={onPress}
      role="radio"
      aria-checked={selected}
      aria-label={label}
      style={[styles.row, selected && (destructive ? styles.rowSelectedDanger : styles.rowSelected)]}
    >
      <Text style={styles.rowLabel}>{label}</Text>
    </Pressable>
  );
}

const useReasonNoteSheetStyles = makeUseStyles(({ colors }) => ({
  caption: { ...typography.label, color: colors.textSecondary, textAlign: rtlTextAlignStart },
  reasons: { gap: spacing.sm },
  row: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  rowSelected: { borderColor: colors.primary, backgroundColor: colors.primarySurface },
  rowSelectedDanger: { borderColor: colors.error, backgroundColor: colors.errorLight },
  rowLabel: { ...typography.body, color: colors.textPrimary, textAlign: rtlTextAlignStart },
}));
