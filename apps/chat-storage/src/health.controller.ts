import { Controller, Get } from '@nestjs/common';

/**
 * Health endpoint tối thiểu để Cloud Run startup/liveness probe pass (container
 * phải lắng nghe trên `$PORT`). Không phục vụ business — toàn bộ việc thật do
 * MessageStoreConsumer xử lý nền.
 */
@Controller()
export class HealthController {
  @Get()
  root() {
    return { status: 'ok', service: 'chat-storage' };
  }

  @Get('health')
  health() {
    return { status: 'ok' };
  }
}
