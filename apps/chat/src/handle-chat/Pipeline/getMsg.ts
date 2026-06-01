import Utils from '@app/helpers/utils';
import { PipelineStage } from 'mongoose';

function buildQuizProjection() {
  return {
    $cond: [
      { $ifNull: ['$quiz_id', false] },
      {
        id: { $toString: '$quiz_id' },
        quiz_id: { $toString: '$quiz_id' },
      },
      null,
    ],
  };
}

function buildFlashcardDeckProjection() {
  return {
    $cond: [
      { $ifNull: ['$desk_id', false] },
      {
        id: { $toString: '$desk_id' },
        deck_id: { $toString: '$desk_id' },
      },
      null,
    ],
  };
}

function buildTodoProjectProjection() {
  return {
    $cond: [
      { $ifNull: ['$todo_project_id', false] },
      {
        project_id: { $toString: '$todo_project_id' },
      },
      null,
    ],
  };
}

/**
 * Stages that hydrate a system message with its RoomEvent + denormalized
 * actor / target user info. Use right before the final `$project` of any
 * message pipeline (Core / Detail / MultipleDetail).
 *
 * Output fields added:
 *   - $roomEventDoc:  the RoomEvent document (or null)
 *   - $roomEventActor: actor user (slim: _id, fullname, avatar, usr_id)
 *   - $roomEventTargets: array of slim users for `targets`
 *
 * The downstream `$project` should expose them via `room_event` (see
 * `buildRoomEventProjection`).
 */
function roomEventLookupStages(): PipelineStage[] {
  return [
    {
      $lookup: {
        from: 'RoomEvents',
        let: { mid: '$_id' },
        pipeline: [
          { $match: { $expr: { $eq: ['$message_id', '$$mid'] } } },
          { $sort: { createdAt: -1 } },
          { $limit: 1 },
        ],
        as: 'roomEventDoc',
      },
    },
    { $addFields: { roomEventDoc: { $first: '$roomEventDoc' } } },
    {
      $lookup: {
        from: 'Users',
        localField: 'roomEventDoc.actor_id',
        foreignField: '_id',
        pipeline: [
          { $project: { _id: 1, usr_fullname: 1, usr_avatar: 1, usr_id: 1 } },
        ],
        as: 'roomEventActor',
      },
    },
    { $addFields: { roomEventActor: { $first: '$roomEventActor' } } },
    {
      $lookup: {
        from: 'Users',
        localField: 'roomEventDoc.targets',
        foreignField: '_id',
        pipeline: [
          { $project: { _id: 1, usr_fullname: 1, usr_avatar: 1, usr_id: 1 } },
        ],
        as: 'roomEventTargets',
      },
    },
  ];
}

/**
 * Projection expression for `room_event` field. Returns null when the message
 * has no linked RoomEvent (i.e. not a system message). Use inside `$project`:
 *   room_event: buildRoomEventProjection(),
 */
function buildRoomEventProjection() {
  return {
    $cond: [
      { $ifNull: ['$roomEventDoc', false] },
      {
        event_id: '$roomEventDoc.event_id',
        event_type: '$roomEventDoc.event_type',
        placeholder: '$roomEventDoc.placeholder',
        payload: '$roomEventDoc.payload',
        createdAt: '$roomEventDoc.createdAt',
        actor: {
          $cond: [
            { $ifNull: ['$roomEventActor', false] },
            {
              _id: '$roomEventActor._id',
              fullname: '$roomEventActor.usr_fullname',
              avatar: '$roomEventActor.usr_avatar',
              id: '$roomEventActor.usr_id',
            },
            null,
          ],
        },
        targets: {
          $map: {
            input: { $ifNull: ['$roomEventTargets', []] },
            as: 't',
            in: {
              _id: '$$t._id',
              fullname: '$$t.usr_fullname',
              avatar: '$$t.usr_avatar',
              id: '$$t.usr_id',
            },
          },
        },
      },
      null,
    ],
  };
}

