import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Quiz } from 'libs/db/src/mongo/model/quiz.model';
import { Model, Types } from 'mongoose';
import { CreateQuizzDto, UpdateQuizzDto } from './dto/quizz.dto';
import { Response } from 'libs/helpers/response';

@Injectable()
export class QuizzService {
  constructor(
    @InjectModel(Quiz.name) private readonly quizModel: Model<Quiz>,
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
    return Response.success(quizzes);
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
}
