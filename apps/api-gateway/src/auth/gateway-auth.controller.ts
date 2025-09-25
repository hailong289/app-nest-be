import { LoginDto, RegisterDto } from "@app/dto";
import { Body, Controller, Inject, Post, Req, UseGuards } from "@nestjs/common";
import { ClientKafka, ClientProxy, Payload } from "@nestjs/microservices";
import { GatewayService } from "../gateway.service";
import { SERVICES } from "@app/constants/services";
// test
@Controller('auth')
export class GatewayAuthController {
    public constructor(
        @Inject(SERVICES.AUTH) private readonly authClient: ClientKafka,
        private readonly gatewayService: GatewayService,
    ) { }

    async onModuleInit() {
        // Ensure the Kafka client is connected
        ['login', 'register', 'logout'].forEach((key) => {
            this.authClient.subscribeToResponseOf(key);
        });
        try {
            await this.authClient.connect();
        } catch (error) {
            console.error('Error connecting to Kafka:', error);
        }
    }

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