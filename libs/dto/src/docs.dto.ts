import { DocVisibility, sharedWithRoleType } from 'libs/db/src';

export type sharedWithType = {
  userId: string;
  role: sharedWithRoleType;
};
export interface CreateDocDto {
  owerId: string; // user id tạo
  title: string;
  roomId: string;
  visibility: DocVisibility;
  yjsSnapshot: Buffer | null;
  plainText: string;
  attachmentIds?: Array<string>;
  sharedWith?: Array<sharedWithType>;
}
