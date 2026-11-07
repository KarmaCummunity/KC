// Owner panel entry: skip the delivery question and open the recipient picker (FR-CLOSURE-011).
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../../store/authStore';
import { useClosureStore } from '../../store/closureStore';
import { listingOfferAllowsCloseWithout } from '../../lib/listingOwnerClosure';
import { HandoffActionButton } from '../marketplace/HandoffActionButton';

interface Props {
  readonly targetId: string;
  readonly worldSlug: string;
}

export function OwnerAssignUserButton({ targetId, worldSlug }: Props) {
  const { t } = useTranslation();
  const userId = useAuthStore((s) => s.session?.userId ?? null);
  const start = useClosureStore((s) => s.start);
  if (!userId) return null;

  return (
    <HandoffActionButton
      testID="owner-assign-user"
      label={t('closure.assignUserCta')}
      busy={false}
      onPress={() => {
        void start(targetId, userId, 'Give', {
          initiator: 'owner-assign',
          startAt: 'pick',
          offerAssign: true,
          allowCloseWithout: listingOfferAllowsCloseWithout(worldSlug),
          worldSlug,
        });
      }}
    />
  );
}
