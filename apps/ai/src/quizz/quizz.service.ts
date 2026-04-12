import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Quiz } from 'libs/db/src/mongo/model/quiz.model';
import { User } from 'libs/db/src/mongo/model/user.model';
import { Message } from 'libs/db/src/mongo/model/messages.model';
import { Model, Types } from 'mongoose';
import {
  AnswerSubmitDto,
  CreateQuizzDto,
  UpdateQuizzDto,
} from './dto/quizz.dto';
import { Response } from 'libs/helpers/response';

@Injectable()
export class QuizzService {
  constructor(
    @InjectModel(Quiz.name) private readonly quizModel: Model<Quiz>,
    @InjectModel(User.name) private readonly userModel: Model<User>,
    @InjectModel(Message.name) private readonly messageModel: Model<Message>,
  ) {}

  async createQuizz(data: CreateQuizzDto) {
    try {
      // Convert string IDs to ObjectId
      const quizData = {
        ...data,
        quiz_roomId: new Types.ObjectId(data.quiz_roomId),
        quiz_createdBy: new Types.ObjectId(data.quiz_createdBy),
      };
      const quiz = await this.quizModel.create(quizData);
      return Response.success(quiz);
    } catch (error) {
      return Response.error(error.message, 400, 'Bad Request');
    }
  }

  async getQuizzById(quiz_id: string) {
    const quiz = await this.quizModel.findOne({ quiz_id });
    if (!quiz) {
      return Response.error('Quiz not found', 404, 'NOT_FOUND');
    }
    return Response.success(quiz);
  }

  async listQuizzes(
    page: number,
    limit: number,
    roomId: string,
    createdBy?: string,
  ) {
    const filter: Record<string, any> = {
      quiz_roomId: new Types.ObjectId(roomId),
    };
    if (createdBy && Types.ObjectId.isValid(createdBy)) {
      filter.quiz_createdBy = new Types.ObjectId(createdBy);
    }

    const [quizzes, total] = await Promise.all([
      this.quizModel
        .find(filter)
        .skip((page - 1) * limit)
        .limit(limit)
        .sort({ createdAt: -1 })
        .lean(),
      this.quizModel.countDocuments(filter),
    ]);

    // Lấy tất cả _id của quizzes trong trang hiện tại
    const quizObjectIds = quizzes.map((q) => q._id);

    // 1 query duy nhất: tìm tất cả message có quiz_id thuộc danh sách trên
    const sentMessages = await this.messageModel
      .find({ quiz_id: { $in: quizObjectIds } })
      .select('quiz_id')
      .lean();

    const sentSet = new Set(sentMessages.map((m) => m.quiz_id?.toString()));

    const data = quizzes.map((q) => ({
      ...q,
      is_send: sentSet.has(q._id.toString()),
    }));

    return Response.success({
      data,
      total_item: total,
      total_page: Math.ceil(total / limit),
      page,
    });
  }

  async updateQuizzById(quiz_id: string, data: UpdateQuizzDto) {
    try {
      const quiz = await this.quizModel.findOneAndUpdate({ quiz_id }, data, {
        new: true,
      });
      if (!quiz) {
        return Response.error('Quiz not found', 404, 'NOT_FOUND');
      }
      return Response.success(quiz);
    } catch (error) {
      return Response.error(error.message, 400, 'Bad Request');
    }
  }

  async deleteQuizzById(quiz_id: string) {
    const quiz = await this.quizModel.findOneAndDelete({ quiz_id });
    if (!quiz) {
      return Response.error('Quiz not found', 404, 'NOT_FOUND');
    }
    return Response.success(quiz);
  }

  async getQuizzResults(quiz_id: string, user_id?: string) {
    // Hỗ trợ cả MongoDB _id (24-char hex) lẫn business quiz_id (ULID)
    const isObjectId = Types.ObjectId.isValid(quiz_id) && quiz_id.length === 24;
    const filter = isObjectId
      ? { _id: new Types.ObjectId(quiz_id) }
      : { quiz_id };
    const quiz = await this.quizModel.findOne(filter).lean();
    if (!quiz) {
      return Response.error('Quiz not found', 404, 'NOT_FOUND');
    }

    const rawResults = quiz.quiz_results ?? [];

    const total_participants = rawResults.length;
    const submitted_count = rawResults.filter((r) => r.is_submitted).length;
    const not_submitted_count = total_participants - submitted_count;

    // Lấy thông tin user cho tất cả kết quả
    const userIds = rawResults
      .map((r) => r.user_id)
      .filter(Boolean) as Types.ObjectId[];

    const users = await this.userModel
      .find({ _id: { $in: userIds } })
      .select('_id usr_fullname usr_avatar')
      .lean();

    const userMap = new Map(users.map((u) => [u._id.toString(), u]));

    // Bảng xếp hạng: chỉ user đã nộp, sắp xếp theo correct_count giảm dần, time_taken tăng dần
    const leaderboard = rawResults
      .filter((r) => r.is_submitted)
      .map((r) => {
        const user = userMap.get(r.user_id?.toString() ?? '');
        return {
          rank: 0,
          user_id: r.user_id?.toString() ?? '',
          user_name: user?.usr_fullname ?? '',
          user_avatar: user?.usr_avatar ?? '',
          correct_count: r.correct_count,
          total_score: r.total_score,
          max_score: r.max_score,
          time_taken: r.time_taken,
          is_completed: r.is_completed,
        };
      })
      .sort((a, b) => {
        if (b.correct_count !== a.correct_count)
          return b.correct_count - a.correct_count;
        return a.time_taken - b.time_taken;
      })
      .map((entry, idx) => ({ ...entry, rank: idx + 1 }));

    // Nếu có user_id, tìm kết quả của user đó và trả về my_result kèm user_answers
    let my_result: Record<string, any> | null = null;
    if (
      user_id &&
      Types.ObjectId.isValid(user_id) &&
      quiz.quiz_createdBy.toString() !== user_id
    ) {
      const userObjectId = new Types.ObjectId(user_id);
      const found = rawResults.find(
        (r) => r.user_id?.toString() === userObjectId.toString(),
      );
      if (found) {
        my_result = {
          user_id: found.user_id?.toString() ?? '',
          user_answers: found.user_answers ?? [],
          total_score: found.total_score,
          max_score: found.max_score,
          correct_count: found.correct_count,
          total_questions: found.total_questions,
          started_at: found.started_at?.toISOString?.() ?? '',
          completed_at: found.completed_at?.toISOString?.() ?? '',
          time_taken: found.time_taken,
          is_completed: found.is_completed,
          is_submitted: found.is_submitted,
        };
      }
    }

    return Response.success({
      quiz_id: quiz.quiz_id,
      quiz_title: quiz.quiz_title,
      total_participants,
      submitted_count,
      not_submitted_count,
      leaderboard,
      my_result,
    });
  }

