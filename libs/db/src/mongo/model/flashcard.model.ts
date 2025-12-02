import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import Utils from 'libs/helpers/utils';

export type FlashcardDocument = HydratedDocument<Flashcard>;
export type FlashcardDeckDocument = HydratedDocument<FlashcardDeck>;
export type FlashcardProgressDocument = HydratedDocument<FlashcardProgress>;

// Subdocument: Tiến độ học của một flashcard
@Schema({ _id: false })
export class FlashcardProgress {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  user_id: Types.ObjectId; // User đang học

  @Prop({ type: Number, default: 0 })
  mastery_level: number; // Mức độ thành thạo (0-5 hoặc 0-100)

  @Prop({ type: Number, default: 0 })
  review_count: number; // Số lần đã ôn tập

  @Prop({ type: Number, default: 0 })
  correct_count: number; // Số lần trả lời đúng

  @Prop({ type: Number, default: 0 })
  incorrect_count: number; // Số lần trả lời sai

  @Prop({ type: Date, default: Date.now })
  last_reviewed: Date; // Lần cuối ôn tập

  @Prop({ type: Date, default: null })
  next_review: Date | null; // Lần ôn tập tiếp theo (theo spaced repetition)

  @Prop({ type: Boolean, default: false })
  is_mastered: boolean; // Đã thành thạo chưa

  @Prop({ type: Boolean, default: false })
  is_favorite: boolean; // Đã đánh dấu yêu thích chưa

  @Prop({
    type: String,
    enum: ['new', 'learning', 'review', 'mastered'],
    default: 'new',
  })
  status: string; // Trạng thái học
}

export const FlashcardProgressSchema =
  SchemaFactory.createForClass(FlashcardProgress);

// Main Flashcard Schema
@Schema({ timestamps: true, collection: 'Flashcards' })
export class Flashcard {
  @Prop({
    type: String,
    unique: true,
    default: () => Utils.randomId(),
    index: true,
  })
  card_id: string;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  card_userId: Types.ObjectId; // User sở hữu flashcard

  @Prop({
    type: Types.ObjectId,
    ref: 'FlashcardDeck',
    default: null,
    index: true,
  })
  card_deckId: Types.ObjectId | null; // Bộ thẻ (nếu có)

  @Prop({ type: String, required: true })
  card_front: string; // Mặt trước (câu hỏi/term)

  @Prop({ type: String, default: '' })
  card_front_norm: string; // Mặt trước đã chuẩn hóa (để search)

  @Prop({ type: String, required: true })
  card_back: string; // Mặt sau (đáp án/definition)

  @Prop({ type: String, default: '' })
  card_back_norm: string; // Mặt sau đã chuẩn hóa (để search)

  @Prop({ type: String, default: '' })
  card_hint: string; // Gợi ý (nếu có)

  @Prop({ type: [String], default: [] })
  card_tags: string[]; // Tags để phân loại

  @Prop({ type: String, default: '' })
  card_image: string; // Ảnh minh họa (nếu có)

  @Prop({ type: String, default: '' })
  card_audio: string; // File âm thanh (nếu có)

  @Prop({ type: Number, default: 0 })
  card_difficulty: number; // Độ khó (1-5)

  @Prop({ type: [FlashcardProgressSchema], default: [] })
  card_progress: FlashcardProgress[]; // Tiến độ học của các user

  @Prop({ type: Number, default: 0 })
  card_totalViews: number; // Tổng số lần xem

  @Prop({ type: Number, default: 0 })
  card_totalReviews: number; // Tổng số lần ôn tập

  @Prop({ type: Boolean, default: true })
  card_isPublic: boolean; // Có công khai không (cho phép user khác xem)

  @Prop({ type: Boolean, default: false })
  card_isArchived: boolean; // Đã lưu trữ chưa

  createdAt: Date;
  updatedAt: Date;
}

export const FlashcardSchema = SchemaFactory.createForClass(Flashcard);

