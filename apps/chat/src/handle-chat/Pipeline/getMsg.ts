import Utils from '@app/helpers/utils';
import { PipelineStage } from 'mongoose';

export function buildMessageCorePipeline(userId: string): PipelineStage[] {
  const uid = Utils.convertToObjectIdMongoose(userId);

  const stages: PipelineStage[] = [
    /** 0) Map Room (room_type, room_id, room_members) */
    {
      $lookup: {
        from: 'Rooms',
        localField: 'msg_roomId', // ObjectId -> Room._id
        foreignField: '_id',
        as: 'roomDoc',
      },
    },
    { $set: { roomDoc: { $first: '$roomDoc' } } },

    /** 0.1) otherMember (private) */
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
        pipeline: [
          { $project: { _id: 1, usr_fullname: 1, usr_avatar: 1, usr_id: 1 } },
        ],
        as: 'sender',
      },
    },
    { $set: { sender: { $first: '$sender' } } },

    /** 2) Attachments (array ObjectId -> Attachments._id) */
    {
      $lookup: {
        from: 'Attachments',
        localField: 'attachment_ids',
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
    // ✅ Ensure attachments is always an array (never null)
    {
      $addFields: {
        attachments: { $ifNull: ['$attachments', []] },
        // 🔍 DEBUG: Log attachment info
        _debug_has_attachment_ids: {
          $gt: [{ $size: { $ifNull: ['$attachment_ids', []] } }, 0],
        },
        _debug_attachment_ids_count: {
          $size: { $ifNull: ['$attachment_ids', []] },
        },
        _debug_attachments_found_count: {
          $size: { $ifNull: ['$attachments', []] },
        },
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

    /** 5.1) Reply hidden (current user) */
    {
      $lookup: {
        from: 'MessageHides',
        let: { rmid: '$reply_doc._id' },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ['$msg_id', '$$rmid'] },
                  { $eq: ['$user_id', uid] },
                ],
              },
            },
          },
          { $limit: 1 },
        ],
        as: 'replyHiddenByMeDoc',
      },
    },
    { $set: { replyHiddenByMeDoc: { $first: '$replyHiddenByMeDoc' } } },
    {
      $addFields: {
        reply_hiddenByMe: { $toBool: '$replyHiddenByMeDoc' },
      },
    },

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
                    isMine: { $eq: ['$ _id', uid] },
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

    /** 5) Hides (current user) */
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

    /** 6) isMine + isRead (current user) */
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

    /** 6.1) 🔥 Read list (toàn bộ ai đã đọc message này) */
    {
      $lookup: {
        from: 'MessageReads',
        let: { mid: '$_id', sender: '$msg_sender' }, // ✅ Truyền msg_sender vào
        pipeline: [
          { $match: { $expr: { $eq: ['$msg_id', '$$mid'] } } },
          // ✅ Loại bỏ người gửi khỏi danh sách read
          { $match: { $expr: { $ne: ['$user_id', '$$sender'] } } },
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
              as: 'u',
            },
          },
          { $set: { u: { $first: '$u' }, readAt: '$readAt' } },
          {
            $project: {
              _id: 0,
              readAt: 1,
              user: {
                _id: '$u._id',
                id: '$u.usr_id',
                fullname: '$u.usr_fullname',
                avatar: '$u.usr_avatar',
              },
              isMine: { $eq: ['$u._id', uid] },
            },
          },
        ],
        as: 'read_list',
      },
    },

    /** 7) Project (roomId theo rule bạn yêu cầu) */
    {
      $project: {
        // roomId hiển thị
        roomId: {
          $cond: [
            { $eq: ['$roomDoc.room_type', 'private'] },
            '$otherMember.id', // id hiển thị của member còn lại
            '$roomDoc.room_id', // business id chuỗi
          ],
        },

        // message fields
        id: '$_id',
        type: '$msg_type',
        content: '$msg_content',
        createdAt: '$createdAt',
        editedAt: '$editedAt',
        deletedAt: '$deletedAt',
        isDeleted: { $toBool: '$deletedAt' },
        pinned: '$pinned',

        // denormalized
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
              // isMine: whether the reply was sent by the current requesting user
              isMine: { $eq: ['$reply_doc.msg_sender', uid] },
              // whether the mapped reply message was deleted
              isDelete: {
                $cond: [
                  { $ifNull: ['$reply_doc', false] },
                  { $toBool: '$reply_doc.deletedAt' },
                  false,
                ],
              },
              // whether the mapped reply message was hidden by current user
              hiddenByMe: {
                $cond: [
                  { $ifNull: ['$reply_doc', false] },
                  '$reply_hiddenByMe',
                  false,
                ],
              },
            },
            null,
          ],
        },

        // user state
        isMine: '$isMine',
        isRead: '$isRead',
        hiddenByMe: '$hiddenByMe',
        hiddenAt: '$hiddenAt',

        // 🔥 read list + count
        read_by: '$read_list',
        read_by_count: { $size: '$read_list' },
      },
    },

    /** 8) Cleanup */
    {
      $unset: [
        'readByMe',
        'hiddenByMeDoc',
        'reply_doc',
        'reply_sender',
        'replyHiddenByMeDoc',
        'reply_hiddenByMe',
        'read_list',
      ],
    },
  ];

  return stages;
}
