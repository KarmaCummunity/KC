// One action of a handoff or ride-booking flow (reserve, approve, complete, cancel …) on the kit
// buttons (spec 17 §4.1, §8.1 call 5: `md` inside a card). Every action of a flow is blocked while
// any of them runs, so `busy` disables the button rather than showing a spinner on it.
import React from 'react';
import { View } from 'react-native';
import { makeUseStyles } from '@kc/ui';
import { PrimaryButton, SecondaryButton } from '../ui/Buttons';

export interface HandoffActionButtonProps {
  readonly testID: string;
  readonly label: string;
  /** An action of the same flow is running. */
  readonly busy: boolean;
  /** The outlined, less prominent choice of a pair (decline, cancel). */
  readonly secondary?: boolean;
  /** Shares a row with another action and takes an equal part of it. */
  readonly inRow?: boolean;
  readonly onPress: () => void;
}

export function HandoffActionButton({ testID, label, busy, secondary = false, inRow = false, onPress }: HandoffActionButtonProps) {
  const styles = useStyles();
  const Button = secondary ? SecondaryButton : PrimaryButton;
  const button = <Button testID={testID} label={label} size="md" fullWidth disabled={busy} onPress={onPress} />;
  return inRow ? <View style={styles.rowPart}>{button}</View> : button;
}

const useStyles = makeUseStyles(() => ({
  rowPart: { flex: 1 },
}));