export function buildMessageCorePipeline(userId: string): PipelineStage[] {
  const uid = Utils.convertToObjectIdMongoose(userId);

  const stages: PipelineStage[] = [
    /** 0) Map Room (room_type, room_id, room_members) */
    {
      $lookup: {
        from: 'Rooms',
        localField: 'msg_roomId',
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

    /** 0.2) My room state (clear_before_ts) */
    {
      $lookup: {
        from: 'RoomsUsersState',
        let: { rid: '$msg_roomId', uid: uid },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ['$room_id', '$$rid'] },
                  { $eq: ['$user_id', '$$uid'] },
                ],
              },
            },
          },
          { $project: { clear_before_ts: 1 } },
          { $limit: 1 },
        ],
        as: 'my_room_state',
      },
    },
    { $set: { my_room_state: { $first: '$my_room_state' } } },

    /** 0.3) Filter messages newer than clear_before_ts (if set) */
    {
      $match: {
        $expr: {
          $or: [
            { $not: ['$my_room_state.clear_before_ts'] },
            { $gt: ['$createdAt', '$my_room_state.clear_before_ts'] },
          ],
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

    /** * 2) Attachments (array ObjectId -> Attachments._id)
     * 🔥 UPDATE: Map trực tiếp Summary vào trong từng Attachment
     */
    {
      $lookup: {
        from: 'Attachments',
        localField: 'attachment_ids',
        foreignField: '_id',
        // Pipeline con để xử lý từng Attachment tìm được
        pipeline: [
          // 2.1) Lookup AI Embedding cho TỪNG attachment
          {
            $lookup: {
              from: 'aiembeddings', // Tên collection (thường Mongoose lưu thường)
              let: { attId: '$_id' }, // Biến attId là ID của Attachment hiện tại
              pipeline: [
                {
                  $match: {
                    $expr: {
                      $and: [
                        { $eq: ['$contextId', '$$attId'] }, // Map theo ID của Attachment
                        { $eq: ['$contextType', 'file'] }, // Bắt buộc type là file
                      ],
                    },
                  },
                },
                { $project: { text: 1, _id: 0 } }, // Chỉ lấy text
                { $limit: 1 }, // Lấy cái đầu tiên tìm thấy
              ],
              as: 'ai_summary_doc',
            },
          },
          // 2.2) Flatten field summary
          {
            $addFields: {
              summary: { $ifNull: [{ $first: '$ai_summary_doc.text' }, null] },
            },
          },
          // 2.3) Project output của Attachment object
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
              summary: 1, // <--- Field mới nằm ở đây
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

    /** 5.1) Reply hidden (All user) */
    {
      $lookup: {
        from: 'MessageHides',
        let: { rmid: '$reply_doc._id' },
        pipeline: [
          { $match: { $expr: { $eq: ['$msg_id', '$$rmid'] } } },
          { $project: { _id: 0, user_id: 1 } },
        ],
        as: 'replyHiddenByDocs',
      },
    },
    {
      $addFields: {
        reply_hiddenBy: {
          $map: { input: '$replyHiddenByDocs', as: 'h', in: '$$h.user_id' },
        },
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

    /** 6) Hides (All user) */
    {
      $lookup: {
        from: 'MessageHides',
        let: { mid: '$_id' },
        pipeline: [
          { $match: { $expr: { $eq: ['$msg_id', '$$mid'] } } },
          { $project: { _id: 0, user_id: 1 } },
        ],
        as: 'hiddenByDocs',
      },
    },
    {
      $addFields: {
        hiddenBy: {
          $map: { input: '$hiddenByDocs', as: 'h', in: '$$h.user_id' },
        },
      },
    },

    /** 6.1) 🔥 Read list (toàn bộ ai đã đọc message này) */
    {
      $lookup: {
        from: 'MessageReads',
        let: { mid: '$_id', sender: '$msg_sender' },
        pipeline: [
          { $match: { $expr: { $eq: ['$msg_id', '$$mid'] } } },
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
            },
          },
        ],
        as: 'read_list',
      },
    },

    /** 6.2) Call history */
    {
      $lookup: {
        from: 'CallHistories',
        localField: '_id',
        foreignField: 'message_id',
        pipeline: [{ $sort: { createdAt: -1 } }, { $limit: 1 }],
        as: 'callHistoryDoc',
      },
    },
    {
      $addFields: {
        callHistoryDoc: { $first: '$callHistoryDoc' },
      },
    },

    /** 7.2) Room event (for system messages) */
    ...roomEventLookupStages(),

    /** 7) Project */
    {
      $project: {
        roomId: {
          $cond: [
            { $eq: ['$roomDoc.room_type', 'private'] },
            '$otherMember.id',
            '$roomDoc.room_id',
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
        placeholder: '$placeholder',

        // denormalized
        sender: {
          _id: '$sender._id',
          fullname: '$sender.usr_fullname',
          avatar: '$sender.usr_avatar',
          id: '$sender.usr_id',
        },
        // 🔥 attachments bây giờ đã có field 'summary' bên trong từng item
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
              isDelete: {
                $cond: [
                  { $ifNull: ['$reply_doc', false] },
                  { $toBool: '$reply_doc.deletedAt' },
                  false,
                ],
              },
              hiddenBy: {
                $cond: [
                  { $ifNull: ['$reply_doc', false] },
                  '$reply_hiddenBy',
                  [],
                ],
              },
            },
            null,
          ],
        },

        // user state
        hiddenBy: '$hiddenBy',
        documentId: '$document_id',

        // read list
        read_by: '$read_list',
        read_by_count: { $size: '$read_list' },
        call_history: '$callHistoryDoc',
        quiz: buildQuizProjection(),
        desk: buildFlashcardDeckProjection(),
        todoProject: buildTodoProjectProjection(),
        // System message context (member added/left, call started/ended, ...)
        room_event: buildRoomEventProjection(),
        // Summary cấp độ message để null, vì giờ dùng summary của attachment
        summary: { $literal: null },
      },
    },

    /** 8) Cleanup */
    {
      $unset: [
        'hiddenByDocs',
        'reply_doc',
        'reply_sender',
        'replyHiddenByDocs',
        'reply_hiddenBy',
        'read_list',
        'my_room_state',
      ],
    },
  ];

  return stages;
}

export function buildMessageDetailPipeline(msgId: string): PipelineStage[] {
  // 1. Convert msgId sang ObjectId
  const mid = Utils.convertToObjectIdMongoose(msgId);

  const stages: PipelineStage[] = [
    /** 0) Match đúng cái Message ID cần lấy */
    { $match: { _id: mid } },

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

    /** 2) Attachments (array ObjectId -> Attachments._id) + AI Summary */
    {
      $lookup: {
        from: 'Attachments',
        localField: 'attachment_ids',
        foreignField: '_id',
        pipeline: [
          // 2.1) Lookup AI Embedding
          {
            $lookup: {
              from: 'aiembeddings',
              let: { attId: '$_id' },
              pipeline: [
                {
                  $match: {
                    $expr: {
                      $and: [
                        { $eq: ['$contextId', '$$attId'] },
                        { $eq: ['$contextType', 'file'] },
                      ],
                    },
                  },
                },
                { $project: { text: 1, _id: 0 } },
                { $limit: 1 },
              ],
              as: 'ai_summary_doc',
            },
          },
          // 2.2) Flatten summary
          {
            $addFields: {
              summary: { $ifNull: [{ $first: '$ai_summary_doc.text' }, null] },
            },
          },
          // 2.3) Project output attachment
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
              summary: 1,
            },
          },
        ],
        as: 'attachments',
      },
    },
    {
      $addFields: {
        attachments: { $ifNull: ['$attachments', []] },
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

    /** 3.1) Reply hidden (All users) */
    {
      $lookup: {
        from: 'MessageHides',
        let: { rmid: '$reply_doc._id' },
        pipeline: [
          { $match: { $expr: { $eq: ['$msg_id', '$$rmid'] } } },
          { $project: { _id: 0, user_id: 1 } },
        ],
        as: 'replyHiddenByDocs',
      },
    },
    {
      $addFields: {
        reply_hiddenBy: {
          $map: { input: '$replyHiddenByDocs', as: 'h', in: '$$h.user_id' },
        },
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

    /** 5) Hides (All users who hid THIS message) */
    {
      $lookup: {
        from: 'MessageHides',
        let: { mid: '$_id' },
        pipeline: [
          { $match: { $expr: { $eq: ['$msg_id', '$$mid'] } } },
          { $project: { _id: 0, user_id: 1 } },
        ],
        as: 'hiddenByDocs',
      },
    },
    {
      $addFields: {
        hiddenBy: {
          $map: { input: '$hiddenByDocs', as: 'h', in: '$$h.user_id' },
        },
      },
    },

    /** 6) Read list */
    {
      $lookup: {
        from: 'MessageReads',
        let: { mid: '$_id', sender: '$msg_sender' },
        pipeline: [
          { $match: { $expr: { $eq: ['$msg_id', '$$mid'] } } },
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
            },
          },
        ],
        as: 'read_list',
      },
    },

    /** 7) Call history */
    {
      $lookup: {
        from: 'CallHistories',
        localField: '_id',
        foreignField: 'message_id',
        pipeline: [{ $sort: { createdAt: -1 } }, { $limit: 1 }],
        as: 'callHistoryDoc',
      },
    },
    {
      $addFields: {
        callHistoryDoc: { $first: '$callHistoryDoc' },
      },
    },

    /** 7.2) Room event (for system messages) */
    ...roomEventLookupStages(),

    /** 8) Project Final */
    {
      $project: {
        // 🔥 UPDATE: Vì đã bỏ roomDoc, nên lấy thẳng msg_roomId
        roomId: '$msg_roomId',

        // message fields
        id: '$_id',
        type: '$msg_type',
        content: '$msg_content',
        createdAt: '$createdAt',
        editedAt: '$editedAt',
        deletedAt: '$deletedAt',
        isDeleted: { $toBool: '$deletedAt' },
        pinned: '$pinned',
        placeholder: '$placeholder',

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
              isDelete: {
                $cond: [
                  { $ifNull: ['$reply_doc', false] },
                  { $toBool: '$reply_doc.deletedAt' },
                  false,
                ],
              },
              hiddenBy: {
                $cond: [
                  { $ifNull: ['$reply_doc', false] },
                  '$reply_hiddenBy',
                  [],
                ],
              },
            },
            null,
          ],
        },

        // user state
        hiddenBy: '$hiddenBy',
        documentId: '$document_id',

        // read list
        read_by: '$read_list',
        read_by_count: { $size: '$read_list' },
        call_history: '$callHistoryDoc',
        quiz: buildQuizProjection(),
        desk: buildFlashcardDeckProjection(),
        todoProject: buildTodoProjectProjection(),
        // System message context (member added/left, call started/ended, ...)
        room_event: buildRoomEventProjection(),
        summary: { $literal: null },
      },
    },

    /** 9) Cleanup */
    {
      $unset: [
        'hiddenByDocs',
        'reply_doc',
        'reply_sender',
        'replyHiddenByDocs',
        'reply_hiddenBy',
        'read_list',
      ],
    },
  ];

  return stages;
}

