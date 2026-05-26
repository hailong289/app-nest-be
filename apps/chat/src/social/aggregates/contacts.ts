/**
 * Contact list — database-isolated version.
 *
 * The old pipeline started from the Users collection (auth DB) and used
 * a cross-DB $lookup into Friendships. With database isolation, all user
 * data must come from the Auth service via gRPC.
 *
 * New approach (implement in social.service.ts getContacts()):
 *   1. Call gRPC authGrpcClient.ListUsers({ page, limit, excludeUserId })
 *      to get all users.
 *   2. Extract userIds and query friendshipModel.find() for friendship
 *      statuses between current user and each contact.
 *   3. Merge friendship status into the user objects at the application
 *      layer.
 *
 * This file is kept as a placeholder for the pipeline shape reference.
 * The actual logic lives in social.service.ts.
 *
 * @deprecated Use gRPC ListUsers + local friendship query instead.
 */
export const buildContactsPipeline = (_currentUsrId: string): any[] => {
  // No MongoDB pipeline needed — all user data comes via gRPC.
  return [];
};
