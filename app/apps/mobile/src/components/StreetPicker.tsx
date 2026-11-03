/**
 * StreetPicker — public.streets-backed modal, city-dependent (FR-PROFILE-007 AC1).
 *
 * - Disabled with helper text + ephemeral toast when no city is selected.
 * - Fetches streets via React Query, keyed by cityId, when a city is set.
 * - Free-text fallback covers the 486 settlements with no canonical streets
 *   and any new construction missing from the gov snapshot.
 *
 * Implementation delegates to SearchablePicker so styling, RTL, and search
 * UX stay identical to CityPicker.
 */

import React, { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { Street } from '@kc/domain';
import { SearchablePicker } from './SearchablePicker/SearchablePicker';
import { listStreets } from '../services/userComposition';
import { useFeedSessionStore } from '../store/feedSessionStore';

interface Props {
  readonly cityId: string | null;
  readonly value: { id: string; name: string } | null;
  readonly onChange: (selection: { id: string; name: string }) => void;
  readonly disabled?: boolean;
  /**
   * Accept a street name that is not in the list (default true, for profile addresses).
   * Rides pass false: a ride place must be an official street (D71).
   */
  readonly allowFreeText?: boolean;
}

const matchStreet = (s: Street, q: string): boolean => s.nameHe.includes(q);
const renderStreet = (s: Street) => ({ id: String(s.streetId), name: s.nameHe });

export function StreetPicker({ cityId, value, onChange, disabled, allowFreeText = true }: Props) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const effectivelyDisabled = Boolean(disabled) || cityId == null;

  const { data, isLoading, error } = useQuery<Street[]>({
    queryKey: ['streets', cityId],
    queryFn: () => (cityId ? listStreets(cityId) : Promise.resolve([])),
    enabled: !!cityId,
    staleTime: 1000 * 60 * 60, // 1h — streets rarely change.
  });

  const handleDisabledPress = useCallback(() => {
    if (cityId != null) return;
    useFeedSessionStore
      .getState()
      .showEphemeralToast(t('profile.streetPickerNeedCity'), 'error', 2500);
  }, [cityId, t]);

  const handleStreetsRetry = useCallback(() => {
    if (!cityId) return;
    queryClient.invalidateQueries({ queryKey: ['streets', cityId] }).catch(() => {});
  }, [cityId, queryClient]);

  return (
    <SearchablePicker<Street>
      title={t('profile.streetPickerTitle')}
      placeholder={t('profile.streetPickerSearchPlaceholder')}
      value={value}
      items={data ?? null}
      isLoading={isLoading}
      error={error}
      disabled={effectivelyDisabled}
      disabledHelperText={cityId == null ? t('profile.streetPickerNeedCity') : undefined}
      onDisabledPress={handleDisabledPress}
      onSelect={onChange}
      matchItem={matchStreet}
      renderRow={renderStreet}
      allowFreeText={allowFreeText}
      emptyText={t('profile.streetPickerEmpty')}
      errorText={t('profile.streetPickerError')}
      onErrorRetry={handleStreetsRetry}
    />
  );
}
