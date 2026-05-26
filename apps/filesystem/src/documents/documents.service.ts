import { firstValueFrom } from 'rxjs';
import type { ClientGrpc } from '@nestjs/microservices';
import { ClientKafka } from '@nestjs/microservices';
import { CreateDocDto } from '@app/dto';
import { Response } from '@app/helpers/response';
import Utils from '@app/helpers/utils';
import {
  BadGatewayException,
  Inject,
  Injectable,
  NotAcceptableException,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  Attachment,
  AttachmentContextEnumType,
  Document,
  DocVisibilityEnum,
} from 'libs/db/src';
import { Model } from 'mongoose';
import * as Y from 'yjs';
import { SERVICES } from '@app/constants';
import { KafkaEvent } from '@app/dto/enum.type';

interface AuthGrpcClient {
  GetUserById(data: { userId: string }): any;
  GetUsersByIds(data: { userIds: string[] }): any;
}

interface ChatGrpcClient {
  GetRoomById(data: { roomId: string }): any;
  GetRoomsByIds(data: { roomIds: string[] }): any;
}

@Injectable()
export class DocumentsService {
  private readonly utils = Utils;
  private authGrpcClient: AuthGrpcClient;
  private chatGrpcClient: ChatGrpcClient;

  constructor(
    @InjectModel(Attachment.name)
    private readonly attachmentModel: Model<Attachment>,
    @InjectModel(Document.name)
    private readonly docsModel: Model<Document>,
    @Inject(SERVICES.AI) private readonly aiClient: ClientKafka,
    @Inject(SERVICES.NOTIFICATION)
    private readonly notificationClient: ClientKafka,
    @Inject(SERVICES.AUTH)
    private readonly authGrpc: ClientGrpc,
    @Inject(SERVICES.CHAT)
    private readonly chatGrpc: ClientGrpc,
  ) {}

  onModuleInit() {
    this.authGrpcClient =
      this.authGrpc.getService<AuthGrpcClient>('AuthService');
    this.chatGrpcClient =
      this.chatGrpc.getService<ChatGrpcClient>('ChatService');
  }

  /**
   * Database isolation: fetch user info via gRPC Auth.
   * Maps gRPC response (unprefixed) to Mongoose-style fields.
   */
  private async lookupUsersByIds(userIds: string[]): Promise<any[]> {
    if (!userIds.length) return [];
    try {
      const result = await firstValueFrom(
        this.authGrpcClient.GetUsersByIds({ userIds }) as any,
      );
      const users = (result as any)?.metadata ?? [];
      return users.map((u: any) => ({
        _id: u._id,
        usr_id: u.id ?? u._id,
        usr_slug: u.slug ?? '',
        usr_fullname: u.fullname ?? '',
        usr_avatar: u.avatar ?? '',
        usr_email: u.email ?? '',
      }));
    } catch { return []; }
  }

  private async lookupUserById(userId: string): Promise<any | null> {
    const users = await this.lookupUsersByIds([userId]);
    return users[0] || null;
  }

  /**
   * Database isolation: fetch room info via gRPC Chat.
   */
  private async lookupRoomsByIds(roomIds: string[]): Promise<any[]> {
    if (!roomIds.length) return [];
    try {
      const result = await firstValueFrom(
        this.chatGrpcClient.GetRoomsByIds({ roomIds }) as any,
      );
      return (result as any)?.metadata ?? [];
    } catch { return []; }
  }

  private async lookupRoomById(roomId: string): Promise<any | null> {
    const rooms = await this.lookupRoomsByIds([roomId]);
    return rooms[0] || null;
  }

