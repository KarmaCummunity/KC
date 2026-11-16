// Mapped to spec: FR-POST-001 AC6 — one field of the listing create form: a `FormSection` that
// reads its problem from the form. When the publish problem belongs to this field it outlines
// only its control and shows the message under it; the form scope then scrolls to it.
// Outside a provider it is inert.
import React, { createContext, useContext, type ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import type { ListingFormField } from '../../lib/unifiedCreate/listingFormProblem';
import { FormSection } from '../ui/FormSection';

export interface ListingFieldProblemContextValue {
  readonly invalidField: ListingFormField | null;
  readonly message: string | null;
}

export const ListingFieldProblemContext = createContext<ListingFieldProblemContextValue>({
  invalidField: null,
  message: null,
});

/** The problem message when it belongs to `field`; null otherwise. */
export function useListingFieldProblem(field: ListingFormField): string | null {
  const { invalidField, message } = useContext(ListingFieldProblemContext);
  return invalidField === field ? message : null;
}

interface Props {
  readonly field: ListingFormField;
  /** Heading above the control, outside the red outline. */
  readonly label?: string;
  readonly required?: boolean;
  /** False when the control draws its own error state (the kit TextField). */
  readonly outlined?: boolean;
  readonly style?: StyleProp<ViewStyle>;
  /** Layout of the controls inside the outline (e.g. a gap between two controls). */
  readonly contentStyle?: StyleProp<ViewStyle>;
  readonly testID?: string;
  readonly children: ReactNode;
}

export function ListingFieldFrame({ field, label, required, outlined = true, style, contentStyle, testID, children }: Props) {
  const problem = useListingFieldProblem(field);
  return (
    <FormSection
      label={label}
      required={required}
      // A control that draws its own error state (the kit TextField) shows and anchors the message itself.
      error={outlined ? problem : null}
      outlined={outlined}
      style={style}
      contentStyle={contentStyle}
      testID={testID}
      errorTestID="listing-error"
    >
      {children}
    </FormSection>
  );
}
