// user-friendship-view.pipeline.ts
import { PipelineStage } from 'mongoose';

/**
 * Dùng đoạn pipeline này ở CUỐI chuỗi aggregate trên Users.
 * @param viewerUsrId usr_id (string) của user đang xem – VD: "usr_abcd123"
 */
export function buildUserFriendshipViewPipeline(
  viewerUsrId: string,
): PipelineStage[] {
  const pipeline: PipelineStage[] = [
    // 1) Join trạng thái friendship giữa viewerUsrId và usr_id của từng user
    {
      $lookup: {
        from: 'Friendships',
        let: {
          otherUsrId: '$usr_id', // usr_id của user đang duyệt
          viewerUsrId: viewerUsrId, // usr_id của viewer (truyền vào)
        },
        pipeline: [
          {
            $match: {
              $expr: {
                $or: [
                  {
                    $and: [
                      { $eq: ['$frp_userId1', '$$viewerUsrId'] },
                      { $eq: ['$frp_userId2', '$$otherUsrId'] },
                    ],
                  },
                  {
                    $and: [
                      { $eq: ['$frp_userId2', '$$viewerUsrId'] },
                      { $eq: ['$frp_userId1', '$$otherUsrId'] },
                    ],
                  },
                ],
              },
            },
          },
          { $sort: { updatedAt: -1 } }, // lấy bản ghi mới nhất (nếu có nhiều)
          { $limit: 1 },
        ],
        as: 'friendshipDoc',
      },
    },

    // 2) Lấy doc friendship (nếu có)
    {
      $addFields: {
        friendshipDoc: { $first: '$friendshipDoc' },
      },
    },

    // 3) Map về đúng shape cần trả về
    {
      $project: {
        _id: 0,
        id: '$usr_id',
        fullname: '$usr_fullname',
        avatar: {
          $cond: [
            {
              $or: [
                { $eq: ['$usr_avatar', null] },
                { $eq: ['$usr_avatar', ''] },
              ],
            },
            null,
            '$usr_avatar',
          ],
        },
        email: { $ifNull: ['$usr_email', ''] },
        phone: { $ifNull: ['$usr_phone', null] },
        updatedAt: {
          $dateToString: {
            date: '$updatedAt',
            format: '%Y-%m-%dT%H:%M:%S.%LZ',
          },
        },
        createdAt: {
          $dateToString: {
            date: '$createdAt',
            format: '%Y-%m-%dT%H:%M:%S.%LZ',
          },
        },
        gender: {
          $cond: [
            {
              $or: [
                { $eq: ['$usr_gender', null] },
                { $eq: ['$usr_gender', ''] },
                { $eq: ['$usr_gender', 'Not Specified'] },
              ],
            },
            null,
            '$usr_gender',
          ],
        },
        status: '$usr_status',
        dateOfBirth: {
          $cond: [
            { $eq: ['$usr_dateOfBirth', null] },
            null,
            {
              $dateToString: {
                date: '$usr_dateOfBirth',
                format: '%Y-%m-%d',
              },
            },
          ],
        },

        // quan hệ friend
        friendship: {
          $ifNull: ['$friendshipDoc.frp_status', 'INVALID'],
        },
        actionUserId: {
          $ifNull: ['$friendshipDoc.frp_actionUserId', null],
        },
      },
    },
  ];

  return pipeline;
}