  /**
   * Helper: Check if user has access to document
   */
  private async checkDocAccess(
    doc: any,
    userId: string,
    requireEdit = false,
  ): Promise<boolean> {
    try {
      const userObjId = this.utils.convertToObjectIdMongoose(userId);
      const userIdStr = userObjId.toString();
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-assignment
      const docOwnerId = doc?.ownerId?.toString?.();
      const isOwner = docOwnerId === userIdStr;

      // Owner luôn có quyền
      if (isOwner) return true;

      // 1. Check explicit sharedWith (nếu doc đã được populate hoặc có sẵn)
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      const sharedArray = (doc?.sharedWith as unknown[]) ?? [];
      const sharedUser = sharedArray.find((s: any) => {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-assignment
        const sUserId = s?.userId?.toString?.();
        return sUserId === userIdStr;
      });

      if (sharedUser) {
        if (requireEdit) {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
          return (sharedUser as any).role === 'editor';
        }
        return true;
      }

      // 2. Check Room Members (nếu doc chưa populate hoặc user không nằm trong sharedWith)
      if (
        doc &&
        Array.isArray((doc as { roomIds?: unknown }).roomIds) &&
        (doc as { roomIds: unknown[] }).roomIds.length > 0
      ) {
        const roomIdsArray = (doc as { roomIds: string[] }).roomIds;
        const firstRoomId = roomIdsArray.length > 0 ? roomIdsArray[0] : null;
        const room = firstRoomId ? await this.lookupRoomById(firstRoomId) : null;

        if (room) {
          const member = room.room_members.find(
            (m) => m.user_id.toString() === userIdStr,
          );
          if (member) {
            const role = member.role === 'guest' ? 'viewer' : 'editor';
            if (requireEdit) {
              return role === 'editor';
            }
            return true;
          }
        }
      }

      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      const isPublic = doc?.visibility === DocVisibilityEnum.public;

      // Nếu cần edit thì chỉ owner/shared editor được
      if (requireEdit) return false;

      // View thì có thể public
      return isPublic;
    } catch {
      return false;
    }
  }

  /**
   * Helper: Create default BlockNote buffer
   */
  private createEmptyBlockNoteBuffer() {
    const ydoc = new Y.Doc();
    // Initialize the fragment but leave it empty.
    // BlockNote will handle the initialization of the default paragraph on the client side.
    ydoc.getXmlFragment('document-store');

    const update = Y.encodeStateAsUpdate(ydoc);
    // Ensure we don't return an empty buffer (00 00 is the minimal valid update)
    if (update.byteLength === 0) {
      return Buffer.from([0, 0]);
    }
    return Buffer.from(update);
  }

  /**
   * Helper: Find Room by ID or Pair ID
   */
  private async findRoom(roomId: string, userId: string) {
    // check user
    const userInfo = await this.lookupUserById(userId);
    if (!userInfo) {
      throw new NotFoundException('không tìm thấy thông tin người dùng');
    }

    // get info room
    const finInfo = await this.lookupRoomById(roomId);
    if (!finInfo) {
      throw new NotAcceptableException('Phòng không tồn tại');
    }
    return finInfo;
  }

  /**
   * Helper: Aggregation Pipeline to populate Owner and Shared Users
   */
  private getPopulateDocsPipeline(matchQuery: Record<string, unknown>): any[] {
    // NOTE: Cross-DB $lookup (Users, Rooms) removed for database isolation.
    // Owner, shared users, and room info are hydrated post-aggregate
    // via batch gRPC in hydrateDocument() / hydrateDocuments().
    return [
      { $match: matchQuery },
      // Normalize room members into sharedWith-like shape (intra-DB only)
      // Room info is hydrated separately post-aggregate
      {
        $addFields: {
          combined_shared: {
            $ifNull: ['$sharedWith', []],
          },
        },
      },
      {
        $unwind: {
          path: '$combined_shared',
          preserveNullAndEmptyArrays: true,
        },
      },
      // Group back
      {
        $group: {
          _id: '$_id',
          root: { $first: '$$ROOT' },
          sharedWith: {
            $push: {
              userId: '$combined_shared.userId',
              role: '$combined_shared.role',
              sharedAt: '$combined_shared.sharedAt',
              // user info hydrated later
            },
          },
        },
      },
      // Format output
      {
        $addFields: {
          'root.sharedWith': {
            $filter: {
              input: '$sharedWith',
              as: 'item',
              cond: { $ifNull: ['$$item.userId', false] },
            },
          },
          // Placeholder: owner populated later via gRPC
          'root.owner': { _id: null, usr_id: '', usr_fullname: '', usr_avatar: '' },
        },
      },
      {
        $replaceRoot: { newRoot: '$root' },
      },
      // Cleanup temporary fields
      {
        $project: {
          combined_shared: 0,
          'sharedWith.user_info': 0,
          yjsSnapshot: 0,
        },
      },
      // Convert ObjectIds and Dates to Strings for gRPC compatibility
      {
        $addFields: {
          _id: { $toString: '$_id' },
          ownerId: { $toString: '$ownerId' },
          createdAt: { $toString: '$createdAt' },
          updatedAt: { $toString: '$updatedAt' },
          roomIds: {
            $map: {
              input: { $ifNull: ['$roomIds', []] },
              as: 'id',
              in: { $toString: '$$id' },
            },
          },
          attachmentIds: {
            $map: {
              input: { $ifNull: ['$attachmentIds', []] },
              as: 'id',
              in: { $toString: '$$id' },
            },
          },
          'owner._id': { $toString: '$owner._id' },
          sharedWith: {
            $map: {
              input: '$sharedWith',
              as: 'sw',
              in: {
                userId: { $toString: '$$sw.userId' },
                role: '$$sw.role',
                sharedAt: { $toString: '$$sw.sharedAt' },
                user: { _id: '', usr_id: '', usr_fullname: '', usr_avatar: '' },
              },
            },
          },
        },
      },
    ];
  }

