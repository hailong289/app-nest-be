import Utils from '@app/helpers/utils';
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Attachment, Document } from 'libs/db/src';
import { Model } from 'mongoose';

@Injectable()
export class DocumentsService {
  private readonly utils = Utils;
  constructor(
    @InjectModel(Attachment.name)
    private readonly attachmentModel: Model<Attachment>,
    @InjectModel(Document.name)
    private readonly docsModel: Model<Document>,
  ) {}

  async createDoc() {}
}
