// currentUsrId: usr_id của user đang thực hiện truy vấn (string)
export const buildContactsPipeline = (currentUsrId: string) => [
  // 1) Lấy toàn bộ user KHÁC current user
  {
    $match: {
      usr_id: { $ne: currentUsrId },
    },
  },

  // 2) Lookup Friendships giữa currentUsrId và từng user còn lại
  {
    $lookup: {
      from: 'Friendships',
      let: { otherId: '$usr_id' },
      pipeline: [
        {
          $match: {
            $expr: {
              $or: [
                {
                  $and: [
                    { $eq: ['$frp_userId1', currentUsrId] },
                    { $eq: ['$frp_userId2', '$$otherId'] },
                  ],
                },
                {
                  $and: [
                    { $eq: ['$frp_userId2', currentUsrId] },
                    { $eq: ['$frp_userId1', '$$otherId'] },
                  ],
                },
              ],
            },
          },
        },
        {
          $project: {
            frp_status: 1,
            frp_actionUserId: 1,
          },
        },
      ],
      as: 'friendshipInfo',
    },
  },

  // 3) Nếu không có record friendship → set mặc định INVALID
  {
    $addFields: {
      friendshipData: {
        $cond: [
          { $gt: [{ $size: '$friendshipInfo' }, 0] },
          { $first: '$friendshipInfo' },
          {
            frp_status: 'INVALID',
            frp_actionUserId: null,
          },
        ],
      },
    },
  },

  // 4) Project về đúng ContactType
  {
    $project: {
      id: '$usr_id',
      fullname: '$usr_fullname',
      avatar: '$usr_avatar',
      email: '$usr_email',
      phone: '$usr_phone',
      updatedAt: '$updatedAt',
      createdAt: '$createdAt',
      gender: '$usr_gender',
      status: '$usr_status',
      dateOfBirth: '$usr_dateOfBirth',

      friendship: '$friendshipData.frp_status',
      actionUserId: '$friendshipData.frp_actionUserId',

      // Phần online sẽ merge ở code / Redis sau
      isOnline: { $literal: false },
      onlineAt: { $literal: null },
    },
  },
];
