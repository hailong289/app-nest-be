import Utils from '@app/helpers/utils';
import { PipelineStage } from 'mongoose';

export function buildMessageCorePipeline(userId: string): PipelineStage[] {
  const uid = Utils.convertToObjectIdMongoose(userId);

  const stages: PipelineStage[] = [
    /** 0) Map sang Room (để lấy room_type, room_id, room_members) */
    {
      $lookup: {
        from: 'Rooms',
        localField: 'msg_roomId', // ObjectId
        foreignField: '_id', // Room._id
        as: 'roomDoc',
      },
    },
    { $set: { roomDoc: { $first: '$roomDoc' } } },

    /** 0.1) Tìm otherMember trong phòng private */
    {
      $addFields: {
        otherMember: {
          $first: {
            $filter: {
              input: '$roomDoc.room_members',
              as: 'm',
              cond: { $ne: ['$$m.user_id', uid] },
            },
          },
        },
      },
    },

    /** 1) Sender */
    {
      $lookup: {
        from: 'Users',
        localField: 'msg_sender',
        foreignField: '_id',
        pipeline: [{ $project: { _id: 1, usr_fullname: 1, usr_avatar: 1 } }],
        as: 'sender',
      },
    },
    { $set: { sender: { $first: '$sender' } } },

    /** 2) Attachments */
    {
      $lookup: {
        from: 'Attachments',
        localField: 'attachments',
        foreignField: '_id',
        pipeline: [
          {
            $project: {
              _id: 1,
              kind: 1,
              url: 1,
              name: 1,
              size: 1,
              mimeType: 1,
              thumbUrl: 1,
              width: 1,
              height: 1,
              duration: 1,
              status: 1,
            },
          },
        ],
        as: 'attachments',
      },
    },

    /** 3) Reply (rút gọn) */
    {
      $lookup: {
        from: 'Messages',
        localField: 'reply_to',
        foreignField: '_id',
        as: 'reply_doc',
      },
    },
    { $set: { reply_doc: { $first: '$reply_doc' } } },
    {
      $lookup: {
        from: 'Users',
        localField: 'reply_doc.msg_sender',
        foreignField: '_id',
        pipeline: [{ $project: { _id: 1, usr_fullname: 1 } }],
        as: 'reply_sender',
      },
    },
    { $set: { reply_sender: { $first: '$reply_sender' } } },

    /** 4) Reactions (group theo emoji) */
    {
      $lookup: {
        from: 'MessageReactions',
        localField: '_id',
        foreignField: 'msg_id',
        pipeline: [
          {
            $lookup: {
              from: 'Users',
              localField: 'user_id',
              foreignField: '_id',
              pipeline: [
                {
                  $project: {
                    _id: 1,
                    usr_fullname: 1,
                    usr_avatar: 1,
                    usr_id: 1,
                  },
                },
              ],
              as: 'user',
            },
          },
          { $set: { user: { $first: '$user' } } },
          {
            $group: {
              _id: '$emoji',
              users: { $push: '$user' },
              count: { $sum: 1 },
            },
          },
          { $project: { _id: 0, emoji: '$_id', count: 1, users: 1 } },
        ],
        as: 'reactions',
      },
    },

    /** 5) Hides (flag user đã ẩn message này chưa) */
    {
      $lookup: {
        from: 'MessageHides',
        let: { mid: '$_id' },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ['$msg_id', '$$mid'] },
                  { $eq: ['$user_id', uid] },
                ],
              },
            },
          },
          { $limit: 1 },
        ],
        as: 'hiddenByMeDoc',
      },
    },
    { $set: { hiddenByMeDoc: { $first: '$hiddenByMeDoc' } } },
    {
      $addFields: {
        hiddenByMe: { $toBool: '$hiddenByMeDoc' },
        hiddenAt: '$hiddenByMeDoc.hiddenAt',
      },
    },

    /** 6) isMine + isRead */
    { $addFields: { isMine: { $eq: ['$msg_sender', uid] } } },
    {
      $lookup: {
        from: 'MessageReads',
        let: { mid: '$_id' },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ['$msg_id', '$$mid'] },
                  { $eq: ['$user_id', uid] },
                ],
              },
            },
          },
          { $limit: 1 },
        ],
        as: 'readByMe',
      },
    },
    {
      $addFields: {
        isRead: {
          $or: [
            { $eq: ['$msg_sender', uid] },
            { $gt: [{ $size: '$readByMe' }, 0] },
          ],
        },
      },
    },

    /** 7) Project: thêm roomId theo rule bạn yêu cầu */
    {
      $project: {
        // ---- roomId theo điều kiện ----
        roomId: {
          $cond: [
            { $eq: ['$roomDoc.room_type', 'private'] },
            '$otherMember.id', // id hiển thị của thành viên còn lại
            '$roomDoc.room_id', // business id của room
          ],
        },

        // ---- message fields ----
        id: '$_id',
        type: '$msg_type',
        content: '$msg_content',
        createdAt: '$createdAt',
        editedAt: '$editedAt',
        deletedAt: '$deletedAt',
        pinned: '$pinned',
        // ---- denormalized ----
        sender: {
          _id: '$sender._id',
          fullname: '$sender.usr_fullname',
          avatar: '$sender.usr_avatar',
          id: '$sender.usr_id',
        },
        attachments: '$attachments',
        reactions: '$reactions',
        reply: {
          $cond: [
            { $ifNull: ['$reply_doc', false] },
            {
              _id: '$reply_doc._id',
              type: '$reply_doc.msg_type',
              content: '$reply_doc.msg_content',
              createdAt: '$reply_doc.createdAt',
              sender: {
                _id: '$reply_sender._id',
                name: '$reply_sender.usr_fullname',
              },
            },
            null,
          ],
        },

        // ---- user state ----
        isMine: '$isMine',
        isRead: '$isRead',
        hiddenByMe: '$hiddenByMe',
        hiddenAt: '$hiddenAt',
      },
    },

    /** 8) Dọn rác internal */
    { $unset: ['readByMe', 'hiddenByMeDoc', 'reply_doc', 'reply_sender'] },
  ];

  return stages;
}
