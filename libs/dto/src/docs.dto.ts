import { DocVisibility, sharedWithRoleType } from 'libs/db/src';

export type sharedWithType = {
  userId: string;
  role: sharedWithRoleType;
};
export interface CreateDocDto {
  owerId: string; // user id tạo
  title: string;

  visibility: DocVisibility;
  yjsSnapshot: Buffer | null;
  plainText: string;
  attachmentIds?: Array<string>;
  sharedWith?: Array<sharedWithType>;
}

export interface CreateDocRequest {
  owerId: string;
  title: string;
  roomId: string;
  visibility?: string;
  yjsSnapshot?: Buffer;
  plainText?: string;
  attachmentIds?: string[];
  sharedWith?: Array<{ userId: string; role: string }>;
}

export interface GetDocRequest {
  docId: string;
  userId: string;
}

export interface UpdateDocRequest {
  docId: string;
  userId: string;
  yjsSnapshot?: Buffer;
  plainText?: string;
}

export interface DeleteDocRequest {
  docId: string;
  userId: string;
}

export interface ListDocsRequest {
  roomId: string;
  userId: string;
}

export interface ResponseMetadata {
  [key: string]: any;
}

export interface ServiceResponse {
  message: string;
  statusCode: number;
  reasonStatusCode: string;
  metadata?: ResponseMetadata;
}
