import React from 'react';
import { useTranslation } from 'react-i18next';
import type { MarketplaceListingDetail } from '@kc/domain';
import { givingHandoffUseCases } from '../../services/givingHandoffComposition';
import { ridesKnowledgeRpcs } from '../../services/ridesKnowledgeComposition';
import { HandoffActionButton } from './HandoffActionButton';

interface Props {
  detail: MarketplaceListingDetail;
  isOwner: boolean;
  isAvailableForRequest: boolean;
  hasHandoff: boolean;
  busy: boolean;
  run: (
    fn: () => Promise<void>,
    analytics?: 'match_made' | 'handover_completed',
    offlineAction?: {
      action: 'reserve_item' | 'claim_food' | 'confirm_handoff';
      payload: Record<string, unknown>;
    },
  ) => Promise<void>;
}

export function GivingHandoffRequestButtons({
  detail,
  isOwner,
  isAvailableForRequest,
  hasHandoff,
  busy,
  run,
}: Props) {
  const { t } = useTranslation();

  if (hasHandoff || !isAvailableForRequest || isOwner) {
    return null;
  }

  if (detail.worldSlug === 'items' || detail.worldSlug === 'animals') {
    return (
      <>
        <HandoffActionButton
          testID="giving-handoff-reserve"
          label={t('givingHandoff.reserveItem')}
          busy={busy}
          onPress={() =>
            run(
              async () => {
                await givingHandoffUseCases.reserveItem().execute(detail.listingId, 'pickup');
              },
              'match_made',
              {
                action: 'reserve_item',
                payload: { listingId: detail.listingId, pickupMode: 'pickup' },
              },
            )
          }
        />
        {detail.worldSlug === 'items' ? (
          <HandoffActionButton
            testID="giving-handoff-reserve-delivery"
            label={t('givingHandoff.reserveDelivery')}
            busy={busy}
            secondary
            onPress={() =>
              run(
                async () => {
                  await givingHandoffUseCases.reserveItem().execute(detail.listingId, 'delivery');
                },
                'match_made',
                {
                  action: 'reserve_item',
                  payload: { listingId: detail.listingId, pickupMode: 'delivery' },
                },
              )
            }
          />
        ) : null}
      </>
    );
  }

  if (detail.worldSlug === 'food') {
    return (
      <HandoffActionButton
        testID="giving-handoff-claim"
        label={t('givingHandoff.claimFood')}
        busy={busy}
        onPress={() =>
          run(
            async () => {
              await givingHandoffUseCases.claimFood().execute(detail.listingId);
            },
            'match_made',
            {
              action: 'claim_food',
              payload: { listingId: detail.listingId },
            },
          )
        }
      />
    );
  }

  if (detail.worldSlug === 'knowledge') {
    return (
      <HandoffActionButton
        testID="giving-handoff-book-slot"
        label={t('givingHandoff.bookKnowledgeSlot')}
        busy={busy}
        onPress={() =>
          run(
            async () => {
              await ridesKnowledgeRpcs.bookKnowledgeSlot(detail.listingId);
            },
            'match_made',
          )
        }
      />
    );
  }

  return null;
}
