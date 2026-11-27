import 'reflect-metadata';
import { AppModule } from './app.module';
import { createApp } from './createApp';
import { loadApiConfig } from './platform/config/apiConfig';

/** Process entry point: read the configuration, build the app, listen. */
async function bootstrap(): Promise<void> {
  const config = loadApiConfig(process.env);
  const app = await createApp(AppModule.forRoot(config), config);
  await app.listen(config.port, config.host);
}

bootstrap().catch((error: unknown) => {
  // Start-up failures happen before the request logger exists.
  console.error(error);
  process.exitCode = 1;
});
