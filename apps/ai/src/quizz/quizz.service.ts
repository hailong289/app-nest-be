import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Quiz } from 'libs/db/src/mongo/model/quiz.model';
import { User } from 'libs/db/src/mongo/model/user.model';
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

  async listQuizzes(page: number, limit: number, roomId: string) {
    const quizzes = await this.quizModel
      .find({ quiz_roomId: new Types.ObjectId(roomId) })
      .skip((page - 1) * limit)
      .limit(limit)
      .sort({ createdAt: -1 });

    const total = await this.quizModel.countDocuments({
      quiz_roomId: new Types.ObjectId(roomId),
    });
    const totalPage = Math.ceil(total / limit);

    return Response.success({
      data: quizzes,
      total_item: total,
      total_page: totalPage,
      page: page,
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

  async getQuizzResults(quiz_id: string) {
    const quiz = await this.quizModel.findOne({ quiz_id }).lean();
    if (!quiz) {
      return Response.error('Quiz not found', 404, 'NOT_FOUND');
    }

    const rawResults = quiz.quiz_results ?? [];

    // Lấy thông tin user cho tất cả kết quả
    const userIds = rawResults
      .map((r) => r.user_id)
      .filter(Boolean) as Types.ObjectId[];

    const users = await this.userModel
      .find({ _id: { $in: userIds } })
      .select('_id usr_id usr_fullname usr_avatar')
      .lean();

    const userMap = new Map(users.map((u) => [u._id.toString(), u]));

    const results = rawResults.map((r) => ({
      user_id: r.user_id?.toString() ?? '',
      total_score: r.total_score,
      max_score: r.max_score,
      correct_count: r.correct_count,
      total_questions: r.total_questions,
      started_at: r.started_at?.toISOString() ?? '',
      completed_at: r.completed_at?.toISOString() ?? '',
      time_taken: r.time_taken,
      is_completed: r.is_completed,
      is_submitted: r.is_submitted,
      user_answers: (r.user_answers ?? []).map((ua) => ({
        question_index: ua.question_index,
        selected_answer_indices: ua.selected_answer_indices ?? [],
        text_answer: ua.text_answer ?? '',
        is_correct: ua.is_correct,
        points_earned: ua.points_earned,
        answered_at:
          ua.answered_at instanceof Date
            ? ua.answered_at.toISOString()
            : String(ua.answered_at ?? ''),
      })),
    }));

    // Bảng xếp hạng: sắp xếp theo correct_count giảm dần, time_taken tăng dần
    const leaderboard = rawResults
      .filter((r) => r.is_submitted)
      .map((r, idx) => {
        const user = userMap.get(r.user_id?.toString() ?? '');
        return {
          rank: 0, // sẽ gán sau
          user_id: r.user_id?.toString() ?? '',
          user_name: user?.usr_fullname ?? '',
          user_avatar: user?.usr_avatar ?? '',
          correct_count: r.correct_count,
          total_score: r.total_score,
          max_score: r.max_score,
          time_taken: r.time_taken, // giây
          is_completed: r.is_completed,
        };
      })
      .sort((a, b) => {
        // 1. Nhiều câu đúng hơn → xếp trên
        if (b.correct_count !== a.correct_count)
          return b.correct_count - a.correct_count;
        // 2. Thời gian nhanh hơn → xếp trên
        return a.time_taken - b.time_taken;
      })
      .map((entry, idx) => ({ ...entry, rank: idx + 1 }));

    return Response.success({
      quiz_id: quiz.quiz_id,
      quiz_title: quiz.quiz_title,
      total_participants: quiz.quiz_totalParticipants,
      total_submissions: quiz.quiz_totalSubmissions,
      results,
      leaderboard,
    });
  }

  async submitQuizz(quiz_id: string, answer: AnswerSubmitDto) {
    try {
      const quiz = await this.quizModel.findOne({ quiz_id });
      if (!quiz) {
        return Response.error('Quiz not found', 404, 'NOT_FOUND');
      }
      if (quiz.quiz_status !== 'active') {
        return Response.error('Quiz is not active', 400, 'BAD_REQUEST');
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
        started_at: answer.started_at ? new Date(answer.started_at) : new Date(),
        completed_at: new Date(),
        time_taken: answer.time_taken ?? 0,
        is_completed: true,
        is_submitted: true,
      };

      // Đảm bảo quiz_results không phải null trước khi $push/$set
      await this.quizModel.updateOne(
        { quiz_id, quiz_results: null },
        { $set: { quiz_results: [] } },
      );

      // Nếu đã có kết quả cũ thì thay thế, ngược lại push mới
      if (existingResult) {
        await this.quizModel.findOneAndUpdate(
          { quiz_id, 'quiz_results.user_id': userId },
          { $set: { 'quiz_results.$': resultEntry } },
        );
      } else {
        await this.quizModel.findOneAndUpdate(
          { quiz_id },
          {
            $push: { quiz_results: resultEntry },
            $inc: {
              quiz_totalSubmissions: 1,
              quiz_totalParticipants: 1,
            },
          },
        );
      }

      return Response.success({
        total_score: totalScore,
        max_score: maxScore,
        correct_count: correctCount,
        total_questions: totalQuestions,
        is_completed: true,
      });
    } catch (error) {
      return Response.error(error.message, 400, 'Bad Request');
    }
  }
}
