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
  AttachmentKindEnum,
  Document,
  DocVisibilityEnum,
  Room,
} from 'libs/db/src';
import { Model } from 'mongoose';

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

  async createDoc({
    owerId,
    title,
    roomId,
    visibility = DocVisibilityEnum.private,
    yjsSnapshot = null,
    plainText,
    attachmentIds = [],
    sharedWith = [],
  }: CreateDocDto) {
    // get find find room

    const roomInfo = await this.roomModel.findOne({
      room_id: {
        $in: [roomId, this.utils.pairRoomId(owerId, roomId)],
      },
    });
    if (!roomInfo) {
      throw new NotFoundException('Không tìm thấy thông tin phòng');
    }
    const newDoc = await this.docsModel.create({
      owerId: this.utils.convertToObjectIdMongoose(owerId),
      title,
      visibility,
      yjsSnapshot,
      plainText,
      attachmentIds,
      sharedWith,
      roomId: roomInfo._id,
    });

    if (!newDoc) {
      throw new BadGatewayException('Tạo thất bãi vui lòng thử lại');
    }

    // creeate attachment

    const newAtt = await this.attachmentModel.create({
      room_id: roomInfo._id,
      user_id: this.utils.convertToObjectIdMongoose(owerId),
      kind: AttachmentKindEnum.doc,
      contextType: AttachmentContextEnumType.doc,
      contextId: newDoc._id,
    });

    if (!newAtt) {
      await newDoc.deleteOne();
      throw new BadGatewayException('Tạo thất bãi vui lòng thử lại');
    }

    return Response.success(newDoc, 'Tạo thành công');
  }
}