  async submitQuizz(quiz_id: string, answer: AnswerSubmitDto) {
    try {
      const quiz = await this.quizModel.findOne({ quiz_id });
      if (!quiz) {
        return Response.error('Quiz not found', 404, 'NOT_FOUND');
      }
      if (quiz.quiz_status !== 'active') {
        return Response.error('Quiz chưa được kích hoạt', 400, 'BAD_REQUEST');
      }

      const userId = new Types.ObjectId(answer.userId);
      const existingResult = (quiz.quiz_results ?? []).find(
        (r) => r.user_id?.toString() === userId.toString(),
      );
      if (existingResult && !quiz.quiz_allowRetake) {
        return Response.error(
          'Bạn đã nộp bài, quiz không cho phép làm lại',
          400,
          'BAD_REQUEST',
        );
      }

      let totalScore = 0;
      let maxScore = 0;
      let correctCount = 0;
      const totalQuestions = quiz.quiz_questions.length;

      const userAnswers = (answer.answers ?? []).map((ua) => {
        const question = quiz.quiz_questions[ua.question_index];
        if (!question) {
          return {
            question_index: ua.question_index,
            selected_answer_indices: ua.selected_answer_indices ?? [],
            text_answer: ua.text_answer ?? '',
            is_correct: false,
            points_earned: 0,
            answered_at: new Date(),
          };
        }

        maxScore += question.points ?? 1;

        let isCorrect = false;
        let pointsEarned = 0;

        if (question.question_type !== 'text') {
          const correctIndices = question.answers
            .map((a, i) => (a.is_correct ? i : -1))
            .filter((i) => i !== -1);
          const selected = ua.selected_answer_indices ?? [];

          if (question.question_type === 'multiple_choice') {
            isCorrect =
              correctIndices.length === selected.length &&
              correctIndices.every((i) => selected.includes(i));
          } else {
            // single_choice | true_false
            isCorrect =
              selected.length === 1 && correctIndices.includes(selected[0]);
          }

          if (isCorrect) {
            pointsEarned = question.points ?? 1;
            correctCount++;
            totalScore += pointsEarned;
          }
        }

        return {
          question_index: ua.question_index,
          selected_answer_indices: ua.selected_answer_indices ?? [],
          text_answer: ua.text_answer ?? '',
          is_correct: isCorrect,
          points_earned: pointsEarned,
          answered_at: new Date(),
        };
      });

      const resultEntry = {
        user_id: userId,
        user_answers: userAnswers,
        total_score: totalScore,
        max_score: maxScore,
        correct_count: correctCount,
        total_questions: totalQuestions,
        started_at: answer.started_at
          ? new Date(answer.started_at)
          : new Date(),
        completed_at: new Date(),
        time_taken: answer.time_taken ?? 0,
        is_completed: true,
        is_submitted: true,
      };

      // Nếu đã có kết quả cũ thì thay thế, ngược lại push mới
      const updatedQuiz = existingResult
        ? await this.quizModel
            .findOneAndUpdate(
              { quiz_id, 'quiz_results.user_id': userId },
              { $set: { 'quiz_results.$': resultEntry } },
              { new: true, lean: true },
            )
            .lean()
        : await this.quizModel
            .findOneAndUpdate(
              { quiz_id },
              {
                $push: { quiz_results: resultEntry },
                $inc: {
                  quiz_totalSubmissions: 1,
                  quiz_totalParticipants: 1,
                },
              },
              { new: true, lean: true },
            )
            .lean();

      return Response.success({
        total_score: totalScore,
        max_score: maxScore,
        correct_count: correctCount,
        total_questions: totalQuestions,
        is_completed: true,
        quiz: updatedQuiz,
      });
    } catch (error) {
      return Response.error(error.message, 400, 'Bad Request');
    }
  }
}
