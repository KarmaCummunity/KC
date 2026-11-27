import { Body, Controller, HttpCode, Inject, Post, Res, UseGuards } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { AuthenticatedGuard } from '../identity/authenticated.guard';
import { Caller } from '../identity/caller.decorator';
import type { CallerIdentity } from '../identity/callerIdentity';
import { sendAnswer } from '../webhooks/webhookRequest';
import { StorageService } from './storageService';

/**
 * The member's side of file storage (ADR-012 section 4), under `/v1/storage`.
 * Every route needs a signed-in member; what that member may do with a given
 * file is decided by the policies on `storage.objects` (`StorageService`).
 */
@Controller('storage')
@UseGuards(AuthenticatedGuard)
export class StorageController {
  constructor(@Inject(StorageService) private readonly storage: StorageService) {}

  /** `{ bucket, name, contentType, size, cacheControl? }` → `{ upload: { url, method, headers, expiresAt } }`. */
  @Post('uploads')
  @HttpCode(200)
  async grantUpload(@Caller() caller: CallerIdentity, @Body() body: unknown, @Res({ passthrough: true }) reply: FastifyReply): Promise<unknown> {
    return sendAnswer(reply, await this.storage.grantUpload(caller, body));
  }

  /** `{ bucket, name }`, after the bytes were sent → `{ path }`. */
  @Post('uploads/complete')
  @HttpCode(200)
  async completeUpload(@Caller() caller: CallerIdentity, @Body() body: unknown, @Res({ passthrough: true }) reply: FastifyReply): Promise<unknown> {
    return sendAnswer(reply, await this.storage.completeUpload(caller, body));
  }

  /** `{ bucket, name, expiresIn }` (seconds) → `{ signedUrl }` of a private file. */
  @Post('signed-urls')
  @HttpCode(200)
  async signedReadUrl(@Caller() caller: CallerIdentity, @Body() body: unknown, @Res({ passthrough: true }) reply: FastifyReply): Promise<unknown> {
    return sendAnswer(reply, await this.storage.signedReadUrl(caller, body));
  }

  /** `{ bucket, names }` → `{ deleted }`. */
  @Post('objects/delete')
  @HttpCode(200)
  async deleteObjects(@Caller() caller: CallerIdentity, @Body() body: unknown, @Res({ passthrough: true }) reply: FastifyReply): Promise<unknown> {
    return sendAnswer(reply, await this.storage.deleteObjects(caller, body));
  }
}
