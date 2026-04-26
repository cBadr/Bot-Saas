import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import Redis from 'ioredis';
import { env } from '@orca/config';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  public readonly client: Redis;
  public readonly publisher: Redis;
  public readonly subscriber: Redis;

  constructor() {
    const opts = {
      host: env.REDIS_HOST,
      port: env.REDIS_PORT,
      password: env.REDIS_PASSWORD || undefined,
      db: env.REDIS_DB,
      lazyConnect: true,
      maxRetriesPerRequest: 3,
    };
    this.client = new Redis(opts);
    this.publisher = new Redis(opts);
    this.subscriber = new Redis(opts);
  }

  async onModuleInit() {
    await Promise.all([this.client.connect(), this.publisher.connect(), this.subscriber.connect()]);
  }

  async onModuleDestroy() {
    await Promise.all([this.client.quit(), this.publisher.quit(), this.subscriber.quit()]);
  }
}
