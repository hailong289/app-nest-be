import { DocVisibility, sharedWithRoleType } from 'libs/db/src';

export class sharedWithType {
  userId: string;
  role: sharedWithRoleType;
}
export class CreateDocDto {
  owerId: string; // user id tạo
  title: string;
  roomId?: string;
  visibility: DocVisibility;
  yjsSnapshot: Buffer | null;
  plainText: string;
  attachmentIds?: Array<string>;
  sharedWith?: Array<sharedWithType>;
}

export class CreateDocRequest {
  owerId: string;
  title: string;
  roomId: string;
  visibility?: string;
  yjsSnapshot?: Buffer;
  plainText?: string;
  attachmentIds?: string[];
  sharedWith?: Array<{ userId: string; role: string }>;
}

export class GetDocRequest {
  docId: string;
  userId: string;
}

export class UpdateDocRequest {
  docId: string;
  userId: string;
  yjsSnapshot?: Buffer;
  plainText?: string;
}

export class DeleteDocRequest {
  docId: string;
  userId: string;
}

export class ListDocsRequest {
  roomId: string;
  userId: string;
}

export class ShareDocumentRequest {
  docId: string;
  userId: string;
  shareUserId: string;
  role: string;
}

export class UnshareDocumentRequest {
  docId: string;
  userId: string;
  shareUserId: string;
}

export class UpdateTitleRequest {
  docId: string;
  userId: string;
  title: string;
}

export class UpdateVisibilityRequest {
  docId: string;
  userId: string;
  visibility: string;
}

export class DuplicateDocRequest {
  docId: string;
  userId: string;
}

export class ResponseMetadata {
  [key: string]: any;
}

export class ServiceResponse {
  message: string;
  statusCode: number;
  reasonStatusCode: string;
  metadata?: ResponseMetadata;
}
