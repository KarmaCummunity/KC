import { Inject, Injectable } from '@nestjs/common';
import { batchLimit, type JobReport, type ScheduledJob } from '../../platform/jobs/scheduledJob';
import { APP_LOGGER, type AppLogger } from '../../platform/logging/appLogger';
import { PortClients } from '../../platform/ports/portClients';
import { chargeDueStandingOrders, DEFAULT_CHARGE_LIMIT, type DueCharge, MAX_CHARGE_LIMIT } from './standingOrdersCharge';

/** The hourly charge of due standing orders; the rules are in `standingOrdersCharge.ts`. */
@Injectable()
export class StandingOrdersChargeJob implements ScheduledJob {
  readonly name = 'subscriptions-charger';

  constructor(
    @Inject(PortClients) private readonly clients: PortClients,
    @Inject(APP_LOGGER) private readonly logger: AppLogger,
  ) {}

  /** @param input `{ limit? }`: how many due orders to charge in this run (20 by default, 50 at most). */
  run(input: Readonly<Record<string, unknown>>): Promise<JobReport> {
    const service = this.clients.serviceClient();
    return chargeDueStandingOrders(batchLimit(input.limit, DEFAULT_CHARGE_LIMIT, MAX_CHARGE_LIMIT), {
      async openDueCharges(limit) {
        const { data, error } = await service.rpc('api_standing_orders_charge_due', { p_limit: limit });
        if (error) throw new Error(`api_standing_orders_charge_due: ${error.message}`);
        return (data ?? []) as DueCharge[];
      },
      report: (error, intentId) => this.logger.error({ err: error, intentId }, 'standing order charge was not submitted'),
    });
  }
}
