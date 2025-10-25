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
      $match: {
        friendship: { $ne: [] },
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
