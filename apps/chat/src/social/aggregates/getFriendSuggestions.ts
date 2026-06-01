import type { PipelineStage } from 'mongoose';

/**
 * Build a "friends of friends" suggestion pipeline rooted at `userId`.
 *
 * Algorithm (Mutual Friends Count):
 *   1. Pull every ACCEPTED friendship the user is part of → set F.
 *   2. For every friend in F, pull THEIR friendships → candidate set F₂.
 *   3. Drop the user themselves and anyone already in F.
 *   4. Drop anyone blocked/pending/rejected.
 *   5. Group by candidate usr_id, count mutual-friends appearances.
 *   6. Sort by score desc, limit.
 *
 * NOTE: $lookup Users removed — caller hydrates via GatewayClientService.
 * Pipeline returns { _id: candidateUsrId, mutualFriendsCount, mutualVia }.
 */
export const getFriendSuggestionsAggregate = (
  userId: string,
  limit = 10,
): PipelineStage[] => {
  return [
    // 1. Anchor on the user's friendship edges (status ACCEPTED)
    {
      $match: {
        frp_status: 'ACCEPTED',
        $or: [{ frp_userId1: userId }, { frp_userId2: userId }],
      },
    },
    {
      $project: {
        friendId: {
          $cond: [
            { $eq: ['$frp_userId1', userId] },
            '$frp_userId2',
            '$frp_userId1',
          ],
        },
      },
    },
    // 2. Collect my friends
    {
      $group: {
        _id: null,
        myFriends: { $addToSet: '$friendId' },
      },
    },
    // 3. Unwind to get each friend's edges
    { $unwind: '$myFriends' },
    {
      $lookup: {
        from: 'Friendships',
        let: { friendId: '$myFriends', uid: userId, myFriends: '$myFriends' },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ['$frp_status', 'ACCEPTED'] },
                  {
                    $or: [
                      { $eq: ['$frp_userId1', '$$friendId'] },
                      { $eq: ['$frp_userId2', '$$friendId'] },
                    ],
                  },
                ],
              },
            },
          },
          {
            $project: {
              candidate: {
                $cond: [
                  { $eq: ['$frp_userId1', '$$friendId'] },
                  '$frp_userId2',
                  '$frp_userId1',
                ],
              },
              via: '$$friendId',
            },
          },
        ],
        as: 'candidateEdges',
      },
    },
    { $unwind: '$candidateEdges' },
    // 4. Pull all excluded edges (blocked/pending/rejected)
    {
      $lookup: {
        from: 'Friendships',
        let: { uid: userId },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $in: ['$frp_status', ['BLOCKED', 'PENDING', 'REJECTED']] },
                  {
                    $or: [
                      { $eq: ['$frp_userId1', '$$uid'] },
                      { $eq: ['$frp_userId2', '$$uid'] },
                    ],
                  },
                ],
              },
            },
          },
          {
            $project: {
              otherId: {
                $cond: [
                  { $eq: ['$frp_userId1', '$$uid'] },
                  '$frp_userId2',
                  '$frp_userId1',
                ],
              },
            },
          },
        ],
        as: 'excludedEdges',
      },
    },
    { $addFields: { excluded: '$excludedEdges.otherId', myFriendsArr: ['$myFriends'] } },
    // 5. Drop self, existing friends, excluded
    {
      $match: {
        $expr: {
          $and: [
            { $ne: ['$candidateEdges.candidate', userId] },
            { $ne: ['$candidateEdges.candidate', '$myFriends'] },
            { $not: { $in: ['$candidateEdges.candidate', '$excluded'] } },
          ],
        },
      },
    },
    // 6. Group + count mutual friends
    {
      $group: {
        _id: '$candidateEdges.candidate',    // usr_id of candidate
        mutualFriendsCount: { $sum: 1 },
        mutualVia: { $addToSet: '$candidateEdges.via' },
      },
    },
    { $sort: { mutualFriendsCount: -1 } },
    { $limit: Math.max(1, Math.min(50, limit)) },
    // Output: { _id: candidateUsrId, mutualFriendsCount, mutualVia }
    // Caller (SocialService) hydrates user profiles via GatewayClientService.
  ];
};
