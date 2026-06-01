import { CreateDocDto, type AiDocumentEmbeddingPayload } from '@app/dto';
import { Response } from '@app/helpers/response';
import Utils from '@app/helpers/utils';
import {
  BadGatewayException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  Attachment,
  AttachmentContextEnumType,
  Document,
  DocVisibilityEnum,
} from 'libs/db/src';
import { Model, Types } from 'mongoose';
import * as Y from 'yjs';
import { ClientKafka } from '@nestjs/microservices';
import { SERVICES } from '@app/constants';
import { KafkaEvent } from '@app/dto/enum.type';
import {
  GatewayClientService,
  type GatewayRoomSummary,
  type GatewayUserSummary,
} from '../gateway-client.service';

type FormattedUser = {
  _id: string;
  usr_id: string;
  usr_slug: string;
  usr_fullname: string;
  usr_avatar: string;
  usr_email: string;
};

@Injectable()
export class DocumentsService {
  private readonly utils = Utils;
  constructor(
    @InjectModel(Attachment.name)
    private readonly attachmentModel: Model<Attachment>,
    @InjectModel(Document.name)
    private readonly docsModel: Model<Document>,
    @Inject(SERVICES.AI) private readonly aiClient: ClientKafka,
    @Inject(SERVICES.NOTIFICATION)
    private readonly notificationClient: ClientKafka,
    private readonly gatewayClient: GatewayClientService,
  ) {}

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

