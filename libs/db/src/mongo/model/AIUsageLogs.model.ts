// apps/moderation/src/schemas/ai-usage-log.schema.ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type AIUsageLogDocument = HydratedDocument<AIUsageLog>;

@Schema({ timestamps: true })
export class AIUsageLog {
  @Prop({ required: true })
  service: string; // 'moderation' | 'summarization' | 'translation' | 'stt' | 'ocr' | 'recommendation' ...

  @Prop({ required: true, default: 'google' })
  provider: string; // 'google' | 'openai' | 'anthropic' | 'local'

  @Prop({ required: true })
  model: string; // 'gemini-2.5-flash' | 'omni-moderation-latest' | 'text-bison-002'

  @Prop({ required: true })
  userId: string; // ai gọi từ user nào (hoặc system)

  @Prop() sessionId?: string; // nếu nằm trong 1 session học tập / chat

  @Prop() contextType?: string; // 'message' | 'document' | 'audio' | 'image'
  @Prop() contextId?: string; // ID thực thể (messageId, fileId, ...)

  @Prop({ type: Object })
  input: any; // dữ liệu đầu vào (có thể hash/ẩn nếu nhạy cảm)

  @Prop({ type: Object })
  output?: any; // kết quả trả về

  @Prop({ type: Object })
  metadata?: any; // custom field cho từng loại service

  // ==== Hiệu năng & chi phí ====
  @Prop() tokenInput?: number;
  @Prop() tokenOutput?: number;
  @Prop() latencyMs?: number;
  @Prop() costUsd?: number;

  // ==== Trạng thái ====
  @Prop({ default: 'success' })
  status: 'success' | 'error';

  @Prop() error?: string;
}

export const AIUsageLogSchema = SchemaFactory.createForClass(AIUsageLog);

AIUsageLogSchema.index({ service: 1, createdAt: -1 });
AIUsageLogSchema.index({ userId: 1, createdAt: -1 });

export default {
  name: 'AIUsageLogs',
  schema: AIUsageLogSchema,
};
