import { Module, Global } from '@nestjs/common';
import { SfuService } from './sfu.service';
import { SfuRoomService } from './room/sfu-room.service';
import { SfuTransportService } from './transport/sfu-transport.service';

/**
 * In-process mediasoup engine: workers, rooms, transports.
 * Lives entirely inside apps/sfu (the VM with mediasoup native binary).
 */
@Global()
@Module({
  providers: [SfuService, SfuRoomService, SfuTransportService],
  exports: [SfuService, SfuRoomService, SfuTransportService],
})
export class SfuModule {}
