import { Injectable, Inject } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Quiz } from 'libs/db/src/mongo/model/quiz.model';
import { Model, Types } from 'mongoose';
import {
  AnswerSubmitDto,
  CreateQuizzDto,
  UpdateQuizzDto,
} from './dto/quizz.dto';
import { Response } from 'libs/helpers/response';
import type { ClientGrpc } from '@nestjs/microservices';
import { SERVICES } from '@app/constants';
import { firstValueFrom } from 'rxjs';

interface AuthGrpcClient {
  GetUsersByIds(data: { userIds: string[] }): any;
}

interface ChatGrpcClient {
  GetMessagesByRoomId(data: { roomId: string; limit: number; offset: number }): any;
}

type GrpcResponse<T = any> = { metadata?: T };

@Injectable()
export class QuizzService {
  private authGrpcClient: AuthGrpcClient;
  private chatGrpcClient: ChatGrpcClient;

  constructor(
    @InjectModel(Quiz.name) private readonly quizModel: Model<Quiz>,
    @Inject(SERVICES.AUTH)
    private readonly authGrpc: ClientGrpc,
    @Inject(SERVICES.CHAT)
    private readonly chatGrpc: ClientGrpc,
  ) {}

  onModuleInit() {
    this.authGrpcClient =
      this.authGrpc.getService<AuthGrpcClient>('AuthService');
    this.chatGrpcClient = this.chatGrpc.getService<ChatGrpcClient>('ChatService');
  }

  async createQuizz(data: CreateQuizzDto) {
    try {
      const quizData = {
        ...data,
        quiz_roomId: new Types.ObjectId(data.quiz_roomId),
        quiz_createdBy: new Types.ObjectId(data.quiz_createdBy),
      };
      const quiz = await this.quizModel.create(quizData);
      return Response.success(quiz);
    } catch (error) {
      return Response.error((error as Error).message, 400, 'Bad Request');
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

    const sentSet = new Set<string>();
    try {
      const chatResult = (await firstValueFrom(
        this.chatGrpcClient.GetMessagesByRoomId({
          roomId,
          limit: 500,
          offset: 0,
        }),
      )) as GrpcResponse<any[]>;
      for (const message of chatResult.metadata ?? []) {
        const quizId = message?.quiz?.id ?? message?.quiz?.quiz_id;
        if (quizId) sentSet.add(String(quizId));
      }
    } catch {
      // Best-effort only: learning owns quizzes, chat owns sent-message state.
    }

    const data = quizzes.map((q) => ({
      ...q,
      is_send: sentSet.has(q._id.toString()) || sentSet.has(q.quiz_id),
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
      return Response.error((error as Error).message, 400, 'Bad Request');
    }
  }

  async deleteQuizzById(quiz_id: string) {
    const quiz = await this.quizModel.findOneAndDelete({ quiz_id });
    if (!quiz) {
      return Response.error('Quiz not found', 404, 'NOT_FOUND');
    }
    return Response.success(null, 'Quiz deleted successfully');
  }

  async getQuizzesByIds(quizIds: string[]) {
    try {
      const objectIds = quizIds
        .filter((id) => Types.ObjectId.isValid(id))
        .map((id) => new Types.ObjectId(id));
      const quizzes = await this.quizModel
        .find({
          $or: [
            { quiz_id: { $in: quizIds } },
            ...(objectIds.length ? [{ _id: { $in: objectIds } }] : []),
          ],
        })
        .lean();
      return Response.success(quizzes);
    } catch (error) {
      return Response.error((error as Error).message, 400, 'Bad Request');
    }
  }

  async getQuizResults(quizId: string) {
    const filter = Types.ObjectId.isValid(quizId)
      ? { _id: new Types.ObjectId(quizId) }
      : { quiz_id: quizId };

    const quiz = await this.quizModel.findOne(filter).lean();
    if (!quiz) {
      return Response.error('Quiz not found', 404, 'NOT_FOUND');
    }

    const rawResults = quiz.quiz_results ?? [];

    const total_participants = rawResults.length;
    const submitted_count = rawResults.filter((r) => r.is_submitted).length;
    const not_submitted_count = total_participants - submitted_count;

    // Lấy thông tin user qua gRPC Auth service (database isolation)
    const userIds = rawResults
      .map((r) => r.user_id?.toString())
      .filter(Boolean) as string[];

    const userMap = new Map<string, any>();
    if (userIds.length > 0) {
      try {
        const grpcResult = await firstValueFrom(
          this.authGrpcClient.GetUsersByIds({ userIds }),
        );
        const users = (grpcResult as GrpcResponse<any[]>)?.metadata ?? [];
        for (const u of users) {
          userMap.set(u.id || u._id, u);
        }
      } catch (error) {
        console.error('Error fetching users from Auth:', error);
      }
    }

    const leaderboard = rawResults
      .filter((r) => r.is_submitted)
      .map((r) => {
        const uid = r.user_id?.toString() ?? '';
        const user = userMap.get(uid);
        return {
          rank: 0,
          user_id: uid,
          user_name: user?.fullname ?? '',
          user_avatar: user?.avatar ?? '',
          correct_count: r.correct_count,
          total_score: r.total_score,
          max_score: r.max_score,
          time_taken: r.time_taken,
          is_completed: r.is_completed,
        };
      })
      .sort((a, b) => b.correct_count - a.correct_count || a.time_taken - b.time_taken)
      .map((item, index) => ({ ...item, rank: index + 1 }));

    return Response.success(
      { total_participants, submitted_count, not_submitted_count, leaderboard },
      'Quiz results retrieved successfully',
    );
  }

  async submitAnswer(answer: AnswerSubmitDto) {
    try {
      const payload = answer as AnswerSubmitDto & {
        quiz_id: string;
        user_id?: string;
      };
      const {
        quiz_id,
        answers,
        started_at,
        time_taken,
      } = payload;
      const user_id = payload.user_id ?? payload.userId;
      const userId = new Types.ObjectId(user_id);

      const quiz = await this.quizModel.findOne({ quiz_id }).lean();
      if (!quiz) {
        return Response.error('Quiz not found', 404, 'NOT_FOUND');
      }

      const existingResult = quiz.quiz_results?.find(
        (r) => r.user_id?.toString() === userId.toString(),
      );

      if (existingResult?.is_submitted) {
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

      const userAnswers = (answers ?? []).map((ua) => {
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
        started_at: started_at ? new Date(started_at) : new Date(),
        completed_at: new Date(),
        time_taken: time_taken ?? 0,
        is_completed: true,
        is_submitted: true,
      };

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
      return Response.error((error as Error).message, 400, 'Bad Request');
    }
  }
}
