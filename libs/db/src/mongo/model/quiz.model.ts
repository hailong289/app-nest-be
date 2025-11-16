import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import Utils from 'libs/helpers/utils';

export type QuizDocument = HydratedDocument<Quiz>;
export type QuizResultDocument = HydratedDocument<QuizResult>;

export type QuizStatus = 'draft' | 'active' | 'completed' | 'cancelled';
export type QuestionType =
  | 'single_choice'
  | 'multiple_choice'
  | 'true_false'
  | 'text';

// Subdocument: Đáp án của câu hỏi
@Schema({ _id: false })
export class Answer {
  @Prop({ type: String, required: true })
  answer_text: string; // Nội dung đáp án

  @Prop({ type: Boolean, default: false })
  is_correct: boolean; // Đáp án đúng hay sai

  @Prop({ type: Number, default: 0 })
  points: number; // Điểm số cho đáp án này (nếu có)
}

export const AnswerSchema = SchemaFactory.createForClass(Answer);

// Subdocument: Câu hỏi
@Schema({ _id: false })
export class Question {
  @Prop({ type: String, required: true })
  question_text: string; // Nội dung câu hỏi

  @Prop({
    type: String,
    enum: ['single_choice', 'multiple_choice', 'true_false', 'text'],
    required: true,
    default: 'single_choice',
  })
  question_type: QuestionType;

  @Prop({ type: [AnswerSchema], required: true, default: [] })
  answers: Answer[]; // Danh sách đáp án

  @Prop({ type: Number, default: 1 })
  points: number; // Điểm số của câu hỏi

  @Prop({ type: Number, default: 0 })
  order: number; // Thứ tự câu hỏi

  @Prop({ type: String, default: '' })
  explanation: string; // Giải thích đáp án (hiển thị sau khi làm xong)

  @Prop({ type: String, default: '' })
  image_url: string; // Ảnh minh họa (nếu có)
}

export const QuestionSchema = SchemaFactory.createForClass(Question);

// Subdocument: Câu trả lời của user
@Schema({ _id: false })
export class UserAnswer {
  @Prop({ type: Number, required: true })
  question_index: number; // Index của câu hỏi trong mảng questions

  @Prop({ type: [Number], default: [] })
  selected_answer_indices: number[]; // Index của các đáp án đã chọn

  @Prop({ type: String, default: '' })
  text_answer: string; // Câu trả lời dạng text (cho question_type = 'text')

  @Prop({ type: Boolean, default: false })
  is_correct: boolean; // Câu trả lời đúng hay sai

  @Prop({ type: Number, default: 0 })
  points_earned: number; // Điểm đạt được cho câu hỏi này

  @Prop({ type: Date, default: Date.now })
  answered_at: Date; // Thời gian trả lời
}

export const UserAnswerSchema = SchemaFactory.createForClass(UserAnswer);

// Subdocument: Kết quả của một user làm quiz
@Schema({ _id: false })
export class QuizResult {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  user_id: Types.ObjectId; // Người làm bài

  @Prop({ type: [UserAnswerSchema], default: [] })
  user_answers: UserAnswer[]; // Câu trả lời của user

  @Prop({ type: Number, default: 0 })
  total_score: number; // Tổng điểm đạt được

  @Prop({ type: Number, default: 0 })
  max_score: number; // Tổng điểm tối đa

  @Prop({ type: Number, default: 0 })
  correct_count: number; // Số câu trả lời đúng

  @Prop({ type: Number, default: 0 })
  total_questions: number; // Tổng số câu hỏi

  @Prop({ type: Date, default: Date.now })
  started_at: Date; // Thời gian bắt đầu làm bài

  @Prop({ type: Date, default: null })
  completed_at: Date | null; // Thời gian hoàn thành

  @Prop({ type: Number, default: 0 })
  time_taken: number; // Thời gian làm bài (giây)

  @Prop({ type: Boolean, default: false })
  is_completed: boolean; // Đã hoàn thành chưa

  @Prop({ type: Boolean, default: false })
  is_submitted: boolean; // Đã nộp bài chưa
}

export const QuizResultSchema = SchemaFactory.createForClass(QuizResult);

// Main Quiz Schema
@Schema({ timestamps: true, collection: 'Quizzes' })
export class Quiz {
  @Prop({
    type: String,
    unique: true,
    default: () => Utils.randomId(),
    index: true,
  })
  quiz_id: string;

  @Prop({ type: String, required: true })
  quiz_title: string; // Tiêu đề quiz

  @Prop({ type: String, default: '' })
  quiz_description: string; // Mô tả quiz

  @Prop({ type: Types.ObjectId, ref: 'Room', required: true, index: true })
  quiz_roomId: Types.ObjectId; // Phòng chứa quiz

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  quiz_createdBy: Types.ObjectId; // Người tạo quiz

  @Prop({ type: [QuestionSchema], required: true, default: [] })
  quiz_questions: Question[]; // Danh sách câu hỏi

  @Prop({
    type: String,
    enum: ['draft', 'active', 'completed', 'cancelled'],
    default: 'draft',
    index: true,
  })
  quiz_status: QuizStatus; // Trạng thái quiz

  @Prop({ type: Number, default: 0 })
  quiz_timeLimit: number; // Thời gian làm bài (giây), 0 = không giới hạn

  @Prop({ type: Date, default: null })
  quiz_startTime: Date | null; // Thời gian bắt đầu quiz (nếu có lịch)

  @Prop({ type: Date, default: null })
  quiz_endTime: Date | null; // Thời gian kết thúc quiz (nếu có lịch)

  @Prop({ type: Boolean, default: true })
  quiz_showResults: boolean; // Có hiển thị kết quả ngay sau khi làm xong không

  @Prop({ type: Boolean, default: false })
  quiz_allowRetake: boolean; // Cho phép làm lại không

  @Prop({ type: Number, default: 0 })
  quiz_maxAttempts: number; // Số lần làm tối đa, 0 = không giới hạn

  @Prop({ type: [QuizResultSchema], default: [] })
  quiz_results: QuizResult[]; // Kết quả của các user đã làm

  @Prop({ type: Number, default: 0 })
  quiz_totalParticipants: number; // Tổng số người đã tham gia

  @Prop({ type: Number, default: 0 })
  quiz_totalSubmissions: number; // Tổng số bài đã nộp

  @Prop({ type: String, default: '' })
  quiz_image: string; // Ảnh đại diện quiz (nếu có)

  createdAt: Date;
  updatedAt: Date;
}

export const QuizSchema = SchemaFactory.createForClass(Quiz);

/** Indexes */
QuizSchema.index({ quiz_roomId: 1, quiz_status: 1, createdAt: -1 });
QuizSchema.index({ quiz_createdBy: 1, createdAt: -1 });
QuizSchema.index({ quiz_status: 1, createdAt: -1 });
QuizSchema.index({ 'quiz_results.user_id': 1 });

export default {
  name: 'Quiz',
  schema: QuizSchema,
};
