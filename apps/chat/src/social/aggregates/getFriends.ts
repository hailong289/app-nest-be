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
 * Matches only ACCEPTED edges for `userId`, then joins the friend profile.
 */
export const getFriendsBaseAggregate = (
  userId: string,
  search: string,
): PipelineStage[] => {
  const searchMatch = search
    ? {
        $or: [
          { 'user.usr_fullname': { $regex: search, $options: 'i' } },
          { 'user.usr_email': { $regex: search, $options: 'i' } },
          { 'user.usr_phone': { $regex: search, $options: 'i' } },
        ],
      }
    : null;

  const stages: PipelineStage[] = [
    {
      $match: {
        frp_status: 'ACCEPTED',
        $or: [{ frp_userId1: userId }, { frp_userId2: userId }],
      },
    },
    {
      $addFields: {
        friendUserId: {
          $cond: [
            { $eq: ['$frp_userId1', userId] },
            '$frp_userId2',
            '$frp_userId1',
          ],
        },
      },
    },
    {
      $lookup: {
        from: 'Users',
        localField: 'friendUserId',
        foreignField: 'usr_id',
        as: 'user',
      },
    },
    { $unwind: '$user' },
  ];

  if (searchMatch) {
    stages.push({ $match: searchMatch });
  }

  stages.push({
    $replaceRoot: {
      newRoot: {
        $mergeObjects: ['$user', { friendship: friendshipDocFields }],
      },
    },
  });

  return stages;
};

export const getFriendsAggregate = (
  userId: string,
  page: number,
  limit: number,
  search: string,
): PipelineStage[] => [
  ...getFriendsBaseAggregate(userId, search),
  { $sort: { 'friendship.updatedAt': -1 } },
  { $skip: (page - 1) * limit },
  { $limit: limit },
];

/** Single round-trip: paginated friends + total count. */
export const getFriendsFacetAggregate = (
  userId: string,
  page: number,
  limit: number,
  search: string,
): PipelineStage[] => [
  ...getFriendsBaseAggregate(userId, search),
  {
    $facet: {
      data: [
        { $sort: { 'friendship.updatedAt': -1 } },
        { $skip: (page - 1) * limit },
        { $limit: limit },
      ],
      total: [{ $count: 'total' }],
    },
  },
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
        friendUserId: isReceived ? '$frp_userId1' : '$frp_userId2',
      },
    },
    {
      $lookup: {
        from: 'Users',
        localField: 'friendUserId',
        foreignField: 'usr_id',
        as: 'user',
      },
    },
    { $unwind: '$user' },
    {
      $replaceRoot: {
        newRoot: {
          $mergeObjects: ['$user', { friendship: friendshipDocFields }],
        },
      },
    },
  ];
};

export const searchUsersAggregate = (
  search: string,
  page: number,
  limit: number,
  userId: string,
) => {
  const matchSearch = search
    ? {
        $or: [
          { usr_fullname: { $regex: search, $options: 'i' } },
          { usr_email: { $regex: search, $options: 'i' } },
          { usr_phone: { $regex: search, $options: 'i' } },
        ],
      }
    : {};
  return [
    { $match: { ...matchSearch, usr_id: { $ne: userId } } },
    {
      $lookup: {
        from: 'Friendships',
        let: { currentUserId: userId, candidateId: '$usr_id' },
        pipeline: [
          {
            $match: {
              $expr: {
                $or: [
                  {
                    $and: [
                      { $eq: ['$frp_userId1', '$$currentUserId'] },
                      { $eq: ['$frp_userId2', '$$candidateId'] },
                    ],
                  },
                  {
                    $and: [
                      { $eq: ['$frp_userId2', '$$currentUserId'] },
                      { $eq: ['$frp_userId1', '$$candidateId'] },
                    ],
                  },
                ],
              },
            },
          },
        ],
        as: 'friendship',
      },
    },
    { $match: { friendship: { $eq: [] } } },
  ];
};

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
      friendUserId: {
        $cond: [
          { $eq: ['$frp_userId1', userId] },
          '$frp_userId2',
          '$frp_userId1',
        ],
      },
    },
  },
  {
    $lookup: {
      from: 'Users',
      localField: 'friendUserId',
      foreignField: 'usr_id',
      as: 'user',
    },
  },
  { $unwind: '$user' },
  {
    $replaceRoot: {
      newRoot: {
        $mergeObjects: ['$user', { friendship: friendshipDocFields }],
      },
    },
  },
];
