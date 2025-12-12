import { CreateDocDto } from '@app/dto';
import { Response } from '@app/helpers/response';
import Utils from '@app/helpers/utils';
import {
  BadGatewayException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  Attachment,
  AttachmentContextEnumType,
  Document,
  DocVisibilityEnum,
  Room,
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
  ) {}

  /**
   * Helper: Check if user has access to document
   */
  private checkDocAccess(
    doc: any,
    userId: string,
    requireEdit = false,
  ): boolean {
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
      // Nếu cần edit thì chỉ owner/shared được
      if (requireEdit) return isSharedWith;
      // View thì có thể public hoặc shared
      return isSharedWith || isPublic;
    } catch {
      return false;
    }
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
    visibility = DocVisibilityEnum.private,
    yjsSnapshot = null,
    plainText,
    attachmentIds = [],
    sharedWith = [],
  }: CreateDocDto) {
    // Tạo document mới
    const newDoc = await this.docsModel.create({
      ownerId: this.utils.convertToObjectIdMongoose(owerId),
      title,
      visibility,
      yjsSnapshot,
      plainText,
      attachmentIds,
      sharedWith,
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
    const hasAccess = this.checkDocAccess(doc, userId);
    if (!hasAccess) {
      throw new NotFoundException('Bạn không có quyền truy cập tài liệu này');
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
    const canEdit = this.checkDocAccess(doc, userId, true);
    if (!canEdit) throw new NotFoundException('Quyền bị từ chối');

    let newYjsSnapshotBinary: Buffer | undefined;

    // 🔥 OPTIMIZED MERGE LOGIC
    if (updateData.yjsSnapshot) {
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
  async listDocs(userId: string) {
    const userObjId = this.utils.convertToObjectIdMongoose(userId);

    // Query documents where:
    // 1. Match roomId (if provided)
    // 2. AND (Owner is user OR Shared with user OR Public)
    const query: any = {
      $or: [
        { ownerId: userObjId },
        { 'sharedWith.userId': userObjId },
        { visibility: DocVisibilityEnum.public },
      ],
    };

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
    const canEdit = this.checkDocAccess(doc, userId, true);
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
