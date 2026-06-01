import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Utils from '@app/helpers/utils';

interface GatewayConfig {
  url: string;
  internalSecret?: string;
}

export interface GatewayUserSummary {
  _id: string;
  userId?: string;
  usr_id?: string;
  id?: string;
  name?: string;
  fullname?: string;
  email?: string;
  avatar?: string;
  status?: string;
}

export interface GatewayRoomMember {
  userId: string;
  role?: string;
  joinedAt?: string;
  name?: string;
  avatar?: string;
  usrId?: string;
}

export interface GatewayRoomSummary {
  mongoRoomId: string;
  roomId: string;
  roomName?: string;
  roomType?: string;
  memberIds: string[];
  members: GatewayRoomMember[];
  currentUserRole?: string;
}

@Injectable()
export class GatewayClientService {
  private readonly logger = new Logger(GatewayClientService.name);

  constructor(private readonly configService: ConfigService) {}

  async getUserSummary(userId: string): Promise<GatewayUserSummary | null> {
    const users = await this.getUsersSummary([userId]);
    return users[0] ?? null;
  }

  async getUsersSummary(userIds: string[]): Promise<GatewayUserSummary[]> {
    const result = await this.post('/internal/auth/users/batch', { userIds });
    if (result?.statusCode && result.statusCode !== 200) {
      this.logger.warn(
        `Batch user summary failed: ${result.reasonStatusCode || result.message}`,
      );
      return [];
    }

    const items = result?.metadata?.items;
    return Array.isArray(items) ? (items as GatewayUserSummary[]) : [];
  }

  async resolveUserBusinessIds(
    usrIds: string[],
  ): Promise<Array<{ usrId: string; userId: string }>> {
    const result = await this.post(
      '/internal/auth/users/resolve-business-ids',
      {
        usrIds,
      },
    );
    if (result?.statusCode && result.statusCode !== 200) {
      this.logger.warn(
        `Resolve business ids failed: ${result.reasonStatusCode || result.message}`,
      );
      return [];
    }

    const items = result?.metadata?.items;
    return Array.isArray(items)
      ? (items as Array<{ usrId: string; userId: string }>)
      : [];
  }

  async resolveRoomForUser(
    roomId: string,
    userId?: string,
  ): Promise<GatewayRoomSummary | null> {
    const result = await this.post('/internal/chat/rooms/resolve', {
      roomId,
      userId,
    });
    if (result?.statusCode && result.statusCode !== 200) {
      this.logger.warn(
        `Resolve room failed: ${result.reasonStatusCode || result.message}`,
      );
      return null;
    }
    return (result?.metadata ?? null) as GatewayRoomSummary | null;
  }

  async getRoomMembers(
    roomId: string,
    userId?: string,
  ): Promise<GatewayRoomSummary | null> {
    const result = await this.post('/internal/chat/rooms/members', {
      roomId,
      userId,
    });
    if (result?.statusCode && result.statusCode !== 200) {
      this.logger.warn(
        `Get room members failed: ${result.reasonStatusCode || result.message}`,
      );
      return null;
    }
    return (result?.metadata ?? null) as GatewayRoomSummary | null;
  }

  async checkRoomAccess(roomId: string, userId: string) {
    const result = await this.post('/internal/chat/rooms/check-access', {
      roomId,
      userId,
    });
    if (result?.statusCode && result.statusCode !== 200) {
      return null;
    }
    return (result?.metadata ?? null) as
      | (GatewayRoomSummary & { canView?: boolean; canEdit?: boolean })
      | null;
  }

  async attachFilesToMessage(
    messageId: string,
    body: {
      roomId?: string;
      actorUserId: string;
      attachmentIds: string[];
    },
  ) {
    const result = await this.post(
      `/internal/chat/messages/${messageId}/attachments`,
      body,
    );
    if (result?.statusCode && result.statusCode !== 200) {
      this.logger.warn(
        `Attach files to message failed: ${result.reasonStatusCode || result.message}`,
      );
    }
    return result;
  }

  private async post(path: string, body: Record<string, unknown>) {
    const cfg = this.configService.get<GatewayConfig>('gateway');
    const baseUrl = (cfg?.url || 'http://localhost:5000').replace(/\/+$/, '');
    const headers: Record<string, string> = {
      'x-internal-service': 'filesystem',
    };
    if (cfg?.internalSecret) {
      headers['x-internal-secret'] = cfg.internalSecret;
    }

    const gatewayPath = baseUrl.endsWith('/api') ? path : `/api${path}`;
    return Utils.callApiGateway(
      `${baseUrl}${gatewayPath}`,
      'POST',
      body,
      headers,
      15_000,
    );
  }
}
