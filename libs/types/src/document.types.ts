/**
 * Shared filesystem document types.
 *
 * Keep this file free of Mongoose/Nest decorators so DTOs and edge services can
 * use document contracts without importing Mongo models.
 */

export enum DocVisibilityEnum {
  private = 'private',
  room = 'room',
  public = 'public',
}

export enum sharedWithRoleEnum {
  viewer = 'viewer',
  editer = 'editer',
}

export type DocVisibility = 'private' | 'room' | 'public';
export type sharedWithRoleType = 'viewer' | 'editor';
