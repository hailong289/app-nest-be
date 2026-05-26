import type { PipelineStage } from 'mongoose';

/**
 * Build a "friends of friends" suggestion pipeline rooted at `userId`,
 * operating entirely within the Friendships collection (chat DB).
 *
 * Algorithm (Mutual Friends Count):
 *   1. Match every ACCEPTED friendship the user is part of → set F.
 *   2. For every friend in F, look up THEIR friendships → candidate set F2.
 *   3. Look up anyone the user has BLOCKED, PENDING, or REJECTED edges with.
 *   4. Drop anyone already in F or in the excluded set.
 *   5. Group by candidate id, count mutual friends, collect mutualVia IDs.
 *   6. Return `{ _id: candidateUserId, mutualFriendsCount, mutualVia }`.
 *
 * Final user-info hydration (names, avatars, mutual-friend names) is
 * done in social.service.ts via batch gRPC calls to the Auth service.
 */
export const getFriendSuggestionsAggregate = (
  userId: string,
  limit = 10,
): PipelineStage[] => {
  return [
    // 1. Get user's ACCEPTED friendships → extract friend IDs
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
        friendId: {
          $cond: [
            { $eq: ['$frp_userId1', userId] },
            '$frp_userId2',
            '$frp_userId1',
          ],
        },
      },
    },
    // Collect all friends into one document for downstream lookups
    {
      $group: {
        _id: null,
        myFriends: { $addToSet: '$friendId' },
      },
    },

    // 2. Pull every edge that has any of those friends on either side
    //    (status ACCEPTED) — these yield the candidates.
    {
      $lookup: {
        from: 'Friendships',
        let: { friends: '$myFriends' },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ['$frp_status', 'ACCEPTED'] },
                  {
                    $or: [
                      { $in: ['$frp_userId1', '$$friends'] },
                      { $in: ['$frp_userId2', '$$friends'] },
                    ],
                  },
                ],
              },
            },
          },
          {
            $project: {
              _id: 0,
              candidate: {
                $cond: [
                  { $in: ['$frp_userId1', '$$friends'] },
                  '$frp_userId2',
                  '$frp_userId1',
                ],
              },
              via: {
                $cond: [
                  { $in: ['$frp_userId1', '$$friends'] },
                  '$frp_userId1',
                  '$frp_userId2',
                ],
              },
            },
          },
        ],
        as: 'candidateEdges',
      },
    },

    // 3. Pull every blocked / pending / rejected edge for the user —
    //    used to exclude anyone with an existing relationship.
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
              _id: 0,
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
    { $addFields: { excluded: '$excludedEdges.otherId' } },

    // 4. Explode candidates → 1 row per (candidate, via) pair.
    { $unwind: '$candidateEdges' },

    // 5. Drop existing friends and excluded relationships.
    //    (Self is already in myFriends so it is automatically excluded.)
    {
      $match: {
        $expr: {
          $and: [
            { $not: { $in: ['$candidateEdges.candidate', '$myFriends'] } },
            { $not: { $in: ['$candidateEdges.candidate', '$excluded'] } },
          ],
        },
      },
    },

    // 6. Group by candidate, count mutual friends, collect via-list.
    {
      $group: {
        _id: '$candidateEdges.candidate',
        mutualFriendsCount: { $sum: 1 },
        mutualVia: { $addToSet: '$candidateEdges.via' },
      },
    },
    { $sort: { mutualFriendsCount: -1 } },
    { $limit: Math.max(1, Math.min(50, limit)) },

    // 7. Return candidate IDs only (no User collection lookups).
    {
      $project: {
        _id: 1,
        mutualFriendsCount: 1,
        // Slice to max 3 mutual friend IDs (names resolved via gRPC).
        mutualVia: { $slice: ['$mutualVia', 3] },
      },
    },
  ];
};
