import { Global, Module } from '@nestjs/common';
import { BackgroundWork } from './backgroundWork';

/** Work that goes on after its request was answered. Global; needs the logger. */
@Global()
@Module({ providers: [BackgroundWork], exports: [BackgroundWork] })
export class BackgroundModule {}