  /**
   * Database isolation: hydrate owner, shared users, and room info via batch gRPC.
   * Replaces the removed $lookup -> Users / $lookup -> Rooms stages.
   */
  private async hydrateDocuments(docs: any[]): Promise<any[]> {
    if (!docs.length) return docs;

    const userIds = new Set<string>();
    const roomIds = new Set<string>();

    for (const d of docs) {
      if (d.ownerId) userIds.add(String(d.ownerId));
      d.sharedWith?.forEach((s: any) => s.userId && userIds.add(String(s.userId)));
      d.roomIds?.forEach((id: any) => roomIds.add(String(id)));
    }

    const [users, rooms] = await Promise.all([
      userIds.size ? this.lookupUsersByIds([...userIds]) : Promise.resolve([]),
      roomIds.size ? this.lookupRoomsByIds([...roomIds]) : Promise.resolve([]),
    ]);

    const userMap = new Map(users.map(u => [String(u._id), u]));
    const roomMap = new Map<string, any>();
    rooms.forEach(r => {
      const id = String(r._id ?? r.roomId ?? r.id);
      if (id) roomMap.set(id, r);
    });

    return docs.map(d => {
      const owner = d.ownerId ? userMap.get(String(d.ownerId)) : null;
      const hydratedShared = (d.sharedWith ?? []).map((s: any) => {
        const u = s.userId ? userMap.get(String(s.userId)) : null;
        return {
          ...s,
          user: u ? {
            _id: String(u._id ?? ''),
            usr_id: u.usr_id ?? u.id ?? '',
            usr_slug: u.usr_slug ?? u.slug ?? '',
            usr_fullname: u.usr_fullname ?? u.fullname ?? '',
            usr_avatar: u.usr_avatar ?? u.avatar ?? '',
            usr_email: u.usr_email ?? u.email ?? '',
          } : s.user ?? { _id: '', usr_id: '', usr_fullname: '', usr_avatar: '' },
        };
      });

      // Merge room members into sharedWith (replaces room_infos lookup)
      const roomMembersShared: any[] = [];
      (d.roomIds ?? []).forEach((rid: any) => {
        const room = roomMap.get(String(rid));
        room?.room_members?.forEach((m: any) => {
          const memberUserId = String(m.user_id ?? m.userId ?? '');
          if (memberUserId) {
            roomMembersShared.push({
              userId: memberUserId,
              role: m.role === 'guest' ? 'viewer' : 'editor',
              sharedAt: m.joinedAt ?? new Date().toISOString(),
              user: (() => {
                const mu = userMap.get(memberUserId);
                return mu ? {
                  _id: String(mu._id ?? ''),
                  usr_id: mu.usr_id ?? mu.id ?? '',
                  usr_slug: mu.usr_slug ?? mu.slug ?? '',
                  usr_fullname: mu.usr_fullname ?? mu.fullname ?? '',
                  usr_avatar: mu.usr_avatar ?? mu.avatar ?? '',
                  usr_email: mu.usr_email ?? mu.email ?? '',
                } : { _id: '', usr_id: '', usr_fullname: '', usr_avatar: '' };
              })(),
            });
          }
        });
      });

      return {
        ...d,
        owner: owner ? {
          _id: String(owner._id ?? ''),
          usr_id: owner.usr_id ?? owner.id ?? '',
          usr_slug: owner.usr_slug ?? owner.slug ?? '',
          usr_fullname: owner.usr_fullname ?? owner.fullname ?? '',
          usr_avatar: owner.usr_avatar ?? owner.avatar ?? '',
          usr_email: owner.usr_email ?? owner.email ?? '',
        } : d.owner ?? { _id: '', usr_id: '', usr_fullname: '', usr_avatar: '' },
        sharedWith: [...hydratedShared, ...roomMembersShared],
      };
    });
  }

