import { Module, Global } from '@nestjs/common';
import { SfuService } from './sfu.service';
import { SfuRoomService } from './room/sfu-room.service';
import { SfuTransportService } from './transport/sfu-transport.service';

import { UnifiedSignalHandler } from './unified-signal.handler';

@Global()
@Module({
  providers: [
    SfuService,
    SfuRoomService,
    SfuTransportService,
    UnifiedSignalHandler,
  ],
  exports: [
    SfuService,
    SfuRoomService,
    SfuTransportService,
    UnifiedSignalHandler,
  ],
})
export class SfuModule {}
