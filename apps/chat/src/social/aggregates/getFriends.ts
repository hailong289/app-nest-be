export const getFriendsAggregate = (
  userId: string,
  page: number,
  limit: number,
  search: string,
) => {
  const searchMatch = search
    ? {
        $or: [
          { usr_fullname: { $regex: search, $options: 'i' } },
          { usr_email: { $regex: search, $options: 'i' } },
          { usr_phone: { $regex: search, $options: 'i' } },
        ],
      }
    : {};
  return [
    {
      $lookup: {
        from: 'Friendships',
        let: { currentUserId: '$usr_id' },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ['$frp_status', 'ACCEPTED'] },
                  {
                    $or: [
                      {
                        $and: [
                          { $eq: ['$frp_userId1', userId] },
                          { $eq: ['$frp_userId2', '$$currentUserId'] },
                        ],
                      },
                      {
                        $and: [
                          { $eq: ['$frp_userId2', userId] },
                          { $eq: ['$frp_userId1', '$$currentUserId'] },
                        ],
                      },
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
    {
      $addFields: {
        friendship: { $arrayElemAt: ['$friendship', 0] },
      },
    },
    {
      $match: {
        friendship: { $ne: null },
        ...searchMatch,
      },
    },
    {
      $skip: (page - 1) * limit,
    },
    {
      $limit: limit,
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