  private async getFormattedDocumentById(docId: string) {
    const docs = await this.docsModel.aggregate(
      this.getPopulateDocsPipeline({
        _id: this.utils.convertToObjectIdMongoose(docId),
      }),
    );
    let doc = docs[0] as Document & { _id: any };

    if (doc) {
      // Fix: Re-fetch yjsSnapshot directly to ensure binary data is correct
      const rawDoc = await this.docsModel.findById(doc._id, { yjsSnapshot: 1 });
      if (rawDoc?.yjsSnapshot) {
        doc.yjsSnapshot = rawDoc.yjsSnapshot;
      }
    }
    if (doc) doc = (await this.hydrateDocuments([doc]))[0];
    return doc;
  }

  /**
   * =====================================================
   * Create Document
   * =====================================================
   * Tạo tài liệu mới với snapshot Yjs và plain text
   * - Kiểm tra quyền truy cập phòng
   * - Tạo document record
   * - Tạo attachment record để theo dõi trong room
   */
  async createDoc({
    owerId,
    title,
    roomId,
    visibility = DocVisibilityEnum.private,
  }: CreateDocDto) {
    // Luôn tạo snapshot rỗng chuẩn cho BlockNote để tránh lỗi từ client
    const finalSnapshot = this.createEmptyBlockNoteBuffer();

    const roomObjectIds: string[] = [];
    if (roomId) {
      const room = await this.findRoom(roomId, owerId);
      if (room._id) {
        roomObjectIds.push(room._id.toString());
      }
    }

    // Tạo document mới
    const newDoc = await this.docsModel.create({
      ownerId: this.utils.convertToObjectIdMongoose(owerId),
      title,
      roomIds: roomObjectIds,
      visibility,
      yjsSnapshot: finalSnapshot,
      plainText: '',
      attachmentIds: [],
      sharedWith: [],
    });

    if (!newDoc) {
      throw new BadGatewayException('Tạo thất bãi vui lòng thử lại');
    }

    const formattedDoc = await this.getFormattedDocumentById(
      newDoc._id.toString(),
    );

    // Dispatch Notification
    if (roomId) {
      const room = await this.lookupRoomById(roomId);
      if (room) {
        const memberIds = room.room_members.map((m) => m.user_id.toString());
        // Filter out the creator (owner) if needed, but usually they might want to know it's done?
        // User request: "Receiver: Admin, Người theo dõi folder".
        // "Ông A vừa quăng bom..." -> Don't notify Ông A?
        const receiverIds = memberIds.filter((id) => id !== owerId);

        if (receiverIds.length > 0) {
          await this.utils.dispatchEventKafka(
            this.notificationClient,
            KafkaEvent.DOC_CREATED as unknown as string,
            {
              title: 'Tài liệu mới',
              message: `Tài liệu mới '${title}' đã được thêm vào thư mục ${room.room_name || 'Chung'}.`,
              userIds: receiverIds,
              data: {
                docId: String(formattedDoc._id),
                roomId: roomId,
              },
            },
          );
        }
      }
    }

    return Response.success(formattedDoc, 'Tạo thành công');
  }

  /**
   * =====================================================
   * Get Document
   * =====================================================
   * Lấy tài liệu theo ID
   * - Kiểm tra quyền truy cập
   * - Trả về document đầy đủ
   */
  async getDoc(docId: string, userId: string) {
    const doc = await this.getFormattedDocumentById(docId);

    if (!doc) {
      throw new NotFoundException('Không tìm thấy tài liệu');
    }

    // Kiểm tra quyền truy cập
    const hasAccess = await this.checkDocAccess(doc, userId);
    if (!hasAccess) {
      throw new NotFoundException('Bạn không có quyền truy cập tài liệu này');
    }

    // Nếu là public và user chưa có trong sharedWith thì add vào
    const userObjId = this.utils.convertToObjectIdMongoose(userId);
    const isOwner = doc.ownerId?.toString() === userObjId.toString();

    const alreadyShared = doc.sharedWith?.some(
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
      (s: any) => s?.userId?.toString?.() === userObjId.toString(),
    );

    if (
      (doc.visibility as DocVisibilityEnum) === DocVisibilityEnum.public &&
      !isOwner &&
      !alreadyShared
    ) {
      await this.docsModel.findByIdAndUpdate(doc._id, {
        $push: {
          sharedWith: {
            userId: userObjId,
            role: 'viewer',
            sharedAt: new Date(),
          },
        },
      });
    }

    return Response.success(doc, 'Lấy tài liệu thành công');
  }

