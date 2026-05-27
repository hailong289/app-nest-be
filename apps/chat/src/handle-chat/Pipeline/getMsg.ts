import Utils from '@app/helpers/utils';
import { PipelineStage } from 'mongoose';
import { firstValueFrom } from 'rxjs';
// ═══════════════════════════════════════════════════════════════════════════
// DATABASE ISOLATION NOTE:
// All $lookup stages to foreign DBs (Users, Attachments, aiembeddings,
// Quizzes, Flashcards) must be replaced with post-aggregate batch gRPC
// hydration. See CROSS_DB_LOOKUP_PLAN.md §3.1 for pseudocode.
//
// Current state: cross-DB lookups remain as-is (marked with "TODO: DB ISOLATION").
// To complete isolation, use hydrateMessages() below after aggregate.
// ═══════════════════════════════════════════════════════════════════════════



/**
 * Build a MongoDB projection expression for a quiz document stored at `$quizDoc`.
 * Converts ObjectId fields to strings and Date fields to ISO strings so they
 * serialize correctly over gRPC (QuizCore proto message).
 */
function buildQuizProjection() {
  const isoFmt = '%Y-%m-%dT%H:%M:%S.%LZ';

  const toIso = (field: string) => ({
    $dateToString: { date: field, format: isoFmt },
  });

  const toIsoIfNotNull = (field: string) => ({
    $ifNull: [{ $dateToString: { date: field, format: isoFmt } }, ''],
  });

  return {
    $cond: [
      { $ifNull: ['$quizDoc', false] },
      {
        id: { $toString: '$quizDoc._id' },
        quiz_id: '$quizDoc.quiz_id',
        quiz_title: '$quizDoc.quiz_title',
        quiz_description: '$quizDoc.quiz_description',
        quiz_roomId: { $toString: '$quizDoc.quiz_roomId' },
        quiz_createdBy: { $toString: '$quizDoc.quiz_createdBy' },
        quiz_questions: {
          $map: {
            input: { $ifNull: ['$quizDoc.quiz_questions', []] },
            as: 'q',
            in: {
              question_text: '$$q.question_text',
              question_type: '$$q.question_type',
              answers: {
                $map: {
                  input: { $ifNull: ['$$q.answers', []] },
                  as: 'a',
                  in: {
                    answer_text: '$$a.answer_text',
                    is_correct: '$$a.is_correct',
                    points: '$$a.points',
                  },
                },
              },
              points: '$$q.points',
              order: '$$q.order',
              explanation: '$$q.explanation',
              image_url: '$$q.image_url',
            },
          },
        },
        quiz_status: '$quizDoc.quiz_status',
        quiz_timeLimit: '$quizDoc.quiz_timeLimit',
        quiz_startTime: toIsoIfNotNull('$quizDoc.quiz_startTime'),
        quiz_endTime: toIsoIfNotNull('$quizDoc.quiz_endTime'),
        quiz_showResults: '$quizDoc.quiz_showResults',
        quiz_allowRetake: '$quizDoc.quiz_allowRetake',
        quiz_maxAttempts: '$quizDoc.quiz_maxAttempts',
        quiz_results: {
          $map: {
            input: { $ifNull: ['$quizDoc.quiz_results', []] },
            as: 'r',
            in: {
              user_id: { $toString: '$$r.user_id' },
              user_answers: {
                $map: {
                  input: { $ifNull: ['$$r.user_answers', []] },
                  as: 'ua',
                  in: {
                    question_index: '$$ua.question_index',
                    selected_answer_indices: '$$ua.selected_answer_indices',
                    text_answer: '$$ua.text_answer',
                    is_correct: '$$ua.is_correct',
                    points_earned: '$$ua.points_earned',
                    answered_at: toIso('$$ua.answered_at'),
                  },
                },
              },
              total_score: '$$r.total_score',
              max_score: '$$r.max_score',
              correct_count: '$$r.correct_count',
              total_questions: '$$r.total_questions',
              started_at: toIso('$$r.started_at'),
              completed_at: toIsoIfNotNull('$$r.completed_at'),
              time_taken: '$$r.time_taken',
              is_completed: '$$r.is_completed',
              is_submitted: '$$r.is_submitted',
            },
          },
        },
        quiz_totalParticipants: '$quizDoc.quiz_totalParticipants',
        quiz_totalSubmissions: '$quizDoc.quiz_totalSubmissions',
        quiz_image: '$quizDoc.quiz_image',
        createdAt: toIso('$quizDoc.createdAt'),
        updatedAt: toIso('$quizDoc.updatedAt'),
      },
      null,
    ],
  };
}

