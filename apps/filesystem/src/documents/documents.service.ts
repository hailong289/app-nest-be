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
  Room,
  User,
} from 'libs/db/src';
import { Model } from 'mongoose';
import * as Y from 'yjs';
import { ClientKafka } from '@nestjs/microservices';
import { SERVICES } from '@app/constants';
import { KafkaEvent } from '@app/dto/enum.type';

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
    @Inject(SERVICES.AI) private readonly aiClient: ClientKafka,
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

      // 2. Check Room Members (nếu doc chưa populate hoặc user không nằm trong sharedWith)
      if (
        doc &&
        Array.isArray((doc as { roomIds?: unknown }).roomIds) &&
        (doc as { roomIds: unknown[] }).roomIds.length > 0
      ) {
        const roomIdsArray = (doc as { roomIds: string[] }).roomIds;
        const room = await this.roomModel.findOne({
          _id: {
            $in: roomIdsArray.map((i: string) =>
              this.utils.convertToObjectIdMongoose(i),
            ),
          },
          'room_members.user_id': userObjId,
        });

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
   * Helper: Aggregation Pipeline to populate Owner and Shared Users
   */
  private getPopulateDocsPipeline(matchQuery: Record<string, unknown>): any[] {
    return [
      { $match: matchQuery },
      // Lookup Owner
      {
        $lookup: {
          from: 'Users',
          localField: 'ownerId',
          foreignField: '_id',
          as: 'owner_info',
        },
      },
      {
        $unwind: {
          path: '$owner_info',
          preserveNullAndEmptyArrays: true,
        },
      },
      // Unwind sharedWith to populate
      // --- NEW LOGIC: Merge Room Members into SharedWith ---
      {
        $lookup: {
          from: 'Rooms',
          localField: 'roomIds',
          foreignField: '_id',
          as: 'room_infos',
        },
      },
      {
        $addFields: {
          room_members_normalized: {
            $reduce: {
              input: '$room_infos',
              initialValue: [],
              in: {
                $concatArrays: [
                  '$$value',
                  {
                    $map: {
                      input: '$$this.room_members',
                      as: 'member',
                      in: {
                        userId: '$$member.user_id',
                        role: {
                          $cond: {
                            if: { $eq: ['$$member.role', 'guest'] },
                            then: 'viewer',
                            else: 'editor',
                          },
                        },
                        sharedAt: '$$member.joinedAt',
                      },
                    },
                  },
                ],
              },
            },
          },
        },
      },
      {
        $addFields: {
          combined_shared: {
            $concatArrays: [
              { $ifNull: ['$sharedWith', []] },
              { $ifNull: ['$room_members_normalized', []] },
            ],
          },
        },
      },
      {
        $unwind: {
          path: '$combined_shared',
          preserveNullAndEmptyArrays: true,
        },
      },
      // Lookup sharedWith user
      {
        $lookup: {
          from: 'Users',
          localField: 'combined_shared.userId',
          foreignField: '_id',
          as: 'combined_shared.user_info',
        },
      },
      {
        $unwind: {
          path: '$combined_shared.user_info',
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
              user: {
                _id: '$combined_shared.user_info._id',
                usr_id: '$combined_shared.user_info.usr_id',
                usr_slug: '$combined_shared.user_info.usr_slug',
                usr_fullname: '$combined_shared.user_info.usr_fullname',
                usr_avatar: '$combined_shared.user_info.usr_avatar',
                usr_email: '$combined_shared.user_info.usr_email',
              },
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
          'root.owner': {
            _id: '$root.owner_info._id',
            usr_id: '$root.owner_info.usr_id',
            usr_slug: '$root.owner_info.usr_slug',
            usr_fullname: '$root.owner_info.usr_fullname',
            usr_avatar: '$root.owner_info.usr_avatar',
            usr_email: '$root.owner_info.usr_email',
          },
        },
      },
      {
        $replaceRoot: { newRoot: '$root' },
      },
      // Cleanup temporary fields
      {
        $project: {
          owner_info: 0,
          room_infos: 0,
          room_members_normalized: 0,
          combined_shared: 0,
          'sharedWith.user_info': 0,
          yjsSnapshot: 0, // Optimization: Remove heavy binary data
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
                user: {
                  _id: { $toString: '$$sw.user._id' },
                  usr_id: '$$sw.user.usr_id',
                  usr_slug: '$$sw.user.usr_slug',
                  usr_fullname: '$$sw.user.usr_fullname',
                  usr_avatar: '$$sw.user.usr_avatar',
                  usr_email: '$$sw.user.usr_email',
                },
              },
            },
          },
        },
      },
    ];
  }

  /**
   * Helper: Get formatted document by ID (Standard Output)
   */
  private async getFormattedDocumentById(docId: string) {
    const docs = await this.docsModel.aggregate(
      this.getPopulateDocsPipeline({
        _id: this.utils.convertToObjectIdMongoose(docId),
      }),
    );
    const doc = docs[0] as Document & { _id: any };

    if (doc) {
      // Fix: Re-fetch yjsSnapshot directly to ensure binary data is correct
      const rawDoc = await this.docsModel.findById(doc._id, { yjsSnapshot: 1 });
      if (rawDoc?.yjsSnapshot) {
        doc.yjsSnapshot = rawDoc.yjsSnapshot;
      }
    }
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
      query.roomIds = { $in: [room._id] };

      // Check if user is member of the room
      const isMember = room.room_members.some(
        (m) => m.user_id.toString() === userObjId.toString(),
      );

      if (isMember) {
        // If member, can also see 'room' visibility docs
        orConditions.push({ visibility: DocVisibilityEnum.room });
      }
    } else {
      // If no roomId, list personal docs (roomIds is empty or not exists)
      query.$or = [{ roomIds: { $exists: false } }, { roomIds: { $size: 0 } }];
    }

    // Combine conditions
    if (roomId) {
      query.$or = orConditions;
    } else {
      // For personal docs, we need to match (No Room) AND (Owner OR Shared)
      // But wait, if it's personal doc, it MUST be owner or shared.
      // The previous logic was: query.roomId = { $exists: false } AND $or = [owner, shared]
      // So:
      query.$and = [
        { $or: [{ roomIds: { $exists: false } }, { roomIds: { $size: 0 } }] },
        { $or: orConditions },
      ];
      delete query.$or; // Remove the previous $or assignment
    }

    const docs = await this.docsModel.aggregate(
      this.getPopulateDocsPipeline(query),
    );

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
}
