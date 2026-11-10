// Mapped to spec: FR-POST-001 AC6 — one field of the listing create form. It registers itself
// so a failed publish can scroll to it and, when the publish problem is in this field, outlines
// only its control in red with the message right under it. Outside a provider it is inert.
import React, { createContext, useContext, type ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { makeUseStyles, radius, spacing, Text } from '@kc/ui';
import type { ListingFormField } from '../../lib/unifiedCreate/listingFormProblem';
import { useCreatePostStyles } from '../../screens/tabs/create.styles';

export interface ListingFieldProblemContextValue {
  readonly invalidField: ListingFormField | null;
  readonly message: string | null;
  readonly register: (field: ListingFormField, node: View | null) => void;
}

export const ListingFieldProblemContext = createContext<ListingFieldProblemContextValue>({
  invalidField: null,
  message: null,
  register: () => {},
});

/** The problem message when it belongs to `field`; null otherwise. */
export function useListingFieldProblem(field: ListingFormField): string | null {
  const { invalidField, message } = useContext(ListingFieldProblemContext);
  return invalidField === field ? message : null;
}

interface Props {
  readonly field: ListingFormField;
  /** Shown above the control, outside the red outline. */
  readonly label?: ReactNode;
  /** False when the control draws its own error state (the kit TextField). */
  readonly outlined?: boolean;
  readonly style?: StyleProp<ViewStyle>;
  /** Layout of the controls inside the outline (e.g. a gap between two controls). */
  readonly contentStyle?: StyleProp<ViewStyle>;
  readonly testID?: string;
  readonly children: ReactNode;
}

export function ListingFieldFrame({ field, label, outlined = true, style, contentStyle, testID, children }: Props) {
  const { register } = useContext(ListingFieldProblemContext);
  const problem = useListingFieldProblem(field);
  const styles = useCreatePostStyles();
  const frameStyles = useFrameStyles();
  const showError = outlined && problem !== null;
  return (
    <View ref={(node) => register(field, node)} collapsable={false} style={style} testID={testID}>
      {label}
      <View style={[contentStyle, showError && frameStyles.invalid]}>{children}</View>
      {showError ? (
        <Text style={styles.sectionHint} accessibilityRole="alert" testID="listing-error">
          {problem}
        </Text>
      ) : null}
    </View>
  );
}

const useFrameStyles = makeUseStyles(({ colors }) => ({
  invalid: {
    borderWidth: 1.5,
    borderColor: colors.error,
    borderRadius: radius.md,
    padding: spacing.xs,
  },
}));