/**
 * Build a MongoDB projection expression for a flashcard document stored at `$flashcardDoc`.
 * Converts ObjectId fields to strings and Date fields to ISO strings.
 */
function buildFlashcardProjection() {
  const isoFmt = '%Y-%m-%dT%H:%M:%S.%LZ';

  const toIso = (field: string) => ({
    $dateToString: { date: field, format: isoFmt },
  });

  const toIsoIfNotNull = (field: string) => ({
    $ifNull: [{ $dateToString: { date: field, format: isoFmt } }, ''],
  });

  return {
    $cond: [
      { $ifNull: ['$flashcardDoc', false] },
      {
        id: { $toString: '$flashcardDoc._id' },
        card_id: '$flashcardDoc.card_id',
        card_userId: { $toString: '$flashcardDoc.card_userId' },
        card_deckId: {
          $ifNull: [{ $toString: '$flashcardDoc.card_deckId' }, ''],
        },
        card_front: '$flashcardDoc.card_front',
        card_back: '$flashcardDoc.card_back',
        card_hint: '$flashcardDoc.card_hint',
        card_tags: { $ifNull: ['$flashcardDoc.card_tags', []] },
        card_image: '$flashcardDoc.card_image',
        card_audio: '$flashcardDoc.card_audio',
        card_difficulty: { $ifNull: ['$flashcardDoc.card_difficulty', 0] },
        card_totalViews: { $ifNull: ['$flashcardDoc.card_totalViews', 0] },
        card_totalReviews: { $ifNull: ['$flashcardDoc.card_totalReviews', 0] },
        card_isPublic: { $ifNull: ['$flashcardDoc.card_isPublic', false] },
        card_isArchived: { $ifNull: ['$flashcardDoc.card_isArchived', false] },
        createdAt: toIso('$flashcardDoc.createdAt'),
        updatedAt: toIsoIfNotNull('$flashcardDoc.updatedAt'),
      },
      null,
    ],
  };
}

/**
 * Build a MongoDB projection expression for a todo project document stored at `$todoProjectDoc`.
 * Converts ObjectId fields to strings and maps nested project_statuses to the proto format.
 */
