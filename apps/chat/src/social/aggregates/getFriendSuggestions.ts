import type { PipelineStage } from 'mongoose';

/**
 * Build a "friends of friends" suggestion pipeline rooted at `userId`.
 *
 * Algorithm (Mutual Friends Count):
 *   1. Look up every ACCEPTED friendship the user is part of → set F.
 *   2. For every friend in F, look up THEIR friendships → candidate set F₂.
 *   3. Drop the user themselves and anyone already in F.
 *   4. Drop anyone the user has BLOCKED or who has BLOCKED them.
 *   5. Drop anyone with a PENDING/REJECTED edge to/from the user (they
 *      already have a relationship — don't re-suggest).
 *   6. Group by candidate id, count how many times they appear → that's
 *      the mutual-friends count = the suggestion's rank score.
 *   7. Join User collection so the FE has profile fields.
 *   8. Sort by score desc, limit.
 *
 * The pipeline starts from the Users collection (matching the requester's
 * usr_id) so the early-exit case (user has no friends) yields an empty
 * array instead of throwing on a $group with null _id.
 */
export const getFriendSuggestionsAggregate = (
  userId: string,
  limit = 10,
): PipelineStage[] => {
  return [
    // 1. Anchor on the requester so we have their usr_id available downstream.
    { $match: { usr_id: userId } },
    { $project: { usr_id: 1, _id: 0 } },

    // 2. Pull every friendship edge involving this user (status ACCEPTED).
    {
      $lookup: {
        from: 'Friendships',
        let: { uid: '$usr_id' },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ['$frp_status', 'ACCEPTED'] },
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
              friendId: {
                $cond: [
                  { $eq: ['$frp_userId1', '$$uid'] },
                  '$frp_userId2',
                  '$frp_userId1',
                ],
              },
            },
          },
        ],
        as: 'friendEdges',
      },
    },
    {
      $addFields: {
        myFriends: '$friendEdges.friendId',
      },
    },

    // 3. Pull every edge that has any of those friends on either side
    //    (status ACCEPTED) — these contain the candidates' ids.
    {
      $lookup: {
        from: 'Friendships',
        let: { friends: '$myFriends', uid: '$usr_id' },
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

    // 4. Pull every blocked / pending / rejected edge for the user — we'll
    //    use these to filter out anyone we shouldn't suggest.
    {
      $lookup: {
        from: 'Friendships',
        let: { uid: '$usr_id' },
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
    { $addFields: { excluded: '$excludedEdges.otherId' } },

    // 5. Explode candidates → 1 row per (candidate, via) pair.
    { $unwind: '$candidateEdges' },

    // 6. Drop self, existing friends, and excluded relationships.
    {
      $match: {
        $expr: {
          $and: [
            { $ne: ['$candidateEdges.candidate', '$usr_id'] },
            { $not: { $in: ['$candidateEdges.candidate', '$myFriends'] } },
            { $not: { $in: ['$candidateEdges.candidate', '$excluded'] } },
          ],
        },
      },
    },

    // 7. Group by candidate, count mutual friends, collect via-list (the
    //    friends-in-common ids — used later for "X friends including Y, Z").
    {
      $group: {
        _id: '$candidateEdges.candidate',
        mutualFriendsCount: { $sum: 1 },
        mutualVia: { $addToSet: '$candidateEdges.via' },
      },
    },
    { $sort: { mutualFriendsCount: -1 } },
    { $limit: Math.max(1, Math.min(50, limit)) },

    // 8. Join the User collection for profile fields.
    {
      $lookup: {
        from: 'Users',
        localField: '_id',
        foreignField: 'usr_id',
        as: 'user',
      },
    },
    { $unwind: '$user' },

    // 9. Resolve up to 3 mutual-friend names (best-effort sample, not full list)
    {
      $lookup: {
        from: 'Users',
        let: { ids: { $slice: ['$mutualVia', 3] } },
        pipeline: [
          { $match: { $expr: { $in: ['$usr_id', '$$ids'] } } },
          { $project: { _id: 0, name: '$usr_fullname' } },
        ],
        as: 'mutualFriendsSample',
      },
    },

    // 10. Final shape — match the proto FriendSuggestion fields.
    {
      $project: {
        _id: { $toString: '$user._id' },
        id: '$user.usr_id',
        fullname: '$user.usr_fullname',
        avatar: '$user.usr_avatar',
        email: '$user.usr_email',
        mutualFriendsCount: 1,
        mutualSamples: '$mutualFriendsSample.name',
      },
    },
  ];
};
