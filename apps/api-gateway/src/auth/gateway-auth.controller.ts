import { LoginDto, RegisterDto } from "@app/dto";
import { Body, Controller, Inject, Post } from "@nestjs/common";
import { ClientProxy } from "@nestjs/microservices";
import { firstValueFrom } from "rxjs";

@Controller('auth')
export class GatewayAuthController {
    public constructor(
        @Inject('AUTH_SERVICE') private readonly authClient: ClientProxy,
    ) { }

     // Auth endpoints
    @Post('login')
    async login(@Body() loginDto: LoginDto) {
        console.log('Login DTO:', loginDto);
        return await firstValueFrom(this.authClient.send('login', loginDto));
    }

    @Post('register')
    async register(@Body() registerDto: RegisterDto) {
        return await firstValueFrom(this.authClient.send('register', registerDto));
    }
}