// Flashcard Deck Schema (Bộ thẻ)
@Schema({ timestamps: true, collection: 'FlashcardDecks' })
export class FlashcardDeck {
  @Prop({
    type: String,
    unique: true,
    default: () => Utils.randomId(),
    index: true,
  })
  deck_id: string;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  deck_userId: Types.ObjectId; // User sở hữu bộ thẻ

  @Prop({ type: String, required: true })
  deck_name: string; // Tên bộ thẻ

  @Prop({ type: String, default: '' })
  deck_name_norm: string; // Tên đã chuẩn hóa (để search)

  @Prop({ type: String, default: '' })
  deck_description: string; // Mô tả bộ thẻ

  @Prop({ type: String, default: '' })
  deck_image: string; // Ảnh đại diện bộ thẻ

  @Prop({ type: [String], default: [] })
  deck_tags: string[]; // Tags để phân loại

  @Prop({ type: [Types.ObjectId], ref: 'Flashcard', default: [] })
  deck_cardIds: Types.ObjectId[]; // Danh sách ID các flashcard trong bộ

  @Prop({ type: Number, default: 0 })
  deck_totalCards: number; // Tổng số thẻ trong bộ

  @Prop({ type: Number, default: 0 })
  deck_totalLearners: number; // Tổng số người đang học bộ này

  @Prop({ type: Boolean, default: true })
  deck_isPublic: boolean; // Có công khai không

  @Prop({ type: Boolean, default: false })
  deck_isArchived: boolean; // Đã lưu trữ chưa

  @Prop({
    type: String,
    enum: ['beginner', 'intermediate', 'advanced', 'expert'],
    default: 'beginner',
  })
  deck_level: string; // Mức độ (beginner, intermediate, advanced, expert)

  @Prop({ type: String, default: '' })
  deck_language: string; // Ngôn ngữ (vi, en, etc.)

  createdAt: Date;
  updatedAt: Date;
}

export const FlashcardDeckSchema = SchemaFactory.createForClass(FlashcardDeck);

/** Indexes for Flashcard */
FlashcardSchema.index({ card_userId: 1, card_isArchived: 1, createdAt: -1 });
FlashcardSchema.index({ card_deckId: 1, createdAt: -1 });
FlashcardSchema.index({ card_tags: 1 });
FlashcardSchema.index({ card_front_norm: 1, card_back_norm: 1 });
FlashcardSchema.index({ 'card_progress.user_id': 1 });

/** Indexes for FlashcardDeck */
FlashcardDeckSchema.index({
  deck_userId: 1,
  deck_isArchived: 1,
  createdAt: -1,
});
FlashcardDeckSchema.index({ deck_name_norm: 1 });
FlashcardDeckSchema.index({ deck_tags: 1 });
FlashcardDeckSchema.index({ deck_isPublic: 1, createdAt: -1 });
FlashcardDeckSchema.index({ deck_level: 1, deck_language: 1 });

/** Hooks for Flashcard */
function normalizeVi(s = '') {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();
}

FlashcardSchema.pre('save', function (next) {
  if (this.isModified('card_front')) {
    this.card_front_norm = normalizeVi(this.card_front || '');
  }
  if (this.isModified('card_back')) {
    this.card_back_norm = normalizeVi(this.card_back || '');
  }
  next();
});

/** Hooks for FlashcardDeck */
FlashcardDeckSchema.pre('save', function (next) {
  if (this.isModified('deck_name')) {
    this.deck_name_norm = normalizeVi(this.deck_name || '');
  }
  // Auto update totalCards
  if (this.isModified('deck_cardIds')) {
    this.deck_totalCards = this.deck_cardIds?.length || 0;
  }
  next();
});

export default {
  name: 'Flashcard',
  schema: FlashcardSchema,
};

export const flashcardDeckModel = {
  name: 'FlashcardDeck',
  schema: FlashcardDeckSchema,
};
