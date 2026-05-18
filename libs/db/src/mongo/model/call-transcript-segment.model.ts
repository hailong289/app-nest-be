import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type CallTranscriptSegmentDocument =
  HydratedDocument<CallTranscriptSegment>;

@Schema({ timestamps: true, collection: 'CallTranscriptSegments' })
export class CallTranscriptSegment {
  @Prop({ type: String, required: true, index: true })
  call_id: string;

  @Prop({ type: String, required: true, index: true })
  room_id: string;

  @Prop({ type: String, required: true, index: true })
  speaker_user_id: string;

  @Prop({ type: String, required: true, unique: true })
  segment_id: string;

  @Prop({ type: String, required: true })
  text: string;

  @Prop({ type: String, default: '' })
  translated_text?: string;

  @Prop({ type: String, default: '' })
  source_language?: string;

  @Prop({ type: String, default: '' })
  target_language?: string;

  @Prop({ type: Date, required: true })
  started_at: Date;

  @Prop({ type: Date, required: true })
  ended_at: Date;

  createdAt?: Date;
  updatedAt?: Date;
}

export const CallTranscriptSegmentSchema = SchemaFactory.createForClass(
  CallTranscriptSegment,
);

CallTranscriptSegmentSchema.index({ call_id: 1, started_at: 1 });
CallTranscriptSegmentSchema.index({ room_id: 1, call_id: 1 });
CallTranscriptSegmentSchema.index(
  { call_id: 1, segment_id: 1 },
  { unique: true },
);

export default {
  name: 'CallTranscriptSegment',
  schema: CallTranscriptSegmentSchema,
};
