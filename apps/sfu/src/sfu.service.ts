import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as mediasoup from 'mediasoup';
import { types as MediasoupTypes } from 'mediasoup';
import * as os from 'os';
import { mediasoupConfig, ensureAnnouncedIp } from './config/mediasoup.config';

type Worker = MediasoupTypes.Worker;
type Router = MediasoupTypes.Router;

@Injectable()
export class SfuService implements OnModuleInit {
  private readonly logger = new Logger(SfuService.name);
  private workers: Worker[] = [];
  private routers: Map<string, Router> = new Map();
  private nextWorkerIdx = 0;

  async onModuleInit() {
    await this.resolveAnnouncedIp();
    await this.createWorkers();
  }

  private async resolveAnnouncedIp() {
    const { announcedIp, source } = await ensureAnnouncedIp();
    this.logger.log(
      `Mediasoup ANNOUNCED_IP = ${announcedIp} (source: ${source})`,
    );
    if (
      source === 'fallback' ||
      (announcedIp === '127.0.0.1' && process.env.NODE_ENV === 'production')
    ) {
      this.logger.warn(
        `ANNOUNCED_IP fell back to ${announcedIp} — browser clients will NOT be able to reach this SFU. ` +
          `Set MEDIASOUP_ANNOUNCED_IP env to the VM's public IP.`,
      );
    }
  }

  private async createWorkers() {
    const numWorkers = mediasoupConfig.numWorkers;
    const cpuCount = os.cpus().length;
    this.logger.log(
      `Creating ${numWorkers} mediasoup workers (host has ${cpuCount} CPU cores)`,
    );

    for (let i = 0; i < numWorkers; i++) {
      try {
        const worker = await mediasoup.createWorker({
          rtcMinPort: mediasoupConfig.worker.rtcMinPort,
          rtcMaxPort: mediasoupConfig.worker.rtcMaxPort,
          logLevel: mediasoupConfig.worker
            .logLevel as MediasoupTypes.WorkerLogLevel,
          logTags: mediasoupConfig.worker
            .logTags as MediasoupTypes.WorkerLogTag[],
        });

        worker.on('died', () => {
          this.logger.error(
            `mediasoup Worker died, PID: ${worker.pid}, exiting in 2s...`,
          );
          setTimeout(() => process.exit(1), 2000);
        });

        this.workers.push(worker as Worker);
        this.logger.log(`mediasoup Worker created [PID:${worker.pid}]`);
      } catch (error) {
        this.logger.error('Failed to create mediasoup worker:', error);
        throw error;
      }
    }
  }

  getNextWorker(): Worker {
    const worker = this.workers[this.nextWorkerIdx];
    this.nextWorkerIdx = (this.nextWorkerIdx + 1) % this.workers.length;
    return worker;
  }

  async createRouter(roomId: string): Promise<Router> {
    if (this.routers.has(roomId)) {
      return this.routers.get(roomId)!;
    }

    const worker = this.getNextWorker();
    const router = await worker.createRouter({
      mediaCodecs: mediasoupConfig.router.mediaCodecs,
    });

    this.routers.set(roomId, router as Router);
    this.logger.log(`Router created for room: ${roomId}`);
    return router as Router;
  }

  getRouter(roomId: string): Router | undefined {
    return this.routers.get(roomId);
  }

  deleteRouter(roomId: string): void {
    const router = this.routers.get(roomId);
    if (router) {
      router.close();
      this.routers.delete(roomId);
      this.logger.log(`Router closed for room: ${roomId}`);
    }
  }

  getWorkers(): Worker[] {
    return this.workers;
  }

  async getStats() {
    return {
      workers: this.workers.length,
      activeRooms: this.routers.size,
      workerStats: await Promise.all(
        this.workers.map(async (worker, idx) => ({
          workerId: idx,
          pid: worker.pid,
          resourceUsage: await worker.getResourceUsage(),
        })),
      ),
    };
  }
}
