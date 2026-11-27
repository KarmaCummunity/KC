import { Global, Module } from '@nestjs/common';
import { APP_LOGGER, appLoggerProvider } from '../logging/appLogger';
import { PortClients } from './portClients';

/**
 * The database clients and the logger every server module works with: the
 * gateway, the hosted functions and the webhook routes. Global, so a feature
 * module injects them without importing the gateway. Needs the database
 * module (also global).
 */
@Global()
@Module({ providers: [appLoggerProvider, PortClients], exports: [APP_LOGGER, PortClients] })
export class PortClientsModule {}