  /**
   * =====================================================
   * Update Document
   * =====================================================
   * Cập nhật snapshot Yjs và plain text của tài liệu
   * - Chỉ owner hoặc người được share mới có thể update
   * - Cập nhật yjsSnapshot (Yjs binary format)
   * - Cập nhật plainText (readable content)
   */
  async updateDoc(
    docId: string,
    userId: string,
    updateData: { yjsSnapshot?: Uint8Array | Buffer; plainText?: string }, // Chấp nhận cả Buffer
  ) {
    const doc = await this.docsModel.findById(
      this.utils.convertToObjectIdMongoose(docId),
    );

    if (!doc) throw new NotFoundException('Không tìm thấy tài liệu');

    // Check quyền edit... (giữ nguyên code cũ)
    const canEdit = await this.checkDocAccess(doc, userId, true);
    if (!canEdit) throw new NotFoundException('Quyền bị từ chối');

    let newYjsSnapshotBinary: Buffer | undefined;

    // 🔥 OPTIMIZED MERGE LOGIC
    if (updateData.yjsSnapshot && updateData.yjsSnapshot.length > 0) {
      console.log(
        `🔄 Merging doc ${docId}. Incoming size: ${updateData.yjsSnapshot.length}`,
      );
      // 1. Tạo Doc tạm để merge
      const mergedDoc = new Y.Doc();

      // 2. Load trạng thái hiện tại từ DB (nếu có)
      if (doc.yjsSnapshot) {
        // Chuyển Buffer từ Mongo -> Uint8Array cho Yjs
        const currentData = new Uint8Array(
          doc.yjsSnapshot.buffer || doc.yjsSnapshot,
        );
        Y.applyUpdate(mergedDoc, currentData);
      }

      // 3. Apply trạng thái mới từ Client gửi lên
      // Client gửi Full State (encodeStateAsUpdate) nên apply vào là nó merge luôn
      const incomingData = new Uint8Array(updateData.yjsSnapshot);
      Y.applyUpdate(mergedDoc, incomingData);

      // 4. Encode lại thành Buffer để lưu vào Mongo
      // Dùng Buffer.from để đảm bảo Mongoose hiểu đây là Binary
      newYjsSnapshotBinary = Buffer.from(Y.encodeStateAsUpdate(mergedDoc));
      console.log(
        `✅ Merge complete. New size: ${newYjsSnapshotBinary.length}`,
      );
    }

    await this.docsModel.findByIdAndUpdate(
      doc._id,
      {
        $set: {
          ...(newYjsSnapshotBinary && {
            yjsSnapshot: newYjsSnapshotBinary,
          }),
          ...(updateData.plainText && { plainText: updateData.plainText }),
          updatedAt: new Date(),
        },
      },
      { new: true },
    );

    // Trigger AI Embedding if plainText is updated
    if (updateData.plainText) {
      this.aiClient.emit(KafkaEvent.AI_DOC_EMBEDDING, {
        text: updateData.plainText,
        docId: docId,
        userId: userId,
      });
    }

    const formattedDoc = await this.getFormattedDocumentById(docId);

    // Dispatch Notification
    if (formattedDoc && formattedDoc.sharedWith) {
      const receiverIds = formattedDoc.sharedWith
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return
        .map((s: any) => s.userId)
        .filter((id: string) => id !== userId);

      if (receiverIds.length > 0) {
        await this.utils.dispatchEventKafka(
          this.notificationClient,
          KafkaEvent.DOC_NEW_VERSION as unknown as string,
          {
            title: 'Cập nhật phiên bản',
            message: `Phiên bản mới của tài liệu '${formattedDoc.title}' đã sẵn sàng.`,
            userIds: receiverIds,
            data: {
              docId: String(formattedDoc._id),
            },
          },
        );
      }
    }

    return Response.success(formattedDoc, 'Cập nhật tài liệu thành công');
  }

