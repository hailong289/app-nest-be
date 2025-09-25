import { LoginDto, RegisterDto } from "@app/dto";
import { Body, Controller, Inject, Post, Req, UseGuards } from "@nestjs/common";
import { ClientProxy, Payload } from "@nestjs/microservices";
import { GatewayService } from "../gateway.service";
import { SERVICES } from "@app/constants/services";

@Controller('auth')
export class GatewayAuthController {
    public constructor(
        @Inject(SERVICES.AUTH) private readonly authClient: ClientProxy,
        private readonly gatewayService: GatewayService,
    ) { }

    // Auth endpoints
    @Post('login')
    async login(@Body() loginDto: LoginDto) {
        console.log('Login DTO:', loginDto);
        return await this.gatewayService.dispatchServiceRequest(this.authClient, 'login', loginDto);
    }

    @Post('register')
    async register(@Body() registerDto: RegisterDto) {
        return await this.gatewayService.dispatchServiceRequest(this.authClient, 'register', registerDto);
    }

    @Post('logout')
    async logout(@Req() req: any) {
        return await this.gatewayService.dispatchServiceRequest(this.authClient, 'logout', {
            token: req.headers.authorization?.split(' ')[1],
        });
    }
}