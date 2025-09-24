import { Controller, Get } from '@nestjs/common';
import { GatewayService } from './gateway.service';

@Controller('gateway')
export class GatewayController {

    constructor(
        private readonly gatewayService: GatewayService,
    ) { }

    @Get()
    getHealth() {
        return this.gatewayService.getHealth();
    }
}