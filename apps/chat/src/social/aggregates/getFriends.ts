/**
 * Database-isolated friendship aggregates.
 *
 * All pipelines now start from the Friendships collection (chat DB).
 * Cross-DB lookups to the Users collection (auth DB) have been removed.
 * Foreign user IDs (friendId, otherId, blockedUserId) are returned
 * for later hydration via gRPC Auth service in social.service.ts.
 */

/**
 * Match all ACCEPTED friendships where `userId` is either party.
 * Returns friendship fields + computed `friendId` (the other party).
 */
export const getFriendsBaseAggregate = (userId: string) => {
  return [
    {
      $match: {
        frp_status: 'ACCEPTED',
        $or: [
          { frp_userId1: userId },
          { frp_userId2: userId },
        ],
      },
    },
    {
      $project: {
        _id: 1,
        frp_id: 1,
        frp_userId1: 1,
        frp_userId2: 1,
        frp_actionUserId: 1,
        frp_status: 1,
        createdAt: 1,
        updatedAt: 1,
        friendId: {
          $cond: [
            { $eq: ['$frp_userId1', userId] },
            '$frp_userId2',
            '$frp_userId1',
          ],
        },
      },
    },
  ];
};

/**
 * Paginated version of getFriendsBaseAggregate.
 * Pagination is applied in-DB; caller hydrates friendIds via gRPC.
 */
export const getFriendsAggregate = (
  userId: string,
  page: number,
  limit: number,
) => [
  ...getFriendsBaseAggregate(userId),
  { $skip: (page - 1) * limit },
  { $limit: limit },
];

/**
 * Match PENDING friendships involving `userId`.
 * For type='received': userId is the target (frp_userId2).
 * For type='sent': userId is the requester (frp_userId1).
 * Returns friendship fields + computed `otherId` (the other party).
 */
export const getFriendsRequestAggregate = (
  userId: string,
  type: string = 'received',
) => {
  const matchCondition =
    type === 'received'
      ? { frp_userId2: userId }
      : { frp_userId1: userId };
  return [
    {
      $match: {
        frp_status: 'PENDING',
        ...matchCondition,
      },
    },
    {
      $project: {
        _id: 1,
        frp_id: 1,
        frp_userId1: 1,
        frp_userId2: 1,
        frp_actionUserId: 1,
        frp_status: 1,
        createdAt: 1,
        updatedAt: 1,
        otherId:
          type === 'received' ? '$frp_userId1' : '$frp_userId2',
      },
    },
  ];
};

/**
 * searchUsersAggregate has been removed.
 * User search is now handled via gRPC auth.SearchUsers + local
 * friendship status check in social.service.ts.
 */

/**
 * Match BLOCKED friendships where `userId` is the action user (blocker).
 * Returns friendship fields + computed `blockedUserId` (the blocked party).
 */
export const getBlockedFriendsAggregate = (userId: string) => {
  return [
    {
      $match: {
        frp_status: 'BLOCKED',
        $or: [
          { frp_userId1: userId },
          { frp_userId2: userId },
        ],
        frp_actionUserId: userId,
      },
    },
    {
      $project: {
        _id: 1,
        frp_id: 1,
        frp_userId1: 1,
        frp_userId2: 1,
        frp_actionUserId: 1,
        frp_status: 1,
        createdAt: 1,
        updatedAt: 1,
        blockedUserId: {
          $cond: [
            { $eq: ['$frp_userId1', userId] },
            '$frp_userId2',
            '$frp_userId1',
          ],
        },
      },
    },
  ];
};
