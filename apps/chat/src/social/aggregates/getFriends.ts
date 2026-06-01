import type { PipelineStage } from 'mongoose';

const friendshipDocFields = {
  frp_id: '$frp_id',
  frp_userId1: '$frp_userId1',
  frp_userId2: '$frp_userId2',
  frp_actionUserId: '$frp_actionUserId',
  frp_status: '$frp_status',
  createdAt: '$createdAt',
  updatedAt: '$updatedAt',
};

/**
 * Friends list rooted at Friendships (not Users).
 * Matches only ACCEPTED edges for `userId`, returns friendUsrId for hydration.
 * NOTE: $lookup Users removed — caller hydrates via GatewayClientService.
 */
export const getFriendsBaseAggregate = (
  userId: string,
  _search: string,
  allowedFriendUsrIds?: string[],
): PipelineStage[] => {
  const stages: PipelineStage[] = [
    {
      $match: {
        frp_status: 'ACCEPTED',
        $or: [{ frp_userId1: userId }, { frp_userId2: userId }],
      },
    },
    {
      $addFields: {
        friendUsrId: {
          $cond: [
            { $eq: ['$frp_userId1', userId] },
            '$frp_userId2',
            '$frp_userId1',
          ],
        },
      },
    },
    {
      $project: {
        friendUsrId: 1,
        ...friendshipDocFields,
      },
    },
  ];

  if (allowedFriendUsrIds?.length) {
    stages.push({
      $match: {
        friendUsrId: { $in: allowedFriendUsrIds },
      },
    });
  }

  return stages;
};

export const getFriendsAggregate = (
  userId: string,
  page: number,
  limit: number,
  search: string,
  allowedFriendUsrIds?: string[],
): PipelineStage[] => [
  ...getFriendsBaseAggregate(userId, search, allowedFriendUsrIds),
  { $sort: { updatedAt: -1 } },
  { $skip: (page - 1) * limit },
  { $limit: limit },
];

export const getFriendsRequestAggregate = (
  userId: string,
  type: string = 'received',
): PipelineStage[] => {
  const isReceived = type === 'received';
  return [
    {
      $match: {
        frp_status: 'PENDING',
        ...(isReceived ? { frp_userId2: userId } : { frp_userId1: userId }),
      },
    },
    {
      $addFields: {
        friendUsrId: isReceived ? '$frp_userId1' : '$frp_userId2',
      },
    },
    {
      $project: {
        friendUsrId: 1,
        ...friendshipDocFields,
      },
    },
  ];
};

/**
 * Blocked friends — returns friendUsrId without $lookup Users.
 * Caller hydrates via GatewayClientService.
 */
export const getBlockedFriendsAggregate = (userId: string): PipelineStage[] => [
  {
    $match: {
      frp_status: 'BLOCKED',
      frp_actionUserId: userId,
      $or: [{ frp_userId1: userId }, { frp_userId2: userId }],
    },
  },
  {
    $addFields: {
      friendUsrId: {
        $cond: [
          { $eq: ['$frp_userId1', userId] },
          '$frp_userId2',
          '$frp_userId1',
        ],
      },
    },
  },
  {
    $project: {
      friendUsrId: 1,
      ...friendshipDocFields,
    },
  },
];
