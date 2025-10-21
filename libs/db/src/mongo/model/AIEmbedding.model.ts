// apps/common/schemas/ai-embedding.schema.ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type AIEmbeddingDocument = HydratedDocument<AIEmbedding>;

@Schema({ timestamps: true })
export class AIEmbedding {
  @Prop({ required: true })
  service: string; // 'moderation' | 'chat' | 'document' | 'translation' ...

  @Prop({ required: true, default: 'google' })
  provider: string; // 'google' | 'openai' | 'local'

  @Prop({ required: true })
  model: string; // ví dụ 'text-embedding-001' hoặc 'gemini-1.5-pro'

  @Prop({ required: true })
  hash: string; // hash input (để check trùng)

  @Prop({ required: true })
  text: string; // nội dung gốc

  @Prop({ type: [Number], index: '2dsphere' })
  vector: number[]; // embedding vector (có thể dài 768/1024/1536...)

  @Prop()
  userId?: string; // ai sinh ra (nếu có)

  @Prop()
  contextType?: string; // 'message' | 'document' | 'summary' ...

  @Prop()
  contextId?: string; // id thực thể (messageId, docId...)

  @Prop()
  similarity?: number; // điểm tương đồng khi query

  @Prop({ default: false })
  usedInCache?: boolean; // đã dùng để cache AI chưa

  @Prop({ default: false })
  usedInTraining?: boolean; // đã dùng trong dataset huấn luyện chưa
  metadata: any;
  _id: any;
}

export const AIEmbeddingSchema = SchemaFactory.createForClass(AIEmbedding);

export default {
  name: 'AIEmbedding',
  schema: AIEmbeddingSchema,
};
