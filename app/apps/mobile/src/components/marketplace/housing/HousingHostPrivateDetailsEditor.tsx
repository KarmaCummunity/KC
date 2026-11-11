// FR-HOUSING-012 AC2 — the host writes the exact place guests see after approval.
import React, { useState } from 'react';
import { View } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Text, typography } from '@kc/ui';
import { StreetPicker } from '../../StreetPicker';
import { TextField } from '../../ui/TextField';
import { PrimaryButton, SecondaryButton } from '../../ui/Buttons';
import { housingQueryKeys, housingUseCases } from '../../../services/housingComposition';
import { useRideBookingStyles } from '../rides/rideBookingStyles';
import { HousingAddressCard } from './HousingAddressCard';
import { useHousingAction } from './useHousingAction';
import {
  formIntegerInputProps,
  formStreetNumberInputProps,
} from '../../../lib/platform/formTextInputHints';

interface Props {
  readonly listingId: string;
  readonly cityId: string | null;
}

export function HousingHostPrivateDetailsEditor({ listingId, cityId }: Props) {
  const { t } = useTranslation();
  const styles = useRideBookingStyles();
  const qc = useQueryClient();
  const { busy, run } = useHousingAction(listingId);
  const saved = useQuery({
    queryKey: housingQueryKeys.privateDetails(listingId),
    queryFn: () => housingUseCases.privateDetails().execute(listingId),
  });
  const [editing, setEditing] = useState(false);
  const [streetId, setStreetId] = useState<number | null>(null);
  const [streetLabel, setStreetLabel] = useState<string | null>(null);
  const [houseNumber, setHouseNumber] = useState('');
  const [apartment, setApartment] = useState('');
  const [floor, setFloor] = useState('');
  const [entranceNotes, setEntranceNotes] = useState('');
  const [accessInstructions, setAccessInstructions] = useState('');

  const startEdit = () => {
    const d = saved.data;
    if (d) {
      setStreetId(null);
      setStreetLabel(d.streetName);
      setHouseNumber(d.houseNumber);
      setApartment(d.apartment ?? '');
      setFloor(d.floor ?? '');
      setEntranceNotes(d.entranceNotes ?? '');
      setAccessInstructions(d.accessInstructions ?? '');
    }
    setEditing(true);
  };

  const save = () => {
    if (!cityId || !streetId || houseNumber.trim().length === 0) return;
    void run(() =>
      housingUseCases.setPrivateDetails().execute({
        listingId,
        streetId,
        houseNumber: houseNumber.trim(),
        apartment: apartment.trim() || null,
        floor: floor.trim() || null,
        entranceNotes: entranceNotes.trim() || null,
        accessInstructions: accessInstructions.trim() || null,
        lat: null,
        lng: null,
      }),
    ).then((ok) => {
      if (!ok) return;
      setEditing(false);
      void qc.invalidateQueries({ queryKey: housingQueryKeys.privateDetails(listingId) });
    });
  };

  if (saved.isPending) return null;

  if (saved.data && !editing) {
    return (
      <View testID="housing-host-place-saved">
        <HousingAddressCard listingId={listingId} />
        <SecondaryButton
          testID="housing-host-place-edit"
          label={t('housingStay.privateDetails.edit')}
          onPress={startEdit}
        />
      </View>
    );
  }

  return (
    <View style={styles.box} testID="housing-host-place-editor">
      <Text style={typography.h3}>{t('housingStay.privateDetails.title')}</Text>
      <Text style={styles.caption}>{t('housingStay.privateDetails.hint')}</Text>
      {cityId ? (
        <StreetPicker
          cityId={cityId}
          value={streetLabel && streetId ? { id: String(streetId), name: streetLabel } : null}
          onChange={(s) => {
            setStreetId(Number.parseInt(s.id, 10));
            setStreetLabel(s.name);
          }}
          allowFreeText={false}
          disabled={busy}
        />
      ) : (
        <Text style={styles.caption}>{t('housingStay.privateDetails.needCity')}</Text>
      )}
      <TextField
        label={t('housingStay.privateDetails.houseNumber')}
        value={houseNumber}
        onChangeText={setHouseNumber}
        editable={!busy}
        {...formStreetNumberInputProps}
      />
      <TextField
        label={t('housingStay.privateDetails.apartment')}
        value={apartment}
        onChangeText={setApartment}
        editable={!busy}
        {...formIntegerInputProps}
      />
      <TextField
        label={t('housingStay.privateDetails.floor')}
        value={floor}
        onChangeText={setFloor}
        editable={!busy}
        {...formIntegerInputProps}
      />
      <TextField
        label={t('housingStay.privateDetails.entrance')}
        value={entranceNotes}
        onChangeText={setEntranceNotes}
        multiline
        maxLength={300}
        editable={!busy}
      />
      <TextField
        label={t('housingStay.privateDetails.access')}
        value={accessInstructions}
        onChangeText={setAccessInstructions}
        multiline
        maxLength={500}
        editable={!busy}
      />
      <PrimaryButton testID="housing-host-place-save" label={t('housingStay.privateDetails.save')} loading={busy} onPress={save} />
    </View>
  );
}
