import { Inject, Injectable } from '@nestjs/common';
import type { JobReport, ScheduledJob } from '../../platform/jobs/scheduledJob';
import { PortClients } from '../../platform/ports/portClients';

/**
 * The daily rotation of the public research hashing salt (FR-RESEARCH-002
 * AC3). The database owns the salt: this job only asks it to replace the
 * value, so yesterday's address hashes can no longer be linked to today's
 * visitors. Ported from `supabase/functions/rotate-research-salt`.
 */
@Injectable()
export class RotateResearchSaltJob implements ScheduledJob {
  readonly name = 'rotate-research-salt';

  constructor(@Inject(PortClients) private readonly clients: PortClients) {}

  /** @returns `{ rotated_at }`, the rotation time as the database reports it (ISO 8601). */
  async run(): Promise<JobReport> {
    const { data, error } = await this.clients.serviceClient().rpc('rotate_research_salt');
    if (error) throw new Error(`rotate_research_salt: ${error.message}`);
    return { rotated_at: String(data) };
  }
}
