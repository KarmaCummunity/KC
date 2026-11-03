// The display name of a city id in the app language, from the same cached city list the city
// picker loads (`['cities']`, one hour). Null while loading, for an unknown id or for no id.
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { City } from '@kc/domain';
import { listCities } from '../services/userComposition';

const CITIES_STALE_MS = 1000 * 60 * 60;

/** The city's name in the app language (Hebrew name as the fallback), or null. */
export function useCityName(cityId: string | null | undefined): string | null {
  const { i18n } = useTranslation();
  const { data } = useQuery<City[]>({
    queryKey: ['cities'],
    queryFn: listCities,
    staleTime: CITIES_STALE_MS,
    enabled: Boolean(cityId),
  });
  const city = cityId ? data?.find((c) => c.cityId === cityId) : undefined;
  if (!city) return null;
  return i18n.language === 'en' && city.nameEn ? city.nameEn : city.nameHe;
}
