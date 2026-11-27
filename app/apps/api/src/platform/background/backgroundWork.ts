import { Inject, Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { APP_LOGGER, type AppLogger } from '../logging/appLogger';

/**
 * Work that goes on after its request was answered: a webhook must answer its
 * provider at once, while what the message asks for (a download, a model
 * call) takes seconds. The work's outcome reaches the member some other way
 * (a queued reply), so the request does not wait for it.
 *
 * The work lives in this process: a shutdown waits for what is running, and a
 * failure is logged with the work's name. It is not a queue: work is lost if
 * the process is killed, and each piece must be safe to lose (the member can
 * send the message again).
 */
@Injectable()
export class BackgroundWork implements OnApplicationShutdown {
  private readonly running = new Set<Promise<void>>();

  constructor(@Inject(APP_LOGGER) private readonly logger: AppLogger) {}

  /**
   * Starts `work` and returns at once.
   * @param name What the work is, for the log; never data of a member.
   */
  start(name: string, work: () => Promise<unknown>): void {
    const tracked: Promise<void> = Promise.resolve()
      .then(work)
      .then(
        () => undefined,
        (error: unknown) => this.logger.error({ err: error, work: name }, 'background work failed'),
      )
      .finally(() => this.running.delete(tracked));
    this.running.add(tracked);
  }

  /** Resolves when everything that was started has ended. */
  async idle(): Promise<void> {
    while (this.running.size > 0) await Promise.all(this.running);
  }

  onApplicationShutdown(): Promise<void> {
    return this.idle();
  }
}
