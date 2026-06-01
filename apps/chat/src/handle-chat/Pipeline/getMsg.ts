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
        id: { $toString: '$todo_project_id' },
        project_id: { $toString: '$todo_project_id' },
      },
      null,
    ],
  };
}

function memberSummary(memberPath: string, fallbackIdPath: string) {
  return {
    _id: {
      $toString: {
        $ifNull: [`$${memberPath}.user_id`, `$${fallbackIdPath}`],
      },
    },
    fullname: { $ifNull: [`$${memberPath}.name`, ''] },
    avatar: { $ifNull: [`$${memberPath}.avatar`, ''] },
    id: { $ifNull: [`$${memberPath}.id`, ''] },
  };
}

function attachmentIdProjection() {
  return {
    $map: {
      input: { $ifNull: ['$attachment_ids', []] },
      as: 'attachmentId',
      in: {
        _id: { $toString: '$$attachmentId' },
        url: '',
        name: '',
        size: 0,
        mimeType: '',
        thumb_url: '',
        width: 0,
        height: 0,
        status: '',
        kind: '',
        summary: '',
      },
    },
  };
}

function roomLookupStages(userId?: string): PipelineStage[] {
  const stages: PipelineStage[] = [
    {
      $lookup: {
        from: 'Rooms',
        localField: 'msg_roomId',
        foreignField: '_id',
        as: 'roomDoc',
      },
    },
    { $set: { roomDoc: { $first: '$roomDoc' } } },
  ];

  if (userId) {
    const uid = Utils.convertToObjectIdMongoose(userId);
    stages.push(
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
      {
        $lookup: {
          from: 'RoomsUsersState',
          let: { rid: '$msg_roomId', uid },
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
    );
  }

  stages.push({
    $addFields: {
      senderMember: {
        $first: {
          $filter: {
            input: '$roomDoc.room_members',
            as: 'm',
            cond: { $eq: ['$$m.user_id', '$msg_sender'] },
          },
        },
      },
    },
  });

  return stages;
}

function replyStages(): PipelineStage[] {
  return [
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
      $addFields: {
        replySenderMember: {
          $first: {
            $filter: {
              input: '$roomDoc.room_members',
              as: 'm',
              cond: { $eq: ['$$m.user_id', '$reply_doc.msg_sender'] },
            },
          },
        },
      },
    },
    {
      $lookup: {
        from: 'MessageHides',
        let: { rmid: '$reply_doc._id' },
        pipeline: [
          { $match: { $expr: { $eq: ['$msg_id', '$$rmid'] } } },
          { $project: { _id: 0, user_id: { $toString: '$user_id' } } },
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
  ];
}

function reactionStages(): PipelineStage[] {
  return [
    {
      $lookup: {
        from: 'MessageReactions',
        let: { mid: '$_id', members: '$roomDoc.room_members' },
        pipeline: [
          { $match: { $expr: { $eq: ['$msg_id', '$$mid'] } } },
          {
            $addFields: {
              userMember: {
                $first: {
                  $filter: {
                    input: '$$members',
                    as: 'm',
                    cond: { $eq: ['$$m.user_id', '$user_id'] },
                  },
                },
              },
            },
          },
          {
            $group: {
              _id: '$emoji',
              users: {
                $push: {
                  _id: { $toString: '$user_id' },
                  usr_id: { $ifNull: ['$userMember.id', ''] },
                  usr_fullname: { $ifNull: ['$userMember.name', ''] },
                  usr_avatar: { $ifNull: ['$userMember.avatar', ''] },
                },
              },
              count: { $sum: 1 },
            },
          },
          { $project: { _id: 0, emoji: '$_id', count: 1, users: 1 } },
        ],
        as: 'reactions',
      },
    },
  ];
}

function stateStages(): PipelineStage[] {
  return [
    {
      $lookup: {
        from: 'MessageHides',
        let: { mid: '$_id' },
        pipeline: [
          { $match: { $expr: { $eq: ['$msg_id', '$$mid'] } } },
          { $project: { _id: 0, user_id: { $toString: '$user_id' } } },
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
    {
      $lookup: {
        from: 'MessageReads',
        let: {
          mid: '$_id',
          sender: '$msg_sender',
          members: '$roomDoc.room_members',
        },
        pipeline: [
          { $match: { $expr: { $eq: ['$msg_id', '$$mid'] } } },
          { $match: { $expr: { $ne: ['$user_id', '$$sender'] } } },
          {
            $addFields: {
              userMember: {
                $first: {
                  $filter: {
                    input: '$$members',
                    as: 'm',
                    cond: { $eq: ['$$m.user_id', '$user_id'] },
                  },
                },
              },
            },
          },
          {
            $project: {
              _id: 0,
              readAt: 1,
              user: {
                _id: { $toString: '$user_id' },
                id: { $ifNull: ['$userMember.id', ''] },
                fullname: { $ifNull: ['$userMember.name', ''] },
                avatar: { $ifNull: ['$userMember.avatar', ''] },
              },
            },
          },
        ],
        as: 'read_list',
      },
    },
  ];
}

function callHistoryStages(): PipelineStage[] {
  return [
    {
      $lookup: {
        from: 'CallHistories',
        localField: '_id',
        foreignField: 'message_id',
        pipeline: [{ $sort: { createdAt: -1 } }, { $limit: 1 }],
        as: 'callHistoryDoc',
      },
    },
    { $addFields: { callHistoryDoc: { $first: '$callHistoryDoc' } } },
  ];
}

function roomEventStages(): PipelineStage[] {
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
      $addFields: {
        roomEventActor: {
          $first: {
            $filter: {
              input: '$roomDoc.room_members',
              as: 'm',
              cond: { $eq: ['$$m.user_id', '$roomEventDoc.actor_id'] },
            },
          },
        },
        roomEventTargets: {
          $filter: {
            input: '$roomDoc.room_members',
            as: 'm',
            cond: { $in: ['$$m.user_id', { $ifNull: ['$roomEventDoc.targets', []] }] },
          },
        },
      },
    },
  ];
}

function roomEventProjection() {
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
          _id: {
            $toString: {
              $ifNull: ['$roomEventActor.user_id', '$roomEventDoc.actor_id'],
            },
          },
          id: { $ifNull: ['$roomEventActor.id', ''] },
          fullname: { $ifNull: ['$roomEventActor.name', ''] },
          avatar: { $ifNull: ['$roomEventActor.avatar', ''] },
        },
        targets: {
          $map: {
            input: { $ifNull: ['$roomEventTargets', []] },
            as: 't',
            in: {
              _id: { $toString: '$$t.user_id' },
              id: '$$t.id',
              fullname: '$$t.name',
              avatar: { $ifNull: ['$$t.avatar', ''] },
            },
          },
        },
      },
      null,
    ],
  };
}

function projectStage(userId?: string): PipelineStage {
  return {
    $project: {
      roomId: userId
        ? {
            $cond: [
              { $eq: ['$roomDoc.room_type', 'private'] },
              '$otherMember.id',
              '$roomDoc.room_id',
            ],
          }
        : '$roomDoc.room_id',
      id: '$_id',
      type: '$msg_type',
      content: '$msg_content',
      createdAt: '$createdAt',
      editedAt: '$editedAt',
      deletedAt: '$deletedAt',
      isDeleted: { $toBool: '$deletedAt' },
      pinned: '$pinned',
      placeholder: '$placeholder',
      sender: memberSummary('senderMember', 'msg_sender'),
      attachments: attachmentIdProjection(),
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
              _id: { $toString: '$reply_doc.msg_sender' },
              name: { $ifNull: ['$replySenderMember.name', ''] },
            },
            isDelete: { $toBool: '$reply_doc.deletedAt' },
            hiddenBy: '$reply_hiddenBy',
          },
          null,
        ],
      },
      hiddenBy: '$hiddenBy',
      documentId: {
        $cond: [
          { $ifNull: ['$document_id', false] },
          { $toString: '$document_id' },
          '',
        ],
      },
      read_by: '$read_list',
      read_by_count: { $size: '$read_list' },
      call_history: '$callHistoryDoc',
      quiz: buildQuizProjection(),
      desk: buildFlashcardDeckProjection(),
      todoProject: buildTodoProjectProjection(),
      room_event: roomEventProjection(),
      summary: { $literal: null },
    },
  };
}

