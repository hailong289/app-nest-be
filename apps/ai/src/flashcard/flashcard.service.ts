import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  Flashcard,
  FlashcardDeck,
} from 'libs/db/src/mongo/model/flashcard.model';
import { Model, Types } from 'mongoose';
import {
  CreateFlashcardDto,
  UpdateFlashcardDto,
  CreateFlashcardDeckDto,
  UpdateFlashcardDeckDto,
} from './dto/flashcard.dto';
import { Response } from 'libs/helpers/response';

@Injectable()
export class FlashcardService {
  constructor(
    @InjectModel(Flashcard.name)
    private readonly flashcardModel: Model<Flashcard>,
    @InjectModel(FlashcardDeck.name)
    private readonly flashcardDeckModel: Model<FlashcardDeck>,
  ) {}

  // Flashcard methods
  async createFlashcard(data: CreateFlashcardDto) {
    try {
      const flashcardData = {
        ...data,
        card_userId: new Types.ObjectId(data.card_userId),
        card_deckId: data.card_deckId
          ? new Types.ObjectId(data.card_deckId)
          : null,
      };
      const flashcard = await this.flashcardModel.create(flashcardData);
      return Response.success(flashcard);
    } catch (error) {
      return Response.error(error.message, 400, 'Bad Request');
    }
  }

  async getFlashcardById(card_id: string) {
    const flashcard = await this.flashcardModel.findOne({ card_id });
    if (!flashcard) {
      return Response.error('Flashcard not found', 404, 'NOT_FOUND');
    }
    return Response.success(flashcard);
  }

  async listFlashcards(
    page: number,
    limit: number,
    userId?: string,
    deckId?: string,
  ) {
    try {
      const query: any = {};
      if (userId) {
        query.card_userId = new Types.ObjectId(userId);
      }
      if (deckId) {
        query.card_deckId = new Types.ObjectId(deckId);
      }

      const flashcards = await this.flashcardModel
        .find(query)
        .skip((page - 1) * limit)
        .limit(limit)
        .sort({ createdAt: -1 });
      return Response.success(flashcards);
    } catch (error) {
      return Response.error(error.message, 400, 'Bad Request');
    }
  }

  async updateFlashcardById(card_id: string, data: UpdateFlashcardDto) {
    try {
      const updateData: any = { ...data };
      if (data.card_deckId) {
        updateData.card_deckId = new Types.ObjectId(data.card_deckId);
      }

      const flashcard = await this.flashcardModel.findOneAndUpdate(
        { card_id },
        updateData,
        { new: true },
      );
      if (!flashcard) {
        return Response.error('Flashcard not found', 404, 'NOT_FOUND');
      }
      return Response.success(flashcard);
    } catch (error) {
      return Response.error(error.message, 400, 'Bad Request');
    }
  }

  async deleteFlashcardById(card_id: string) {
    const flashcard = await this.flashcardModel.findOneAndDelete({ card_id });
    if (!flashcard) {
      return Response.error('Flashcard not found', 404, 'NOT_FOUND');
    }
    return Response.success(flashcard);
  }

  // Flashcard Deck methods
  async createFlashcardDeck(data: CreateFlashcardDeckDto) {
    try {
      const deckData = {
        ...data,
        deck_userId: new Types.ObjectId(data.deck_userId),
      };
      const deck = await this.flashcardDeckModel.create(deckData);
      if (data.flashcards) {
        const flashcards = await this.flashcardModel.insertMany(
          data.flashcards.map((flashcard) => ({
            ...flashcard,
            card_userId: new Types.ObjectId(flashcard.card_userId),
            card_deckId: new Types.ObjectId(deck.deck_id),
          })),
        );
      }
      return Response.success(deck);
    } catch (error) {
      return Response.error(error.message, 400, 'Bad Request');
    }
  }

  async getFlashcardDeckById(deck_id: string) {
    const deck = await this.flashcardDeckModel.findOne({ deck_id });
    if (!deck) {
      return Response.error('Flashcard deck not found', 404, 'NOT_FOUND');
    }
    return Response.success(deck);
  }

  async listFlashcardDecks(page: number, limit: number, userId?: string) {
    try {
      const query: any = {};
      if (userId) {
        query.deck_userId = new Types.ObjectId(userId);
      }

      const decks = await this.flashcardDeckModel
        .find(query)
        .skip((page - 1) * limit)
        .limit(limit)
        .sort({ createdAt: -1 });
      return Response.success(decks);
    } catch (error) {
      return Response.error(error.message, 400, 'Bad Request');
    }
  }

  async updateFlashcardDeckById(deck_id: string, data: UpdateFlashcardDeckDto) {
    try {
      const updateData: any = { ...data };
      if (data.deck_cardIds) {
        updateData.deck_cardIds = data.deck_cardIds.map(
          (id) => new Types.ObjectId(id),
        );
      }

      const deck = await this.flashcardDeckModel.findOneAndUpdate(
        { deck_id },
        updateData,
        { new: true },
      );
      if (!deck) {
        return Response.error('Flashcard deck not found', 404, 'NOT_FOUND');
      }
      return Response.success(deck);
    } catch (error) {
      return Response.error(error.message, 400, 'Bad Request');
    }
  }

  async deleteFlashcardDeckById(deck_id: string) {
    const deck = await this.flashcardDeckModel.findOneAndDelete({ deck_id });
    if (!deck) {
      return Response.error('Flashcard deck not found', 404, 'NOT_FOUND');
    }
    return Response.success(deck);
  }
}
