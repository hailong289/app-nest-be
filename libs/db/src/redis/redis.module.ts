// packages/redis/src/redis.module.ts
import { Module, Global, DynamicModule } from '@nestjs/common';
import { RedisService } from './redis.service';
import Redis, { Redis as RedisInstance } from 'ioredis';
import { RedisModuleOptions } from './types';

@Global()
@Module({
  providers: [RedisService],
  exports: [RedisService],
})
export class RedisModule {
  static forRoot(opstions: RedisModuleOptions): DynamicModule {
    return {
      module: RedisModule,
      global: true,
      providers: [
        {
          provide: 'REDIS',
          useFactory: () => {
            // By default prefer immediate connect (lazyConnect = false)
            const client = new Redis({
              lazyConnect: opstions.lazyConnect ?? false,
              ...opstions,
            }) as RedisInstance;

            client.on('connect', () =>
              console.log(
                `✅ Redis connected to ${opstions.host}:${opstions.port}`,
              ),
            );
            client.on('error', (err) =>
              console.error(
                '❌ Redis connection error:',
                err instanceof Error ? err.message : String(err),
              ),
            );

            // If the client was created with lazyConnect=false it will try to connect automatically.
            // If lazyConnect=true we don't attempt to connect here to preserve the caller's intent.
            if (!(opstions.lazyConnect ?? false)) {
              // no-await here because this factory is sync; the client will connect in background
              try {
                const status = client.status;
                if (status !== 'connecting' && status !== 'ready') {
                  // eslint-disable-next-line @typescript-eslint/no-floating-promises
                  client.connect();
                }
              } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                console.error(
                  '❌ Redis connect() failed during module init:',
                  msg,
                );
              }
            }

            return client;
          },
        },
      ],
      exports: ['REDIS'],
    };
  }

  static forRootAsync(options: {
    useFactory: (
      ...args: any[]
    ) => RedisModuleOptions | Promise<RedisModuleOptions>;
    inject?: any[];
    global?: boolean;
  }): DynamicModule {
    return {
      module: RedisModule,
      global: options.global ?? true,
      providers: [
        {
          provide: 'REDIS',
          inject: options.inject || [],
          useFactory: async (...args: any[]) => {
            const opts = await options.useFactory(...args);
            const client = new Redis({
              lazyConnect: opts.lazyConnect ?? false,
              ...opts,
            }) as RedisInstance;

            client.on('connect', () =>
              console.log(`✅ Redis connected to ${opts.host}:${opts.port}`),
            );
            client.on('error', (err) =>
              console.error('❌ Redis connection error:', err.message),
            );

            // Helper: wait until client emits 'ready' or 'connect' or fails
            function waitForReady(c: RedisInstance, timeout = 5000) {
              return new Promise<void>((resolve, reject) => {
                const onReady = () => {
                  cleanup();
                  resolve();
                };

                const onError = (e: unknown) => {
                  cleanup();
                  reject(e instanceof Error ? e : new Error(String(e)));
                };

                const onEnd = () => {
                  cleanup();
                  reject(new Error('redis connection ended'));
                };

                function cleanup() {
                  c.off('ready', onReady);
                  c.off('connect', onReady);
                  c.off('error', onError);
                  c.off('end', onEnd);
                  clearTimeout(timer);
                }

                c.once('ready', onReady);
                c.once('connect', onReady);
                c.once('error', onError);
                c.once('end', onEnd);

                const timer = setTimeout(() => {
                  cleanup();
                  reject(new Error('timeout waiting for redis ready'));
                }, timeout);
              });
            }

            try {
              // actively connect so the app logs success/failure during startup
              const status = client.status;
              if (status === 'connecting') {
                // another part triggered connect(); wait for it to finish
                await waitForReady(client, 5000);
              } else if (status !== 'ready') {
                await client.connect();
              }
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              console.error('❌ Redis initial connect() failed:', msg);
            }

            return client;
          },
        },
      ],
      exports: ['REDIS'],
    };
  }
}