      // 2. Check room membership through chat service.
      if (
        doc &&
        Array.isArray((doc as { roomIds?: unknown }).roomIds) &&
        (doc as { roomIds: unknown[] }).roomIds.length > 0
      ) {
        const roomIdsArray = (doc as { roomIds: unknown[] }).roomIds;
        for (const roomId of roomIdsArray) {
          const access = await this.gatewayClient.checkRoomAccess(
            this.objectIdToString(roomId),
            userIdStr,
          );
          if (access?.canView) {
            if (requireEdit) {
              return Boolean(access.canEdit);
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

  private async resolveRoomForDocument(roomId: string, userId: string) {
    const room = await this.gatewayClient.resolveRoomForUser(roomId, userId);
    if (!room?.mongoRoomId) {
      throw new NotFoundException('Phòng không tồn tại');
    }
    return room;
  }

  private async getFormattedDocumentById(docId: string, actorUserId?: string) {
    if (!Types.ObjectId.isValid(docId)) return null;
    const doc = await this.docsModel
      .findById(this.utils.convertToObjectIdMongoose(docId))
      .lean();
    if (!doc) return null;
    const docs = await this.hydrateDocuments([doc], actorUserId);
    return docs[0] ?? null;
  }

  private async hydrateDocuments(
    docs: any[],
    actorUserId?: string,
    includeSnapshot = true,
  ) {
    const plainDocs = docs.map((doc) =>
      this.plainDocument(doc, includeSnapshot),
    );
    const userIds = new Set<string>();
    const sharedByDocId = new Map<string, Map<string, any>>();
    const roomCache = new Map<string, Promise<GatewayRoomSummary | null>>();

    const getRoom = (roomId: string) => {
      const cacheKey = `${roomId}:${actorUserId || ''}`;
      if (!roomCache.has(cacheKey)) {
        roomCache.set(
          cacheKey,
          this.gatewayClient.getRoomMembers(roomId, actorUserId),
        );
      }
      return roomCache.get(cacheKey) as Promise<GatewayRoomSummary | null>;
    };

    for (const doc of plainDocs) {
      if (doc.ownerId) userIds.add(doc.ownerId);

      const sharedMap = new Map<string, any>();
      for (const shared of doc.sharedWith || []) {
        if (!shared.userId) continue;
        this.mergeSharedUser(sharedMap, {
          userId: shared.userId,
          role: shared.role || 'viewer',
          sharedAt: shared.sharedAt || '',
        });
      }

      for (const roomId of doc.roomIds || []) {
        const room = await getRoom(roomId);
        if (!room) continue;
        for (const member of room.members || []) {
          if (!member.userId) continue;
          this.mergeSharedUser(sharedMap, {
            userId: member.userId,
            role: member.role === 'guest' ? 'viewer' : 'editor',
            sharedAt: member.joinedAt || '',
          });
        }
      }

      for (const userId of sharedMap.keys()) userIds.add(userId);
      sharedByDocId.set(doc._id, sharedMap);
    }

    const users = await this.gatewayClient.getUsersSummary([...userIds]);
    const userMap = new Map<string, GatewayUserSummary>();
    for (const user of users) {
      const id = user._id || user.userId;
      if (id) userMap.set(id, user);
    }

    return plainDocs.map((doc) => {
      const sharedMap = sharedByDocId.get(doc._id) ?? new Map<string, any>();
      return {
        ...doc,
        owner: this.formatUserSummary(userMap.get(doc.ownerId), doc.ownerId),
        sharedWith: [...sharedMap.values()].map((shared) => ({
          ...shared,
          user: this.formatUserSummary(
            userMap.get(shared.userId),
            shared.userId,
          ),
        })),
      };
    });
  }

  private plainDocument(doc: any, includeSnapshot: boolean) {
    const raw = typeof doc?.toObject === 'function' ? doc.toObject() : doc;
    const plain = {
      ...raw,
      _id: this.objectIdToString(raw._id),
      ownerId: this.objectIdToString(raw.ownerId),
      createdAt: this.dateToString(raw.createdAt),
      updatedAt: this.dateToString(raw.updatedAt),
      roomIds: ((raw.roomIds as unknown[]) || []).map((id) =>
        this.objectIdToString(id),
      ),
      attachmentIds: ((raw.attachmentIds as unknown[]) || []).map((id) =>
        this.objectIdToString(id),
      ),
      sharedWith: ((raw.sharedWith as any[]) || []).map((shared) => ({
        userId: this.objectIdToString(shared.userId),
        role: shared.role || 'viewer',
        sharedAt: this.dateToString(shared.sharedAt),
      })),
    };

    if (!includeSnapshot) {
      delete (plain as { yjsSnapshot?: unknown }).yjsSnapshot;
    }

    return plain;
  }

  private mergeSharedUser(
    sharedMap: Map<string, any>,
    shared: { userId: string; role: string; sharedAt?: string },
  ) {
    const current = sharedMap.get(shared.userId);
    if (!current) {
      sharedMap.set(shared.userId, shared);
      return;
    }

    if (current.role !== 'editor' && shared.role === 'editor') {
      current.role = 'editor';
    }
    if (!current.sharedAt && shared.sharedAt) {
      current.sharedAt = shared.sharedAt;
    }
  }

  private formatUserSummary(
    user?: GatewayUserSummary,
    fallbackId = '',
  ): FormattedUser {
    return {
      _id: user?._id || user?.userId || fallbackId,
      usr_id: user?.usr_id || user?.id || '',
      usr_slug: (user as { slug?: string } | undefined)?.slug || '',
      usr_fullname: user?.fullname || user?.name || '',
      usr_avatar: user?.avatar || '',
      usr_email: user?.email || '',
    };
  }

  private dateToString(value: unknown): string {
    if (!value) return '';
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'string') return value;
    if (
      typeof (value as { toISOString?: unknown }).toISOString === 'function'
    ) {
      return (value as { toISOString: () => string }).toISOString();
    }
    return String(value);
  }

  private objectIdToString(value: unknown): string {
    if (!value) return '';
    if (typeof value === 'string') return value;
    if (typeof (value as { toString?: unknown }).toString === 'function') {
      return (value as { toString: () => string }).toString();
    }
    return String(value);
  }

  private async collectRoomMemberIds(
    roomIds: unknown[],
    actorUserId: string,
    excludeIds: string[] = [],
  ) {
    const exclude = new Set(excludeIds);
    const receivers = new Set<string>();

    for (const roomId of roomIds || []) {
      const room = await this.gatewayClient.getRoomMembers(
        this.objectIdToString(roomId),
        actorUserId,
      );
      for (const memberId of room?.memberIds || []) {
        if (!exclude.has(memberId)) receivers.add(memberId);
      }
    }

    return [...receivers];
  }

  private getUserDisplayName(user: GatewayUserSummary | null) {
    return user?.fullname || user?.name || 'Ai đó';
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

    const roomObjectIds: Types.ObjectId[] = [];
    let roomSummary: GatewayRoomSummary | null = null;
    if (roomId) {
      roomSummary = await this.resolveRoomForDocument(roomId, owerId);
      roomObjectIds.push(
        this.utils.convertToObjectIdMongoose(roomSummary.mongoRoomId),
      );
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
      owerId,
    );

    // Dispatch Notification
    if (roomSummary) {
      const receiverIds = roomSummary.memberIds.filter((id) => id !== owerId);

      if (receiverIds.length > 0) {
        await this.utils.dispatchEventKafka(
          this.notificationClient,
          KafkaEvent.DOC_CREATED as unknown as string,
          {
            title: 'Tài liệu mới',
            message: `Tài liệu mới '${title}' đã được thêm vào thư mục ${
              roomSummary.roomName || 'Chung'
            }.`,
            userIds: receiverIds,
            data: {
              docId: String(formattedDoc._id),
              roomId: roomSummary.mongoRoomId,
            },
          },
        );
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
    const doc = await this.getFormattedDocumentById(docId, userId);

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
      const roomIds = (doc.roomIds || []).map((roomId) =>
        this.utils.convertToObjectIdMongoose(roomId.toString()).toString(),
      );
      this.aiClient.emit(KafkaEvent.AI_DOC_EMBEDDING, {
        docId,
        userId,
        roomIds,
        title: doc.title,
        plainText: updateData.plainText,
        visibility: doc.visibility,
        updatedAt: new Date(),
        snapshot: {
          title: doc.title,
          visibility: doc.visibility,
          roomIds,
          updatedAt: new Date(),
        },
      } satisfies AiDocumentEmbeddingPayload);
    }

    const formattedDoc = await this.getFormattedDocumentById(docId, userId);

    // Dispatch Notification
    if (formattedDoc && formattedDoc.sharedWith) {
      const receiverIds = formattedDoc.sharedWith
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return
        .map((s: any) => String(s.userId))
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
      const memberIds = await this.collectRoomMemberIds(doc.roomIds, userId, [
        userId,
      ]);
      memberIds.forEach((memberId) => receivers.add(memberId));
    }

    const receiverIds = Array.from(receivers);
    if (receiverIds.length > 0) {
      const deleter = await this.gatewayClient.getUserSummary(userId);
      const deleterName = this.getUserDisplayName(deleter);
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
      const room = await this.resolveRoomForDocument(roomId, userId);
      query.roomIds = {
        $in: [this.utils.convertToObjectIdMongoose(room.mongoRoomId)],
      };

      query.$or = [
        ...baseAccessClauses,
        { visibility: DocVisibilityEnum.room },
      ];
    } else {
      // Personal docs: no room binding
      const personalFilter = {
        $or: [{ roomIds: { $exists: false } }, { roomIds: { $size: 0 } }],
      };

      query.$and = [personalFilter, { $or: baseAccessClauses }];
    }

    const docs = await this.docsModel
      .find(query)
      .select('-yjsSnapshot')
      .sort({ updatedAt: -1 })
      .lean();

    const formattedDocs = await this.hydrateDocuments(docs, userId, false);

    return Response.success(formattedDocs, 'Lấy danh sách tài liệu thành công');
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

    const sharedUser = await this.gatewayClient.getUserSummary(shareUserId);
    if (!sharedUser) {
      throw new NotFoundException('Không tìm thấy người dùng được chia sẻ');
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

    const formattedDoc = await this.getFormattedDocumentById(docId, userId);

    // Dispatch Notification
    const sharer = await this.gatewayClient.getUserSummary(userId);
    const sharerName = this.getUserDisplayName(sharer);
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

    // Tìm phòng và kiểm tra quyền qua chat service
    const room = await this.resolveRoomForDocument(room_id, userId);

    // Add roomId vào doc
    await this.docsModel.findByIdAndUpdate(
      doc._id,
      {
        $addToSet: {
          roomIds: this.utils.convertToObjectIdMongoose(room.mongoRoomId),
        },
        $set: { updatedAt: new Date() },
      },
      { new: true },
    );

    const formattedDoc = await this.getFormattedDocumentById(docId, userId);
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

    const formattedDoc = await this.getFormattedDocumentById(docId, userId);
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

    const formattedDoc = await this.getFormattedDocumentById(docId, userId);

    // Dispatch Notification
    if (formattedDoc && formattedDoc.sharedWith) {
      const receiverIds = formattedDoc.sharedWith
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return
        .map((s: any) => String(s.userId))
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

    const formattedDoc = await this.getFormattedDocumentById(docId, userId);

    // Dispatch Notification
    if (formattedDoc && formattedDoc.sharedWith) {
      const receiverIds = formattedDoc.sharedWith
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return
        .map((s: any) => String(s.userId))
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
      userId,
    );
    return Response.success(formattedDoc, 'Tạo bản sao thành công');
  }
}