  /**
   * =====================================================
   * Delete Document
   * =====================================================
   * Xóa tài liệu (chỉ owner mới có thể xóa)
   * - Kiểm tra quyền
   * - Xóa document record
   * - Xóa attachment record liên quan
   */
  async deleteDoc(docId: string, userId: string) {
    const doc = await this.docsModel.findById(
      this.utils.convertToObjectIdMongoose(docId),
    );

    if (!doc) {
      throw new NotFoundException('Không tìm thấy tài liệu');
    }

    // Chỉ owner mới có thể xóa
    const userObjId = this.utils.convertToObjectIdMongoose(userId);
    const isOwner = doc.ownerId?.toString() === userObjId.toString();
    if (!isOwner) {
      throw new NotFoundException('Bạn không có quyền xóa tài liệu này');
    }

    // Xóa document
    await this.docsModel.findByIdAndDelete(doc._id);

    // Xóa attachment liên quan
    await this.attachmentModel.deleteMany({
      contextId: doc._id,
      contextType: AttachmentContextEnumType.doc,
    });

    // Dispatch Notification
    const receivers = new Set<string>();
    if (doc.roomIds && doc.roomIds.length > 0) {
      const rooms = await this.lookupRoomsByIds(doc.roomIds?.map(String) ?? []);
      rooms.forEach((room) => {
        room.room_members.forEach((m) => {
          if (m.user_id.toString() !== userId) {
            receivers.add(m.user_id.toString());
          }
        });
      });
    }

    const receiverIds = Array.from(receivers);
    if (receiverIds.length > 0) {
      const deleter = await this.lookupUserById(userId);
      const deleterName = deleter?.usr_fullname || 'Ai đó';
      await this.utils.dispatchEventKafka(
        this.notificationClient,
        KafkaEvent.DOC_DELETED as unknown as string,
        {
          title: 'Xóa tài liệu',
          message: `Tài liệu '${doc.title}' đã bị xóa bởi ${deleterName}.`,
          userIds: receiverIds,
          data: {
            docId: String(doc._id),
          },
        },
      );
    }

    return Response.success(null, 'Xóa tài liệu thành công');
  }

  /**
   * =====================================================
   * List Documents
   * =====================================================
   * Lấy danh sách tài liệu theo phòng
   * - Chỉ show tài liệu mà user có quyền truy cập
   * - Owner/shared with hoặc public
   */
  async listDocs(userId: string, roomId?: string) {
    const userObjId = this.utils.convertToObjectIdMongoose(userId);
    // Access buckets
    const baseAccessClauses = [
      { ownerId: userObjId },
      { 'sharedWith.userId': userObjId },
      { visibility: DocVisibilityEnum.public },
    ];

    const query: Record<string, unknown> = {};

    if (roomId) {
      const room = await this.findRoom(roomId, userId);
      query.roomIds = { $in: [room._id] };

      const isMember = room.room_members.some(
        (m) => m.user_id.toString() === userObjId.toString(),
      );

      const accessClauses = [...baseAccessClauses];
      if (isMember) {
        // Members can see room-visibility docs
        accessClauses.push({ visibility: DocVisibilityEnum.room });
      }

      query.$or = accessClauses;
    } else {
      // Personal docs: no room binding
      const personalFilter = {
        $or: [{ roomIds: { $exists: false } }, { roomIds: { $size: 0 } }],
      };

      query.$and = [personalFilter, { $or: baseAccessClauses }];
    }

    const docs = await this.docsModel.aggregate(
      this.getPopulateDocsPipeline(query),
    );
    const hydrated = await this.hydrateDocuments(docs);

    return Response.success(hydrated, 'Lấy danh sách tài liệu thành công');
  }

  /**
   * =====================================================
   * Share Document
   * =====================================================
   * Chia sẻ tài liệu với user khác (chỉ owner)
   */
  async shareDocument(
    docId: string,
    userId: string,
    shareUserId: string,
    role: string = 'editor',
  ) {
    const doc = await this.docsModel.findById(
      this.utils.convertToObjectIdMongoose(docId),
    );

    if (!doc) {
      throw new NotFoundException('Không tìm thấy tài liệu');
    }

    // Kiểm tra chỉ owner mới có thể chia sẻ
    const docOwnerId = doc?.ownerId?.toString?.();
    const userObjId = this.utils.convertToObjectIdMongoose(userId).toString();

    if (docOwnerId !== userObjId) {
      throw new NotFoundException('Chỉ chủ sở hữu mới có thể chia sẻ tài liệu');
    }

    // Kiểm tra user đã được chia sẻ chưa
    const shareUserObjId = this.utils.convertToObjectIdMongoose(shareUserId);
    const alreadyShared = doc.sharedWith?.some(
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
      (s: any) => s?.userId?.toString?.() === shareUserObjId.toString(),
    );

    if (alreadyShared) {
      throw new BadGatewayException('Tài liệu đã được chia sẻ với user này');
    }

    // Thêm user vào sharedWith
    await this.docsModel.findByIdAndUpdate(
      doc._id,
      {
        $push: {
          sharedWith: {
            userId: shareUserObjId,
            role,
            sharedAt: new Date(),
          },
        },
        $set: {
          updatedAt: new Date(),
        },
      },
      { new: true },
    );

    const formattedDoc = await this.getFormattedDocumentById(docId);

    // Dispatch Notification
    const sharer = await this.lookupUserById(userId);
    const sharerName = sharer?.usr_fullname || 'Ai đó';
    await this.utils.dispatchEventKafka(
      this.notificationClient,
      KafkaEvent.DOC_SHARED as unknown as string,
      {
        title: 'Chia sẻ tài liệu',
        message: `${sharerName} đã chia sẻ tài liệu '${doc.title}' với bạn.`,
        userIds: [shareUserId],
        data: {
          docId: String(formattedDoc._id),
        },
      },
    );

    return Response.success(formattedDoc, 'Chia sẻ tài liệu thành công');
  }