function cleanupStage(): PipelineStage {
  return {
    $unset: [
      'roomDoc',
      'otherMember',
      'senderMember',
      'reply_doc',
      'replySenderMember',
      'replyHiddenByDocs',
      'reply_hiddenBy',
      'hiddenByDocs',
      'read_list',
      'my_room_state',
      'callHistoryDoc',
      'roomEventDoc',
      'roomEventActor',
      'roomEventTargets',
    ],
  };
}

function commonMessageStages(userId?: string): PipelineStage[] {
  return [
    ...roomLookupStages(userId),
    ...replyStages(),
    ...reactionStages(),
    ...stateStages(),
    ...callHistoryStages(),
    ...roomEventStages(),
    projectStage(userId),
    cleanupStage(),
  ];
}

export function buildMessageCorePipeline(userId: string): PipelineStage[] {
  return commonMessageStages(userId);
}

export function buildMessageDetailPipeline(msgId: string): PipelineStage[] {
  const mid = Utils.convertToObjectIdMongoose(msgId);
  return [{ $match: { _id: mid } }, ...commonMessageStages()];
}

export function buildMessagesDetailPipeline(msgIds: string[]): PipelineStage[] {
  const mids = msgIds.map((id) => Utils.convertToObjectIdMongoose(id));
  return [{ $match: { _id: { $in: mids } } }, ...commonMessageStages()];
}