function buildTodoProjectProjection() {
  const isoFmt = '%Y-%m-%dT%H:%M:%S.%LZ';

  const toIso = (field: string) => ({
    $dateToString: { date: field, format: isoFmt },
  });

  const toIsoIfNotNull = (field: string) => ({
    $ifNull: [{ $dateToString: { date: field, format: isoFmt } }, ''],
  });

  return {
    $cond: [
      { $ifNull: ['$todoProjectDoc', false] },
      {
        project_id: '$todoProjectDoc.project_id',
        project_name: '$todoProjectDoc.project_name',
        project_description: '$todoProjectDoc.project_description',
        project_color: '$todoProjectDoc.project_color',
        project_createdBy: {
          $ifNull: [{ $toString: '$todoProjectDoc.project_createdBy' }, ''],
        },
        project_roomId: {
          $ifNull: [{ $toString: '$todoProjectDoc.project_roomId' }, ''],
        },
        is_default: { $ifNull: ['$todoProjectDoc.is_default', false] },
        project_statuses: {
          $map: {
            input: { $ifNull: ['$todoProjectDoc.project_statuses', []] },
            as: 's',
            in: {
              status_id: { $ifNull: ['$$s.status_id', ''] },
              status_name: { $ifNull: ['$$s.status_name', ''] },
              status_color: { $ifNull: ['$$s.status_color', ''] },
              status_order: { $ifNull: ['$$s.status_order', 0] },
            },
          },
        },
        createdAt: toIso('$todoProjectDoc.createdAt'),
        updatedAt: toIsoIfNotNull('$todoProjectDoc.updatedAt'),
        project_members: {
          $map: {
            input: { $ifNull: ['$todoProjectDoc.project_members', []] },
            as: 'm',
            in: { $ifNull: [{ $toString: '$$m' }, ''] },
          },
        },
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
        // Raw IDs — hydrateMessages replaces with populated user objects
        actor: { $ifNull: [{ $toString: '$roomEventDoc.actor_id' }, null] },
        targets: {
          $map: {
            input: { $ifNull: ['$roomEventDoc.targets', []] },
            as: 't',
            in: { $toString: '$$t' },
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

    /** 1) Sender — DB ISOLATION: raw msg_sender, hydrated via gRPC */
    {
      $addFields: {
        sender: { $toString: '$msg_sender' },
      },
    },

    /** * 2) Attachments — DB ISOLATION: raw attachment_ids, hydrated via gRPC */
    {
      $addFields: {
        attachments: {
          $map: {
            input: { $ifNull: ['$attachment_ids', []] },
            as: 'a',
            in: { $toString: '$$a' },
          },
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

    /** 4) Reactions (group theo emoji) — DB ISOLATION: user IDs hydrated via gRPC */
    {
      $lookup: {
        from: 'MessageReactions',
        localField: '_id',
        foreignField: 'msg_id',
        pipeline: [
          {
            $group: {
              _id: '$emoji',
              users: { $push: { $toString: '$user_id' } },
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

    /** 6.1) Read list (toàn bộ ai đã đọc message này) */
    {
      $lookup: {
        from: 'MessageReads',
        let: { mid: '$_id', sender: '$msg_sender' },
        pipeline: [
          { $match: { $expr: { $eq: ['$msg_id', '$$mid'] } } },
          { $match: { $expr: { $ne: ['$user_id', '$$sender'] } } },
          {
            $project: {
              _id: 0,
              readAt: 1,
              user_id: { $toString: '$user_id' },
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

        // denormalized — hydrated via gRPC
        sender: '$sender',
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
              // DB ISOLATION: raw msg_sender — hydrateMessages fills in
              sender: { $ifNull: [{ $toString: '$reply_doc.msg_sender' }, null] },
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
        // DB ISOLATION: raw IDs — hydrateMessages fills in full documents
        quiz: { $ifNull: [{ $toString: '$quiz_id' }, null] },
        flashcard: { $ifNull: [{ $toString: '$flashcard_id' }, null] },
        todoProject: { $ifNull: [{ $toString: '$todo_project_id' }, null] },
        // System message context (member added/left, call started/ended, ...)
        room_event: buildRoomEventProjection(),
        summary: { $literal: null },
      },
    },

    /** 8) Cleanup */
    {
      $unset: [
        'hiddenByDocs',
        'reply_doc',
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

    /** 1) Sender — DB ISOLATION: raw msg_sender, hydrated via gRPC */
    {
      $addFields: {
        sender: { $toString: '$msg_sender' },
      },
    },

    /** 2) Attachments — DB ISOLATION: raw attachment_ids, hydrated via gRPC */
    {
      $addFields: {
        attachments: {
          $map: {
            input: { $ifNull: ['$attachment_ids', []] },
            as: 'a',
            in: { $toString: '$$a' },
          },
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

    /** 4) Reactions (group theo emoji) — DB ISOLATION: user IDs hydrated via gRPC */
    {
      $lookup: {
        from: 'MessageReactions',
        localField: '_id',
        foreignField: 'msg_id',
        pipeline: [
          {
            $group: {
              _id: '$emoji',
              users: { $push: { $toString: '$user_id' } },
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
            $project: {
              _id: 0,
              readAt: 1,
              user_id: { $toString: '$user_id' },
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

        // denormalized — hydrated via gRPC
        sender: '$sender',
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
              // DB ISOLATION: raw msg_sender — hydrateMessages fills in
              sender: { $ifNull: [{ $toString: '$reply_doc.msg_sender' }, null] },
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
        // DB ISOLATION: raw IDs — hydrateMessages fills in full documents
        quiz: { $ifNull: [{ $toString: '$quiz_id' }, null] },
        flashcard: { $ifNull: [{ $toString: '$flashcard_id' }, null] },
        todoProject: { $ifNull: [{ $toString: '$todo_project_id' }, null] },
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

    /** 1) Sender — DB ISOLATION: raw msg_sender, hydrated via gRPC */
    {
      $addFields: {
        sender: { $toString: '$msg_sender' },
      },
    },

    /** 2) Attachments — DB ISOLATION: raw attachment_ids, hydrated via gRPC */
    {
      $addFields: {
        attachments: {
          $map: {
            input: { $ifNull: ['$attachment_ids', []] },
            as: 'a',
            in: { $toString: '$$a' },
          },
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

    /** 4) Reactions (group theo emoji) — DB ISOLATION: user IDs hydrated via gRPC */
    {
      $lookup: {
        from: 'MessageReactions',
        localField: '_id',
        foreignField: 'msg_id',
        pipeline: [
          {
            $group: {
              _id: '$emoji',
              users: { $push: { $toString: '$user_id' } },
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
            $project: {
              _id: 0,
              readAt: 1,
              user_id: { $toString: '$user_id' },
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

        // denormalized — hydrated via gRPC
        sender: '$sender',
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
              // DB ISOLATION: raw msg_sender — hydrateMessages fills in
              sender: { $ifNull: [{ $toString: '$reply_doc.msg_sender' }, null] },
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
        // DB ISOLATION: raw IDs — hydrateMessages fills in full documents
        quiz: { $ifNull: [{ $toString: '$quiz_id' }, null] },
        flashcard: { $ifNull: [{ $toString: '$flashcard_id' }, null] },
        todoProject: { $ifNull: [{ $toString: '$todo_project_id' }, null] },
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
        'replyHiddenByDocs',
        'reply_hiddenBy',
        'read_list',
      ],
    },
  ];

  return stages;
}

// ── Hydration interfaces ───────────────────────────────────────────────────

export interface AuthGrpcClient {
  GetUserById(data: { userId: string }): any;
  GetUsersByIds(data: { userIds: string[] }): any;
}

export interface FileSystemGrpcClient {
  GetAttachmentsByIds(data: { attachmentIds: string[] }): any;
}

export interface AIGrpcClient {
  GetEmbeddingsByContextIds(data: { contextIds: string[] }): any;
}

export interface LearningGrpcClient {
  GetQuizzesByIds(data: { quizIds: string[] }): any;
  GetFlashcardsByIds(data: { flashcardIds: string[] }): any;
  GetTodoProjectsByIds(data: { todoProjectIds: string[] }): any;
}

export interface HydrationServices {
  authGrpc: AuthGrpcClient;
  filesystemGrpc: FileSystemGrpcClient;
  aiGrpc: AIGrpcClient;
  learningGrpc: LearningGrpcClient;
}

/**
 * Project a user from the auth gRPC response into the format expected by the FE.
 */
function projectUser(u: any): any | null {
  if (!u) return null;
  return {
    _id: u._id,
    id: u.id ?? u.usr_id,
    fullname: u.fullname ?? u.usr_fullname,
    avatar: u.avatar ?? u.usr_avatar,
  };
}

/**
 * Post-aggregate hydration: replaces all raw foreign IDs (output by the
 * refactored pipelines) with fully populated objects fetched via gRPC.
 *
 * Call this on the pipeline result before returning messages to callers.
 *
 * @param messages  Raw messages from any of the three pipeline builders.
 * @param services  Map of gRPC clients keyed by service name.
 * @returns         Messages with all cross-DB references hydrated.
 */
export async function hydrateMessages(
  messages: any[],
  services: HydrationServices,
): Promise<any[]> {
  if (!messages.length) return messages;

  // ── Step 1: Collect all foreign IDs ───────────────────────────────────
  const userIds = new Set<string>();
  const attachmentIds = new Set<string>();
  const quizIds = new Set<string>();
  const flashcardIds = new Set<string>();
  const todoProjectIds = new Set<string>();

  for (const m of messages) {
    // Sender
    if (m.sender) userIds.add(String(m.sender));
    // Reply sender (raw ID in reply.sender)
    if (m.reply?.sender) userIds.add(String(m.reply.sender));
    // Reaction users — grouped by emoji, each entry has a users array of IDs
    if (Array.isArray(m.reactions)) {
      for (const r of m.reactions) {
        if (Array.isArray(r.users)) {
          for (const uid of r.users) {
            if (uid) userIds.add(String(uid));
          }
        }
      }
    }
    // Read receipt users
    if (Array.isArray(m.read_by)) {
      for (const r of m.read_by) {
        if (r.user_id) userIds.add(String(r.user_id));
      }
    }
    // RoomEvent actor + targets (raw IDs in room_event)
    if (m.room_event) {
      if (m.room_event.actor) userIds.add(String(m.room_event.actor));
      if (Array.isArray(m.room_event.targets)) {
        for (const t of m.room_event.targets) {
          if (t) userIds.add(String(t));
        }
      }
    }
    // Attachment IDs
    if (Array.isArray(m.attachments)) {
      for (const attId of m.attachments) {
        if (attId) attachmentIds.add(String(attId));
      }
    }
    // Cross-service document IDs
    if (m.quiz) quizIds.add(String(m.quiz));
    if (m.flashcard) flashcardIds.add(String(m.flashcard));
    if (m.todoProject) todoProjectIds.add(String(m.todoProject));
  }

  // ── Step 2: Batch gRPC calls in parallel ──────────────────────────────
  const [usersRes, attachmentsRes, quizzesRes, flashcardsRes, todoProjectsRes] =
    await Promise.all([
      userIds.size > 0
        ? firstValueFrom(
            services.authGrpc.GetUsersByIds({ userIds: [...userIds] }),
          ).catch(() => null)
        : Promise.resolve(null),
      attachmentIds.size > 0
        ? firstValueFrom(
            services.filesystemGrpc.GetAttachmentsByIds({
              attachmentIds: [...attachmentIds],
            }),
          ).catch(() => null)
        : Promise.resolve(null),
      quizIds.size > 0
        ? firstValueFrom(
            services.learningGrpc.GetQuizzesByIds({ quizIds: [...quizIds] }),
          ).catch(() => null)
        : Promise.resolve(null),
      flashcardIds.size > 0
        ? firstValueFrom(
            services.learningGrpc.GetFlashcardsByIds({
              flashcardIds: [...flashcardIds],
            }),
          ).catch(() => null)
        : Promise.resolve(null),
      todoProjectIds.size > 0
        ? firstValueFrom(
            services.learningGrpc.GetTodoProjectsByIds({
              todoProjectIds: [...todoProjectIds],
            }),
          ).catch(() => null)
        : Promise.resolve(null),
    ]);

  // ── Step 3: Get AI embeddings for attachments (second round-trip) ─────
  const atts: any[] = (attachmentsRes as any)?.metadata ?? [];
  const embeddingIds = atts.map((a: any) => String(a._id ?? a.id));
  const embeddingsRes =
    embeddingIds.length > 0
      ? await firstValueFrom(
          services.aiGrpc.GetEmbeddingsByContextIds({
            contextIds: embeddingIds,
          }),
        ).catch(() => null)
      : null;
  const embeddings: any[] = (embeddingsRes as any)?.metadata ?? [];

  // ── Step 4: Build lookup maps ─────────────────────────────────────────
  const userMap = new Map<string, any>();
  for (const u of (usersRes as any)?.metadata ?? []) {
    userMap.set(String(u._id), u);
  }

  const attMap = new Map<string, any>();
  for (const a of atts) {
    attMap.set(String(a._id ?? a.id), a);
  }

  const quizMap = new Map<string, any>();
  for (const q of (quizzesRes as any)?.metadata ?? []) {
    for (const key of [q._id, q.id, q.quiz_id]) {
      if (key) quizMap.set(String(key), q);
    }
  }

  const flashcardMap = new Map<string, any>();
  for (const f of (flashcardsRes as any)?.metadata ?? []) {
    for (const key of [f._id, f.id, f.card_id]) {
      if (key) flashcardMap.set(String(key), f);
    }
  }

  const todoProjectMap = new Map<string, any>();
  for (const t of (todoProjectsRes as any)?.metadata ?? []) {
    for (const key of [t.id, t._id, t.project_id]) {
      if (key) todoProjectMap.set(String(key), t);
    }
  }

  // Index embeddings by contextId
  const embeddingMap = new Map<string, any[]>();
  for (const e of embeddings) {
    const key = String(e.contextId ?? e.context_id);
    if (!embeddingMap.has(key)) embeddingMap.set(key, []);
    embeddingMap.get(key)!.push(e);
  }

  // ── Step 5: Merge into messages ───────────────────────────────────────
  return messages.map((m) => ({
    ...m,
    // Replace raw sender ID with populated user object
    sender: projectUser(userMap.get(String(m.sender))),
    // Replace raw reaction user IDs with populated user objects
    reactions: Array.isArray(m.reactions)
      ? m.reactions.map((r: any) => ({
          ...r,
          users: (r.users || [])
            .map((uid: any) => projectUser(userMap.get(String(uid))))
            .filter(Boolean),
        }))
      : m.reactions,
    // Replace raw reply sender ID with populated user
    reply: m.reply
      ? {
          ...m.reply,
          sender: projectUser(userMap.get(String(m.reply.sender))),
        }
      : m.reply,
    // Replace raw read_by user_id with populated user objects
    read_by: Array.isArray(m.read_by)
      ? m.read_by.map((r: any) => ({
          readAt: r.readAt,
          user: projectUser(userMap.get(String(r.user_id))),
        }))
      : m.read_by,
    // Replace raw attachment IDs with populated objects (with embeddings)
    attachments: Array.isArray(m.attachments)
      ? m.attachments
          .map((id: any) => {
            const att = attMap.get(String(id));
            if (!att) return null;
            const emb = embeddingMap.get(String(att._id ?? att.id)) ?? [];
            const summary = emb.length > 0 ? emb[0].text : null;
            return {
              _id: att._id ?? att.id,
              kind: att.kind,
              url: att.url,
              name: att.name,
              size: att.size,
              mimeType: att.mimeType,
              thumbUrl: att.thumbUrl,
              width: att.width,
              height: att.height,
              duration: att.duration,
              status: att.status,
              summary,
              embeddings: emb,
            };
          })
          .filter(Boolean)
      : m.attachments,
    // Replace raw quiz/flashcard/todo IDs with full documents
    quiz: m.quiz ? quizMap.get(String(m.quiz)) ?? null : null,
    flashcard: m.flashcard ? flashcardMap.get(String(m.flashcard)) ?? null : null,
    todoProject: m.todoProject
      ? todoProjectMap.get(String(m.todoProject)) ?? null
      : null,
    // Replace raw room_event actor/targets with populated users
    room_event: m.room_event
      ? {
          ...m.room_event,
          actor: m.room_event.actor
            ? projectUser(userMap.get(String(m.room_event.actor)))
            : null,
          targets: Array.isArray(m.room_event.targets)
            ? m.room_event.targets
                .map((t: any) => projectUser(userMap.get(String(t))))
                .filter(Boolean)
            : m.room_event.targets,
        }
      : m.room_event,
  }));
}
