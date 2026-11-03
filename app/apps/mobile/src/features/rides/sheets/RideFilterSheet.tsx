// FR-RIDE-002 — ride hub filter bottom sheet (mirrors SearchFilterSheet).
// Rebuilt on top of the shared filterKit (issue #1457).
import React, { useState } from 'react';
import { View } from 'react-native';
import { endOfDay, startOfDay } from 'date-fns';
import { useTranslation } from 'react-i18next';
import type { RideMode } from '@kc/domain';
import { makeUseStyles, spacing, typography, Text } from '@kc/ui';
import { CityPicker } from '../../../components/CityPicker';
import { FilterSheetFrame, FilterSection } from '../../../components/filterKit';
import { useRidesFilterStore } from '../store/ridesFilterStore';
import { rtlTextAlignStart } from '../../../lib/rtlTextAlignStart';

interface Props {
  readonly visible: boolean;
  readonly onClose: () => void;
}

export function RideFilterSheet({ visible, onClose }: Props) {
  const { t } = useTranslation();
  const styles = useStyles();
  const store = useRidesFilterStore();

  const [originCity, setOriginCity] = useState<{ id: string; name: string } | null>(
    store.originCityId ? { id: store.originCityId, name: store.originCityName ?? '' } : null,
  );
  const [destCity, setDestCity] = useState<{ id: string; name: string } | null>(
    store.destCityId ? { id: store.destCityId, name: store.destCityName ?? '' } : null,
  );
  const [mode, setMode] = useState<RideMode | null>(store.mode);
  const [dateToday, setDateToday] = useState(Boolean(store.departFrom || store.departTo));

  const handleApply = () => {
    store.setOriginCity(originCity?.id ?? null, originCity?.name ?? null);
    store.setDestCity(destCity?.id ?? null, destCity?.name ?? null);
    store.setMode(mode);
    if (dateToday) {
      const now = new Date();
      store.setDepartRange(startOfDay(now).toISOString(), endOfDay(now).toISOString());
    } else {
      store.setDepartRange(null, null);
    }
    onClose();
  };

  const handleClear = () => {
    setOriginCity(null);
    setDestCity(null);
    setMode(null);
    setDateToday(false);
    store.clearFilters();
    onClose();
  };

  const modeOptions = [
    { value: 'offer' as const, label: t('donations.rides.modeOffer') },
    { value: 'request' as const, label: t('donations.rides.modeRequest') },
  ];

  const departOptions = [
    { value: 'today', label: t('donations.rides.departToday') },
  ];

  return (
    <FilterSheetFrame
      visible={visible}
      onDismiss={onClose}
      title={t('donations.rides.filtersTitle')}
      applyLabel={t('donations.rides.applyFilters')}
      onApply={handleApply}
      clearLabel={t('donations.rides.clearFilters')}
      onClear={handleClear}
    >
      <FilterSection<RideMode>
        title={t('donations.rides.filterMode')}
        allLabel={t('donations.rides.modeAll')}
        options={modeOptions}
        value={mode}
        onChange={setMode}
      />

      <View style={styles.citySection}>
        <Text style={styles.cityTitle}>{t('donations.rides.filterOrigin')}</Text>
        <CityPicker value={originCity} onChange={setOriginCity} />
      </View>

      <View style={styles.citySection}>
        <Text style={styles.cityTitle}>{t('donations.rides.filterDest')}</Text>
        <CityPicker value={destCity} onChange={setDestCity} />
      </View>

      <FilterSection<string>
        title={t('donations.rides.filterDepart')}
        showAllChip={false}
        options={departOptions}
        value={dateToday ? 'today' : null}
        onChange={(v) => setDateToday(v === 'today')}
      />
    </FilterSheetFrame>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  citySection: { gap: spacing.xs, marginBottom: spacing.md },
  cityTitle: { ...typography.label, color: colors.textPrimary, textAlign: rtlTextAlignStart },
}));
