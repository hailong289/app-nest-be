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
  phone?: string;
  avatar?: string;
  status?: string;
  slug?: string;
}

export interface GatewayRoomSummary {
  mongoRoomId: string;
  roomId: string;
  roomName?: string;
  roomType?: string;
  memberIds: string[];
  currentUserRole?: string;
  canView?: boolean;
  canEdit?: boolean;
}

export interface LearningCardStatus {
  sourceId: string;
  isSend: boolean;
  messageId?: string;
}

@Injectable()
export class GatewayClientService {
  private readonly logger = new Logger(GatewayClientService.name);

  constructor(private readonly configService: ConfigService) {}

  async getUserSummary(userId: string) {
    const users = await this.getUsersSummary([userId]);
    return users[0] ?? null;
  }

  async getUsersSummary(userIds: string[], search?: string) {
    const result = await this.post('/internal/auth/users/batch', {
      userIds,
      search,
    });
    if (result?.statusCode && result.statusCode !== 200) {
      this.logger.warn(
        `Batch user summary failed: ${result.reasonStatusCode || result.message}`,
      );
      return [];
    }

    const items = result?.metadata?.items;
    const users = Array.isArray(items) ? (items as GatewayUserSummary[]) : [];
    const term = search?.trim().toLowerCase();
    if (!term) return users;

    return users.filter((user) =>
      [user.fullname, user.name, user.email, user.phone, user.usr_id, user.id]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(term)),
    );
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
        `Resolve user business ids failed: ${
          result.reasonStatusCode || result.message
        }`,
      );
      return [];
    }

    const items = result?.metadata?.items;
    return Array.isArray(items)
      ? (items as Array<{ usrId: string; userId: string }>)
      : [];
  }

  async resolveRoomForUser(roomId: string, userId: string) {
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

  async checkRoomAccess(roomId: string, userId: string) {
    const result = await this.post('/internal/chat/rooms/check-access', {
      roomId,
      userId,
    });
    if (result?.statusCode && result.statusCode !== 200) {
      return null;
    }
    return (result?.metadata ?? null) as GatewayRoomSummary | null;
  }

  async checkLearningCardStatus(
    sourceType: 'quiz' | 'flashcard_deck' | 'todo_project',
    sourceIds: string[],
    roomId?: string,
  ) {
    const result = await this.post(
      '/internal/chat/messages/learning-card-status',
      {
        sourceType,
        sourceIds,
        roomId,
      },
    );
    if (result?.statusCode && result.statusCode !== 200) {
      this.logger.warn(
        `Learning card status failed: ${result.reasonStatusCode || result.message}`,
      );
      return [];
    }

    const items = result?.metadata?.items;
    return Array.isArray(items) ? (items as LearningCardStatus[]) : [];
  }

  private async post(path: string, body: Record<string, unknown>) {
    const cfg = this.configService.get<GatewayConfig>('gateway');
    const baseUrl = (cfg?.url || 'http://localhost:5000').replace(/\/+$/, '');
    const headers: Record<string, string> = {
      'x-internal-service': 'learning',
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
