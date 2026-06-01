import {
  Body,
  Controller,
  Headers,
  Inject,
  OnModuleInit,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ClientGrpc } from '@nestjs/microservices';
import type { Observable } from 'rxjs';
import { SERVICES } from '@app/constants/services';
import { GatewayService } from '../gateway/gateway.service';

interface AuthGrpcService {
  getFcmTokens(data: { userIds: string[] }): Observable<unknown>;
  resolveBusinessIds(data: { usrIds: string[] }): Observable<unknown>;
  getUsersBatch(data: { userIds: string[] }): Observable<unknown>;
}

@Controller('internal/auth')
export class GatewayInternalAuthController implements OnModuleInit {
  private authService!: AuthGrpcService;

  constructor(
    @Inject(SERVICES.AUTH) private readonly authClient: ClientGrpc,
    private readonly gatewayService: GatewayService,
    private readonly configService: ConfigService,
  ) {}

  onModuleInit() {
    this.authService =
      this.authClient.getService<AuthGrpcService>('AuthService');
  }

  @Post('users/fcm-tokens')
  async getUserFcmTokens(
    @Body() body: { userIds: string[] },
    @Headers('x-internal-service') internalService?: string,
    @Headers('x-internal-secret') internalSecret?: string,
  ) {
    this.assertInternalRequest(internalService, internalSecret, [
      'notification',
    ]);

    return this.gatewayService.dispatchGrpcRequest(
      this.authService.getFcmTokens.bind(this.authService),
      { userIds: body.userIds || [] },
      30000,
    );
  }

  @Post('fcm-tokens')
  async getUserFcmTokensAlias(
    @Body() body: { userIds: string[] },
    @Headers('x-internal-service') internalService?: string,
    @Headers('x-internal-secret') internalSecret?: string,
  ) {
    return this.getUserFcmTokens(body, internalService, internalSecret);
  }

  @Post('users/resolve-business-ids')
  async resolveBusinessIds(
    @Body() body: { usrIds: string[] },
    @Headers('x-internal-service') internalService?: string,
    @Headers('x-internal-secret') internalSecret?: string,
  ) {
    this.assertInternalRequest(internalService, internalSecret, [
      'notification',
      'filesystem',
    ]);

    return this.gatewayService.dispatchGrpcRequest(
      this.authService.resolveBusinessIds.bind(this.authService),
      { usrIds: body.usrIds || [] },
      30000,
    );
  }

  @Post('users/batch')
  async getUsersBatch(
    @Body() body: { userIds: string[] },
    @Headers('x-internal-service') internalService?: string,
    @Headers('x-internal-secret') internalSecret?: string,
  ) {
    this.assertInternalRequest(internalService, internalSecret, [
      'filesystem',
      'notification',
    ]);

    return this.gatewayService.dispatchGrpcRequest(
      this.authService.getUsersBatch.bind(this.authService),
      { userIds: body.userIds || [] },
      30000,
    );
  }

  private assertInternalRequest(
    internalService?: string,
    internalSecret?: string,
    allowedServices: string[] = ['notification'],
  ) {
    if (!internalService || !allowedServices.includes(internalService)) {
      throw new UnauthorizedException('Invalid internal service');
    }

    const expectedSecret =
      this.configService.get<string>('GATEWAY_INTERNAL_SECRET') || '';
    if (expectedSecret && internalSecret !== expectedSecret) {
      throw new UnauthorizedException('Invalid internal secret');
    }
  }
}