  async shareDocumentForRoom(userId: string, room_id: string, docId: string) {
    const doc = await this.docsModel.findById(
      this.utils.convertToObjectIdMongoose(docId),
    );

    if (!doc) {
      throw new NotFoundException('Không tìm thấy tài liệu');
    }

    // Kiểm tra chỉ owner mới có thể chia sẻ
    const docOwnerId = doc?.ownerId?.toString?.();
    const userObjId = this.utils.convertToObjectIdMongoose(userId).toString();

    if (docOwnerId !== userObjId) {
      throw new NotFoundException('Chỉ chủ sở hữu mới có thể chia sẻ tài liệu');
    }

    // Tìm phòng và kiểm tra quyền
    const room = await this.findRoom(room_id, userId);

    // Add roomId vào doc
    await this.docsModel.findByIdAndUpdate(
      doc._id,
      {
        $addToSet: { roomIds: room._id },
        $set: { updatedAt: new Date() },
      },
      { new: true },
    );

    const formattedDoc = await this.getFormattedDocumentById(docId);
    return Response.success(
      formattedDoc,
      'Chia sẻ tài liệu vào phòng thành công',
    );
  }

  /**
   * =====================================================
   * Unshare Document
   * =====================================================
   * Thu hồi chia sẻ tài liệu (chỉ owner)
   */
  async unshareDocument(docId: string, userId: string, shareUserId: string) {
    const doc = await this.docsModel.findById(
      this.utils.convertToObjectIdMongoose(docId),
    );

    if (!doc) {
      throw new NotFoundException('Không tìm thấy tài liệu');
    }

    // Kiểm tra chỉ owner mới có thể thu hồi chia sẻ
    const docOwnerId = doc?.ownerId?.toString?.();
    const userObjId = this.utils.convertToObjectIdMongoose(userId).toString();

    if (docOwnerId !== userObjId) {
      throw new NotFoundException('Chỉ chủ sở hữu mới có thể thu hồi chia sẻ');
    }

    const shareUserObjId = this.utils.convertToObjectIdMongoose(shareUserId);

    // Xóa user khỏi sharedWith
    await this.docsModel.findByIdAndUpdate(
      doc._id,
      {
        $pull: {
          sharedWith: {
            userId: shareUserObjId,
          },
        },
        $set: {
          updatedAt: new Date(),
        },
      },
      { new: true },
    );

    const formattedDoc = await this.getFormattedDocumentById(docId);
    return Response.success(
      formattedDoc,
      'Thu hồi chia sẻ tài liệu thành công',
    );
  }

  /**
   * =====================================================
   * Update Title
   * =====================================================
   * Cập nhật tiêu đề tài liệu
   */
  async updateTitle(docId: string, userId: string, title: string) {
    const doc = await this.docsModel.findById(
      this.utils.convertToObjectIdMongoose(docId),
    );

    if (!doc) {
      throw new NotFoundException('Không tìm thấy tài liệu');
    }

    // Kiểm tra quyền edit
    const canEdit = await this.checkDocAccess(doc, userId, true);
    if (!canEdit) {
      throw new NotFoundException('Bạn không có quyền cập nhật tài liệu này');
    }

    await this.docsModel.findByIdAndUpdate(
      doc._id,
      {
        $set: {
          title,
          updatedAt: new Date(),
        },
      },
      { new: true },
    );

    const formattedDoc = await this.getFormattedDocumentById(docId);

    // Dispatch Notification
    if (formattedDoc && formattedDoc.sharedWith) {
      const receiverIds = formattedDoc.sharedWith
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return
        .map((s: any) => s.userId)
        .filter((id: string) => id !== userId);

      if (receiverIds.length > 0) {
        await this.utils.dispatchEventKafka(
          this.notificationClient,
          KafkaEvent.DOC_UPDATED as unknown as string,
          {
            title: 'Cập nhật thông tin',
            message: `Thông tin của tài liệu '${title}' vừa được cập nhật.`,
            userIds: receiverIds,
            data: {
              docId: String(formattedDoc._id),
            },
          },
        );
      }
    }

    return Response.success(formattedDoc, 'Cập nhật tiêu đề thành công');
  }

