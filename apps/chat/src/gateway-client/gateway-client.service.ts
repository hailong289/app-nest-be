import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Utils from '@app/helpers/utils';

interface GatewayConfig {
  url: string;
  internalSecret?: string;
}

export interface UserSummary {
  _id: string; // Mongo ObjectId string
  usr_id: string; // business id (usr_id)
  usr_fullname: string;
  usr_avatar: string;
  usr_email?: string;
  usr_phone?: string;
  usr_status?: string;
}

export type LearningCardType = 'quiz' | 'flashcard_deck' | 'todo_project';

export interface HydrateLearningCardItem {
  type: LearningCardType;
  id: string;
}

@Injectable()
export class GatewayClientService {
  private readonly log = new Logger(GatewayClientService.name);

  constructor(private readonly configService: ConfigService) {}

  private get headers(): Record<string, string> {
    const cfg = this.configService.get<GatewayConfig>('gateway');
    const h: Record<string, string> = { 'x-internal-service': 'chat' };
    if (cfg?.internalSecret) h['x-internal-secret'] = cfg.internalSecret;
    return h;
  }

  private buildUrl(path: string): string {
    const cfg = this.configService.get<GatewayConfig>('gateway');
    const baseUrl = (cfg?.url || 'http://localhost:5000').replace(/\/+$/, '');
    const prefix = baseUrl.endsWith('/api') ? '' : '/api';
    return `${baseUrl}${prefix}${path}`;
  }

  private async post(path: string, body: Record<string, unknown>, timeout = 10_000) {
    return Utils.callApiGateway(
      this.buildUrl(path),
      'POST',
      body,
      this.headers,
      timeout,
    );
  }

  private metadataItems(res: any): any[] {
    const metadata = res?.metadata;
    if (Array.isArray(metadata)) return metadata;
    if (Array.isArray(metadata?.items)) return metadata.items;
    if (Array.isArray(metadata?.users)) return metadata.users;
    if (Array.isArray(metadata?.metadata)) return metadata.metadata;
    return [];
  }

  private normalizeUser(raw: any): UserSummary | null {
    const mongoId = raw?._id ?? raw?.userId;
    const usrId = raw?.usr_id ?? raw?.usrId ?? raw?.id;
    if (!mongoId || !usrId) return null;

    return {
      _id: String(mongoId),
      usr_id: String(usrId),
      usr_fullname: String(raw?.usr_fullname ?? raw?.fullname ?? raw?.name ?? ''),
      usr_avatar: String(raw?.usr_avatar ?? raw?.avatar ?? ''),
      usr_email: raw?.usr_email ?? raw?.email,
      usr_phone: raw?.usr_phone ?? raw?.phone,
      usr_status: raw?.usr_status ?? raw?.status,
    };
  }

  private normalizeUsers(rawItems: any[]): UserSummary[] {
    return rawItems
      .map((item) => this.normalizeUser(item))
      .filter((user): user is UserSummary => Boolean(user));
  }

  /**
   * Lấy thông tin 1 user theo Mongo _id.
   * Trả null nếu không tìm thấy hoặc gateway lỗi.
   */
  async getUserSummary(userId: string): Promise<UserSummary | null> {
    if (!userId) return null;
    const result = await this.getUsersSummary([userId]);
    return result[0] ?? null;
  }

  /**
   * Lấy thông tin nhiều users theo Mongo _id.
   * Input: Mongo _id strings.
   * Output: array UserSummary (có thể ít hơn input nếu không tìm thấy).
   */
  async getUsersSummary(userIds: string[]): Promise<UserSummary[]> {
    if (!userIds?.length) return [];
    try {
      const res = await this.post('/internal/auth/users/batch', { userIds });
      if (res?.statusCode !== 200) {
        this.log.warn(
          `getUsersSummary: gateway returned ${String(res?.statusCode)}`,
        );
        return [];
      }
      return this.normalizeUsers(this.metadataItems(res));
    } catch (err) {
      this.log.error(
        `getUsersSummary error: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return [];
    }
  }

  /**
   * Resolve user Mongo _id từ business usr_id.
   * Dùng khi caller chỉ có usr_id mà cần Mongo _id để ghi vào ObjectId field.
   */
  async resolveUsersByBusinessIds(usrIds: string[]): Promise<UserSummary[]> {
    if (!usrIds?.length) return [];
    try {
      const res = await this.post('/internal/auth/users/resolve-business-ids', {
        usrIds,
      });
      if (res?.statusCode !== 200) {
        this.log.warn(
          `resolveUsersByBusinessIds: gateway returned ${String(
            res?.statusCode,
          )}`,
        );
        return [];
      }
      return this.normalizeUsers(this.metadataItems(res));
    } catch (err) {
      this.log.error(
        `resolveUsersByBusinessIds error: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return [];
    }
  }

  /**
   * Tìm kiếm users qua auth gateway.
   * excludeUsrId: usr_id của user hiện tại (để loại khỏi kết quả).
   */
  async searchUsers(
    keyword: string,
    page: number,
    limit: number,
    excludeUsrId?: string,
  ): Promise<{ users: UserSummary[]; total: number; totalPage: number }> {
    try {
      const res = await this.post('/internal/auth/users/search', {
        keyword,
        page,
        limit,
        excludeUsrId,
      });
      if (res?.statusCode !== 200) {
        this.log.warn(
          `searchUsers: gateway returned ${String(res?.statusCode)}`,
        );
        return { users: [], total: 0, totalPage: 0 };
      }
      const meta = res?.metadata ?? {};
      const users = this.normalizeUsers(this.metadataItems(res));
      return {
        users,
        total: Number(meta.total ?? users.length),
        totalPage: Number(meta.totalPage ?? Math.ceil(users.length / limit)),
      };
    } catch (err) {
      this.log.error(
        `searchUsers error: ${err instanceof Error ? err.message : String(err)}`,
      );
      return { users: [], total: 0, totalPage: 0 };
    }
  }

  async hydrateAttachments(attachmentIds: string[]) {
    if (!attachmentIds?.length) return [];
    const res = await this.post(
      '/internal/filesystem/attachments/hydrate',
      { attachmentIds },
      15_000,
    );
    return res?.statusCode === 200 ? this.metadataItems(res) : [];
  }

  async hydrateDocuments(documentIds: string[]) {
    if (!documentIds?.length) return [];
    const res = await this.post(
      '/internal/filesystem/documents/hydrate',
      { documentIds },
      15_000,
    );
    return res?.statusCode === 200 ? this.metadataItems(res) : [];
  }

  async hydrateLearningCards(items: HydrateLearningCardItem[]) {
    if (!items?.length) return [];
    const res = await this.post(
      '/internal/learning/cards/hydrate',
      { items },
      15_000,
    );
    return res?.statusCode === 200 ? this.metadataItems(res) : [];
  }
}
