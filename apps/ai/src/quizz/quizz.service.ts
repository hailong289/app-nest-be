import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Quiz } from 'libs/db/src/mongo/model/quiz.model';
import { Model } from 'mongoose';
import { CreateQuizzDto, UpdateQuizzDto } from './dto/quizz.dto';

@Injectable()
export class QuizzService {
  constructor(
    @InjectModel(Quiz.name) private readonly quizModel: Model<Quiz>,
  ) {}

  async createQuizz(data: CreateQuizzDto) {
    const quiz = await this.quizModel.create(data);
    return quiz;
  }

  async getQuizzById(quiz_id: string) {
    const quiz = await this.quizModel.findById(quiz_id);
    return quiz;
  }

  async listQuizzes(page: number, limit: number, userId: string) {
    const quizzes = await this.quizModel
      .find()
      .skip((page - 1) * limit)
      .limit(limit)
      .sort({ createdAt: -1 });
    return quizzes;
  }

  async updateQuizzById(quiz_id: string, data: UpdateQuizzDto) {
    const quiz = await this.quizModel.findByIdAndUpdate(quiz_id, data, {
      new: true,
    });
    return quiz;
  }

  async deleteQuizzById(quiz_id: string) {
    const quiz = await this.quizModel.findByIdAndDelete(quiz_id);
    return quiz;
  }
}
