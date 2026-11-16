// Mapped to spec: FR-POST-001 AC6 — the street and house number of a listing that happens at a
// place (an event). The event form takes one structured address (city + street + number), the
// same parts as an items post, instead of a free-text line beside the city (KC#2288).
import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { listingStreetAddressIssue, listingStreetAddressLabel, type ListingStreetAddressIssue } from '@kc/domain';
import { reportHandledError } from '../lib/observability/reportHandledError';
import { listingStreetAddressQueryKey, listingStreetAddressUseCases } from '../services/listingStreetAddressComposition';

/** The message of each address problem; the same texts the items form shows. */
const ISSUE_MESSAGE_KEY: Record<ListingStreetAddressIssue, string> = {
  streetAndNumber: 'errors.createPost.missingAddressPairBeforePublish',
  street: 'errors.createPost.missingStreetBeforePublish',
  streetNumber: 'errors.createPost.missingStreetNumberBeforePublish',
  streetNumberInvalid: 'errors.post.street_number_invalid',
};

interface Args {
  /** The form's kind takes a street address (an event). */
  readonly enabled: boolean;
  /** The listing being edited; its stored address fills the fields once. */
  readonly editListingId: string | null;
}

export function useListingStreetAddress({ enabled, editListingId }: Args) {
  const { t } = useTranslation();
  const [street, setStreet] = useState('');
  const [streetNumber, setStreetNumber] = useState('');

  // An edit starts from the stored address. Only the owner can read it; an event published
  // before this field existed has none, and the member fills it in on the first edit.
  const storedQuery = useQuery({
    queryKey: listingStreetAddressQueryKey(editListingId ?? ''),
    queryFn: () => listingStreetAddressUseCases.getOwn().execute(editListingId!),
    enabled: enabled && Boolean(editListingId),
    staleTime: 60_000,
  });
  const hydrated = useRef(false);
  useEffect(() => {
    if (hydrated.current || !storedQuery.data) return;
    hydrated.current = true;
    setStreet(storedQuery.data.street);
    setStreetNumber(storedQuery.data.streetNumber);
  }, [storedQuery.data]);

  /** A street belongs to its city: choosing another city clears the street and the number. */
  const clear = useCallback(() => {
    setStreet('');
    setStreetNumber('');
  }, []);

  /** The message of the first problem; null when the address is complete (or not asked for). */
  const problem = (): string | null => {
    if (!enabled) return null;
    const issue = listingStreetAddressIssue({ street, streetNumber });
    return issue ? t(ISSUE_MESSAGE_KEY[issue]) : null;
  };

  /**
   * Stores the address with the published listing. The event already shows the address as its
   * place (`label`, saved with its details), so a failure here is reported and never fails the
   * publish: failing it would invite a second, duplicate event.
   */
  const save = async (listingId: string): Promise<void> => {
    if (!enabled) return;
    try {
      await listingStreetAddressUseCases.save().execute(listingId, { street, streetNumber });
    } catch (error) {
      reportHandledError(error, 'manual', ['listing-street-address']);
    }
  };

  return {
    enabled,
    street,
    streetNumber,
    setStreet,
    setStreetNumber,
    clear,
    problem,
    save,
    /** The address as the one line an event shows ("Herzl 12"); null when not asked for. */
    label: enabled ? listingStreetAddressLabel({ street, streetNumber }) : null,
    /** The stored address of an edit is still loading. */
    loading: enabled && Boolean(editListingId) && storedQuery.isLoading,
  };
}

export type ListingStreetAddressForm = ReturnType<typeof useListingStreetAddress>;