  /**
   * =====================================================
   * Update Visibility
   * =====================================================
   * Cập nhật quyền truy cập tài liệu (private/shared/public)
   */
  async updateVisibility(
    docId: string,
    userId: string,
    visibility: DocVisibilityEnum,
  ) {
    const doc = await this.docsModel.findById(
      this.utils.convertToObjectIdMongoose(docId),
    );

    if (!doc) {
      throw new NotFoundException('Không tìm thấy tài liệu');
    }

    // Kiểm tra chỉ owner mới có thể thay đổi visibility
    const docOwnerId = doc?.ownerId?.toString?.();
    const userObjId = this.utils.convertToObjectIdMongoose(userId).toString();

    if (docOwnerId !== userObjId) {
      throw new NotFoundException(
        'Chỉ chủ sở hữu mới có thể thay đổi quyền truy cập',
      );
    }

    await this.docsModel.findByIdAndUpdate(
      doc._id,
      {
        $set: {
          visibility,
          updatedAt: new Date(),
        },
      },
      { new: true },
    );

    const formattedDoc = await this.getFormattedDocumentById(docId);

    // Dispatch Notification
    if (formattedDoc && formattedDoc.sharedWith) {
      const receiverIds = formattedDoc.sharedWith
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return
        .map((s: any) => s.userId)
        .filter((id: string) => id !== userId);

      if (receiverIds.length > 0) {
        await this.utils.dispatchEventKafka(
          this.notificationClient,
          KafkaEvent.DOC_UPDATED as unknown as string,
          {
            title: 'Cập nhật thông tin',
            message: `Thông tin của tài liệu '${doc.title}' vừa được cập nhật.`,
            userIds: receiverIds,
            data: {
              docId: String(formattedDoc._id),
            },
          },
        );
      }
    }

    return Response.success(formattedDoc, 'Cập nhật quyền truy cập thành công');
  }

  /**
   * =====================================================
   * Duplicate Document
   * =====================================================
   * Tạo bản sao của tài liệu
   */
  async duplicateDoc(docId: string, userId: string) {
    const doc = await this.docsModel.findById(
      this.utils.convertToObjectIdMongoose(docId),
    );

    if (!doc) {
      throw new NotFoundException('Không tìm thấy tài liệu gốc');
    }

    // Check access (read access is enough to copy?)
    const hasAccess = await this.checkDocAccess(doc, userId);
    if (!hasAccess) {
      throw new NotFoundException('Bạn không có quyền truy cập tài liệu này');
    }

    // Create new doc
    const newDoc = await this.docsModel.create({
      ownerId: this.utils.convertToObjectIdMongoose(userId),
      title: `${doc.title} (Copy)`,
      roomId: undefined, // Personal copy
      visibility: DocVisibilityEnum.private,
      yjsSnapshot: doc.yjsSnapshot, // Copy content
      plainText: doc.plainText,
      attachmentIds: [], // Don't copy attachments for now
      sharedWith: [], // Reset sharing
    });

    const formattedDoc = await this.getFormattedDocumentById(
      newDoc._id.toString(),
    );
    return Response.success(formattedDoc, 'Tạo bản sao thành công');
  }

  /**
   * =====================================================
   * Get Documents By IDs
   * =====================================================
   * Batch fetch documents by IDs for cross-service hydration.
   * Returns simplified DocumentCore objects.
   */
  async getDocumentsByIds(documentIds: string[]) {
    if (!documentIds || documentIds.length === 0) {
      return Response.success([], 'No document IDs provided');
    }

    const objectIds = documentIds
      .filter((id) => /^[0-9a-fA-F]{24}$/.test(id))
      .map((id) => this.utils.convertToObjectIdMongoose(id));

    if (objectIds.length === 0) {
      return Response.success([], 'No valid document IDs provided');
    }

    const docs = await this.docsModel
      .find({ _id: { $in: objectIds } })
      .lean()
      .then((d) =>
        d.map((doc) => {
          const dAny = doc as any;
          return {
            id: dAny._id.toString(),
            name: dAny.title,
            ownerId: dAny.ownerId.toString(),
            createdAt:
              dAny.createdAt?.toISOString?.() ?? String(dAny.createdAt ?? ''),
            updatedAt:
              dAny.updatedAt?.toISOString?.() ?? String(dAny.updatedAt ?? ''),
            roomIds: (dAny.roomIds ?? []).map((id: any) => id.toString()),
          };
        }),
      );

    return Response.success(docs, 'Get documents by IDs successful');
  }
}