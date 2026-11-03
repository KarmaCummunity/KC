import { useCallback, useEffect, useRef, useState } from 'react';
import { mergeCreatePostAddressPrefill, type ProfileAddressPrefillSource } from '../lib/mergeCreatePostAddressPrefill';
import { applyAddressResetOnCityChange } from '../lib/addressResetOnCityChange';
import { getEditableProfile } from '../services/userComposition';
import { useLastAddressStore } from '../store/lastAddressStore';

type CityOpt = { id: string; name: string } | null;

interface AddressSlice {
  readonly city: CityOpt;
  readonly street: string;
  readonly streetNumber: string;
}

function initialAddressSlice(): AddressSlice {
  const m = mergeCreatePostAddressPrefill(null, useLastAddressStore.getState());
  return { city: m.city, street: m.street, streetNumber: m.streetNumber };
}

/**
 * Seeds create-post address: profile lines override last-post lines when non-empty;
 * city comes from profile when available. Re-seeds from `useLastAddressStore`
 * until the user edits any address field.
 */
export function useCreatePostAddressPrefill(ownerId: string | undefined) {
  const [addr, setAddr] = useState<AddressSlice>(initialAddressSlice);

  const addressDirtyRef = useRef(false);
  const profileForMergeRef = useRef<ProfileAddressPrefillSource | null>(null);

  const markAddressDirty = useCallback(() => {
    addressDirtyRef.current = true;
  }, []);

  const applyMerged = useCallback((m: ReturnType<typeof mergeCreatePostAddressPrefill>) => {
    setAddr({ city: m.city, street: m.street, streetNumber: m.streetNumber });
  }, []);

  const setCity = useCallback(
    (next: CityOpt) => {
      markAddressDirty();
      setAddr((a) => {
        // Switching the city invalidates the previously typed street + number.
        const reset = applyAddressResetOnCityChange({
          prevCityId: a.city?.id,
          nextCityId: next?.id,
          street: a.street,
          streetNumber: a.streetNumber,
        });
        return { city: next, street: reset.street, streetNumber: reset.streetNumber };
      });
    },
    [markAddressDirty],
  );

  const setStreet = useCallback(
    (next: string | ((prev: string) => string)) => {
      markAddressDirty();
      setAddr((a) => ({
        ...a,
        street: typeof next === 'function' ? next(a.street) : next,
      }));
    },
    [markAddressDirty],
  );

  const setStreetNumber = useCallback(
    (next: string | ((prev: string) => string)) => {
      markAddressDirty();
      setAddr((a) => ({
        ...a,
        streetNumber: typeof next === 'function' ? next(a.streetNumber) : next,
      }));
    },
    [markAddressDirty],
  );

  useEffect(() => {
    if (!ownerId) return;
    let cancelled = false;
    void (async () => {
      try {
        const p = await getEditableProfile(ownerId);
        if (cancelled) return;
        profileForMergeRef.current = {
          city: p.city,
          cityName: p.cityName,
          profileStreet: p.profileStreet,
          profileStreetNumber: p.profileStreetNumber,
        };
        if (addressDirtyRef.current) return;
        applyMerged(
          mergeCreatePostAddressPrefill(
            profileForMergeRef.current,
            useLastAddressStore.getState(),
          ),
        );
      } catch {
        // Prefill is best-effort; publish still validates required address.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ownerId, applyMerged]);

  useEffect(() => {
    const unsub = useLastAddressStore.subscribe((s) => {
      if (addressDirtyRef.current) return;
      applyMerged(mergeCreatePostAddressPrefill(profileForMergeRef.current, s));
    });
    return unsub;
  }, [applyMerged]);

  return {
    city: addr.city,
    street: addr.street,
    streetNumber: addr.streetNumber,
    setCity,
    setStreet,
    setStreetNumber,
  };
}
