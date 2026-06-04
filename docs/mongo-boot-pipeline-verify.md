# MongoDB boot pipeline verification

Run in `mongosh` against the dev database after deploying the CPU optimizations.

## GET /api/chat/rooms (two-phase, no search)

```javascript
// Phase A — should use RoomsState index, no MessageHides per room
db.Rooms.aggregate([
  { $match: { 'room_members.user_id': ObjectId('USER_OID') } },
  { $lookup: { from: 'RoomsState', localField: '_id', foreignField: 'room_id', as: 'state' } },
  { $set: { state: { $first: '$state' } } },
  { $addFields: { _lastTs: { $ifNull: ['$state.last_message_snapshot.createdAt', '$updatedAt'] } } },
  { $sort: { _lastTs: -1 } },
  { $skip: 0 },
  { $limit: 20 },
  { $project: { _id: 1 } },
]).explain('executionStats');
```

Expect `totalDocsExamined` close to member room count for phase A, not multiplied by lookup fan-out.

## GET /api/chat/messages (limit-first + delta pipeline)

```javascript
db.Messages.aggregate([
  { $match: { msg_roomId: ObjectId('ROOM_OID'), _id: { $gt: ObjectId('MSG_OID') } } },
  { $sort: { createdAt: -1 } },
  { $limit: 50 },
  { $project: { _id: 1 } },
]).explain('executionStats');
```

Enrich stage should run on at most 50 documents.

## GET /api/notifications

```javascript
db.Notifications.find({ noti_userId: ObjectId('USER_OID') })
  .sort({ createdAt: -1 })
  .skip(0)
  .limit(50)
  .explain('executionStats');
```

Index `{ noti_userId: 1, createdAt: -1 }` should appear in the winning plan.

## GET /api/social/users/friends ($facet)

```javascript
// Single aggregation with $facet — one pipeline, not two full scans
```

Compare `executionStats.totalDocsExamined` before/after on a user with many friends.