export function buildMessagesDetailPipeline(msgIds: string[]): PipelineStage[] {
  // 1. Convert msgId sang ObjectId
  const mids = msgIds.map((id) => Utils.convertToObjectIdMongoose(id));

  const stages: PipelineStage[] = [
    /** 0) Match đúng cái Message ID cần lấy */
    { $match: { _id: { $in: mids } } },

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

    /** 2) Attachments (array ObjectId -> Attachments._id) + AI Summary */
    {
      $lookup: {
        from: 'Attachments',
        localField: 'attachment_ids',
        foreignField: '_id',
        pipeline: [
          // 2.1) Lookup AI Embedding
          {
            $lookup: {
              from: 'aiembeddings',
              let: { attId: '$_id' },
              pipeline: [
                {
                  $match: {
                    $expr: {
                      $and: [
                        { $eq: ['$contextId', '$$attId'] },
                        { $eq: ['$contextType', 'file'] },
                      ],
                    },
                  },
                },
                { $project: { text: 1, _id: 0 } },
                { $limit: 1 },
              ],
              as: 'ai_summary_doc',
            },
          },
          // 2.2) Flatten summary
          {
            $addFields: {
              summary: { $ifNull: [{ $first: '$ai_summary_doc.text' }, null] },
            },
          },
          // 2.3) Project output attachment
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
              summary: 1,
            },
          },
        ],
        as: 'attachments',
      },
    },
    {
      $addFields: {
        attachments: { $ifNull: ['$attachments', []] },
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

    /** 3.1) Reply hidden (All users) */
    {
      $lookup: {
        from: 'MessageHides',
        let: { rmid: '$reply_doc._id' },
        pipeline: [
          { $match: { $expr: { $eq: ['$msg_id', '$$rmid'] } } },
          { $project: { _id: 0, user_id: 1 } },
        ],
        as: 'replyHiddenByDocs',
      },
    },
    {
      $addFields: {
        reply_hiddenBy: {
          $map: { input: '$replyHiddenByDocs', as: 'h', in: '$$h.user_id' },
        },
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

    /** 5) Hides (All users who hid THIS message) */
    {
      $lookup: {
        from: 'MessageHides',
        let: { mid: '$_id' },
        pipeline: [
          { $match: { $expr: { $eq: ['$msg_id', '$$mid'] } } },
          { $project: { _id: 0, user_id: 1 } },
        ],
        as: 'hiddenByDocs',
      },
    },
    {
      $addFields: {
        hiddenBy: {
          $map: { input: '$hiddenByDocs', as: 'h', in: '$$h.user_id' },
        },
      },
    },

    /** 6) Read list */
    {
      $lookup: {
        from: 'MessageReads',
        let: { mid: '$_id', sender: '$msg_sender' },
        pipeline: [
          { $match: { $expr: { $eq: ['$msg_id', '$$mid'] } } },
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
            },
          },
        ],
        as: 'read_list',
      },
    },

    /** 7) Call history */
    {
      $lookup: {
        from: 'CallHistories',
        localField: '_id',
        foreignField: 'message_id',
        pipeline: [{ $sort: { createdAt: -1 } }, { $limit: 1 }],
        as: 'callHistoryDoc',
      },
    },
    {
      $addFields: {
        callHistoryDoc: { $first: '$callHistoryDoc' },
      },
    },

    /** 7.2) Room event (for system messages) */
    ...roomEventLookupStages(),

    /** 8) Project Final */
    {
      $project: {
        // 🔥 UPDATE: Vì đã bỏ roomDoc, nên lấy thẳng msg_roomId
        roomId: '$msg_roomId',

        // message fields
        id: '$_id',
        type: '$msg_type',
        content: '$msg_content',
        createdAt: '$createdAt',
        editedAt: '$editedAt',
        deletedAt: '$deletedAt',
        isDeleted: { $toBool: '$deletedAt' },
        pinned: '$pinned',
        placeholder: '$placeholder',

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
              isDelete: {
                $cond: [
                  { $ifNull: ['$reply_doc', false] },
                  { $toBool: '$reply_doc.deletedAt' },
                  false,
                ],
              },
              hiddenBy: {
                $cond: [
                  { $ifNull: ['$reply_doc', false] },
                  '$reply_hiddenBy',
                  [],
                ],
              },
            },
            null,
          ],
        },

        // user state
        hiddenBy: '$hiddenBy',
        documentId: '$document_id',

        // read list
        read_by: '$read_list',
        read_by_count: { $size: '$read_list' },
        call_history: '$callHistoryDoc',
        quiz: buildQuizProjection(),
        desk: buildFlashcardDeckProjection(),
        todoProject: buildTodoProjectProjection(),
        // System message context (member added/left, call started/ended, ...)
        room_event: buildRoomEventProjection(),
        summary: { $literal: null },
      },
    },

    /** 9) Cleanup */
    {
      $unset: [
        'hiddenByDocs',
        'reply_doc',
        'reply_sender',
        'replyHiddenByDocs',
        'reply_hiddenBy',
        'read_list',
      ],
    },
  ];

  return stages;
}
