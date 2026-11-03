// FR-RIDE-005 — sticky anchored-ride card in chat (mirrors AnchoredPostCard).
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { he as dateFnsHe } from 'date-fns/locale';
import { makeUseStyles, spacing } from '@kc/ui';
import { useAuthStore } from '../../store/authStore';
import { getRideListingUseCase } from '../../features/rides/composition/ridesComposition';
import { KcRowCard } from '../cards/KcRowCard';
import { cleanDisplayTitle } from '../../lib/displayTitle';

interface Props {
  readonly anchorRideId: string | null;
}

export function AnchoredRideCard({ anchorRideId }: Props) {
  const { t } = useTranslation();
  const styles = useStyles();
  const router = useRouter();
  const viewerId = useAuthStore((s) => s.session?.userId)!;

  const query = useQuery({
    queryKey: ['ride', anchorRideId, viewerId],
    queryFn: () => getRideListingUseCase().execute({ rideId: anchorRideId!, viewerId }),
    enabled: Boolean(anchorRideId),
  });

  const ride = query.data;
  if (!anchorRideId || !ride || ride.status !== 'open') return null;

  const isOffer = ride.mode === 'offer';
  const departsLabel = format(new Date(ride.departsAt), 'dd/MM HH:mm', { locale: dateFnsHe });

  const openRide = () => {
    router.push(`/(tabs)/donations/rides/${ride.rideId}`);
  };

  return (
    <KcRowCard
      testID="chat-anchored-ride"
      containerStyle={styles.banner}
      onPress={openRide}
      accessibilityLabel={t('donations.rides.anchoredOpenA11y')}
      tone={isOffer ? 'give' : 'request'}
      badgeLabel={isOffer ? t('donations.rides.badgeOffer') : t('donations.rides.badgeRequest')}
      placeholderIcon="car-outline"
      title={cleanDisplayTitle(ride.title)}
      meta={[`${ride.originCityName} → ${ride.destCityName} · ${departsLabel}`]}
      openLinkLabel={t('cards.openFullPost')}
    />
  );
}

const useStyles = makeUseStyles(() => ({
  banner: { marginHorizontal: spacing.base, marginTop: spacing.sm },
}));
