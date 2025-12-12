import { CreateDocDto } from '@app/dto';
import { Response } from '@app/helpers/response';
import Utils from '@app/helpers/utils';
import {
  BadGatewayException,
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
  Room,
  User,
} from 'libs/db/src';
import { Model } from 'mongoose';
import * as Y from 'yjs';

@Injectable()
export class DocumentsService {
  private readonly utils = Utils;
  constructor(
    @InjectModel(Attachment.name)
    private readonly attachmentModel: Model<Attachment>,
    @InjectModel(Document.name)
    private readonly docsModel: Model<Document>,
    @InjectModel(Room.name) private readonly roomModel: Model<Room>,
    @InjectModel(User.name) private readonly userModel: Model<User>,
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

      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      const sharedArray = (doc?.sharedWith as unknown[]) ?? [];
      const isSharedWith = sharedArray.some((s: any) => {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-assignment
        const sUserId = s?.userId?.toString?.();
        return sUserId === userIdStr;
      });

      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      const isPublic = doc?.visibility === DocVisibilityEnum.public;

      // Owner luôn có quyền
      if (isOwner) return true;

      // Check Room Access
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      if (doc.roomId) {
        const room = await this.roomModel.findOne({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
          _id: doc.roomId,
          'room_members.user_id': userObjId,
        });

        if (room) {
          // Nếu là member của room
          // Nếu requireEdit -> Cần check role trong room hoặc logic khác (tạm thời cho phép edit nếu là member room)
          // Hoặc chỉ cho phép edit nếu visibility != private?
          // Tạm thời: Member room có quyền như SharedWith
          return true;
        }
      }

      // Nếu cần edit thì chỉ owner/shared được
      if (requireEdit) return isSharedWith;
      // View thì có thể public hoặc shared
      return isSharedWith || isPublic;
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
    const userInfo = await this.userModel.findById(userId);
    if (!userInfo) {
      throw new NotFoundException('không tìm thấy thông tin người dùng');
    }

    // get info room
    const finInfo = await this.roomModel.findOne({
      room_id: {
        $in: [roomId, this.utils.pairRoomId(userInfo.usr_id, roomId)],
      },
    });
    if (!finInfo) {
      throw new NotAcceptableException('Phòng không tồn tại');
    }
    return finInfo;
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

    let roomObjectId: string | undefined;
    if (roomId) {
      const room = await this.findRoom(roomId, owerId);
      roomObjectId = room._id?.toString();
    }

    // Tạo document mới
    const newDoc = await this.docsModel.create({
      ownerId: this.utils.convertToObjectIdMongoose(owerId),
      title,
      roomId: roomObjectId,
      visibility,
      yjsSnapshot: finalSnapshot,
      plainText: '',
      attachmentIds: [],
      sharedWith: [],
    });

    if (!newDoc) {
      throw new BadGatewayException('Tạo thất bãi vui lòng thử lại');
    }

    return Response.success(newDoc, 'Tạo thành công');
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
    const doc = await this.docsModel.findById(
      this.utils.convertToObjectIdMongoose(docId),
    );

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

    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const alreadyShared = doc.sharedWith?.some(
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-assignment
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
    if (updateData.yjsSnapshot) {
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

    const updatedDoc = await this.docsModel.findByIdAndUpdate(
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

    return Response.success(updatedDoc, 'Cập nhật tài liệu thành công');
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

    // Base query: User has explicit access
    const orConditions: any[] = [
      { ownerId: userObjId },
      { 'sharedWith.userId': userObjId },
    ];

    const query: Record<string, unknown> = {};

    if (roomId) {
      const room = await this.findRoom(roomId, userId);
      query.roomId = room._id;

      // Check if user is member of the room
      const isMember = room.room_members.some(
        (m) => m.user_id.toString() === userObjId.toString(),
      );

      if (isMember) {
        // If member, can also see 'room' visibility docs
        orConditions.push({ visibility: DocVisibilityEnum.room });
      }
    } else {
      // If no roomId, maybe only list personal docs (roomId exists: false)
      // or just list everything user has access to.
      // Let's assume we list everything for now, or maybe just personal docs?
      // query.roomId = { $exists: false }; // Uncomment if we want to separate personal docs
    }

    query.$or = orConditions;

    const docs = await this.docsModel.find(query);

    return Response.success(docs, 'Lấy danh sách tài liệu thành công');
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
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment
    const docOwnerId = doc?.ownerId?.toString?.();
    const userObjId = this.utils.convertToObjectIdMongoose(userId).toString();

    if (docOwnerId !== userObjId) {
      throw new NotFoundException('Chỉ chủ sở hữu mới có thể chia sẻ tài liệu');
    }

    // Kiểm tra user đã được chia sẻ chưa
    const shareUserObjId = this.utils.convertToObjectIdMongoose(shareUserId);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const alreadyShared = doc.sharedWith?.some(
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-assignment
      (s: any) => s?.userId?.toString?.() === shareUserObjId.toString(),
    );

    if (alreadyShared) {
      throw new BadGatewayException('Tài liệu đã được chia sẻ với user này');
    }

    // Thêm user vào sharedWith
    const updatedDoc = await this.docsModel.findByIdAndUpdate(
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

    return Response.success(updatedDoc, 'Chia sẻ tài liệu thành công');
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
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment
    const docOwnerId = doc?.ownerId?.toString?.();
    const userObjId = this.utils.convertToObjectIdMongoose(userId).toString();

    if (docOwnerId !== userObjId) {
      throw new NotFoundException('Chỉ chủ sở hữu mới có thể thu hồi chia sẻ');
    }

    const shareUserObjId = this.utils.convertToObjectIdMongoose(shareUserId);

    // Xóa user khỏi sharedWith
    const updatedDoc = await this.docsModel.findByIdAndUpdate(
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

    return Response.success(updatedDoc, 'Thu hồi chia sẻ tài liệu thành công');
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

    const updatedDoc = await this.docsModel.findByIdAndUpdate(
      doc._id,
      {
        $set: {
          title,
          updatedAt: new Date(),
        },
      },
      { new: true },
    );

    return Response.success(updatedDoc, 'Cập nhật tiêu đề thành công');
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
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment
    const docOwnerId = doc?.ownerId?.toString?.();
    const userObjId = this.utils.convertToObjectIdMongoose(userId).toString();

    if (docOwnerId !== userObjId) {
      throw new NotFoundException(
        'Chỉ chủ sở hữu mới có thể thay đổi quyền truy cập',
      );
    }

    const updatedDoc = await this.docsModel.findByIdAndUpdate(
      doc._id,
      {
        $set: {
          visibility,
          updatedAt: new Date(),
        },
      },
      { new: true },
    );

    return Response.success(updatedDoc, 'Cập nhật quyền truy cập thành công');
  }
}
