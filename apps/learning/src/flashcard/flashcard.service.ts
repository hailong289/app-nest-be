import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  Flashcard,
  FlashcardDeck,
  FlashcardProgress,
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
    @InjectModel(FlashcardProgress.name)
    private readonly flashcardProgressModel: Model<FlashcardProgress>,
  ) { }

  // Flashcard methods
  async createFlashcard(data: CreateFlashcardDto & { card_userId: string }) {
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
        const desk = await this.flashcardDeckModel.findOne({ deck_id: deckId });
        if (!desk) {
          return Response.error('Flashcard deck not found', 404, 'NOT_FOUND');
        }
        query.card_deckId = desk._id;
      }

      console.log('query', query);

      const flashcards = await this.flashcardModel
        .find(query)
        .skip((page - 1) * limit)
        .limit(limit)
        .sort({ createdAt: -1 });

      const total_item = await this.flashcardModel.countDocuments(query);

      return Response.success({
        data: flashcards,
        total_item,
        total_page: Math.ceil(total_item / limit),
        page,
      });
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
            card_userId: new Types.ObjectId(data.deck_userId),
            card_deckId: deck._id,
          })),
        );
      }
      return Response.success(deck);
    } catch (error) {
      return Response.error(error.message, 400, 'Bad Request');
    }
  }

  async getFlashcardDeckById(deck_id: string, userId?: string) {
    const deck = await this.flashcardDeckModel.findOne({ deck_id }).lean();
    if (!deck) {
      return Response.error('Flashcard deck not found', 404, 'NOT_FOUND');
    }

    const { total_cards, progress } = await this.getDeckProgressStats(
      deck._id,
      userId,
    );

    return Response.success({
      ...deck,
      total_cards,
      progress,
    });
  }

  private async getDeckProgressStats(
    deckObjectId: Types.ObjectId,
    userId?: string,
  ) {
    const flashcards = await this.flashcardModel
      .find({ card_deckId: deckObjectId })
      .lean();

    const total_cards = flashcards.length;
    let new_cards = 0;
    let learning_cards = 0;
    let review_cards = 0;
    let mastered_cards = 0;

    if (userId) {
      const cardIds = flashcards.map((c: any) => c.card_id);
      const progresses = await this.flashcardProgressModel
        .find({ user_id: userId, card_id: { $in: cardIds } })
        .lean();

      const progressMap = new Map(progresses.map((p: any) => [p.card_id, p]));

      flashcards.forEach((card: any) => {
        const progress = progressMap.get(card.card_id);
        if (!progress || progress.status === 'new') {
          new_cards++;
        } else if (progress.status === 'mastered' || progress.is_mastered) {
          mastered_cards++;
        } else if (progress.status === 'review') {
          review_cards++;
        } else if (progress.status === 'learning') {
          learning_cards++;
        } else {
          new_cards++;
        }
      });
    } else {
      new_cards = total_cards;
    }

    return {
      total_cards,
      progress: {
        new_cards,
        learning_cards,
        review_cards,
        mastered_cards,
        total_cards,
      },
    };
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
        .sort({ createdAt: -1 })
        .lean();

      const enhancedDecks = await Promise.all(
        decks.map(async (deck) => {
          const { total_cards, progress } = await this.getDeckProgressStats(
            deck._id,
            userId,
          );

          return {
            ...deck,
            total_cards,
            progress,
          };
        }),
      );

      return Response.success(enhancedDecks);
    } catch (error) {
      return Response.error(error.message, 400, 'Bad Request');
    }
  }

  async updateFlashcardDeckById(deck_id: string, data: UpdateFlashcardDeckDto) {
    try {
      const updateData: any = { ...data };

      const deck = await this.flashcardDeckModel.findOneAndUpdate(
        { deck_id },
        updateData,
        { new: true },
      );

      if (!deck) {
        return Response.error('Flashcard deck not found', 404, 'NOT_FOUND');
      }

      if (data.flashcards) {
        const providedIds = data.flashcards
          .map((card: any) => card.card_id)
          .filter((id: any) => id != null);

        const deleteQuery: any = { card_deckId: deck._id };
        if (providedIds.length > 0) {
          deleteQuery.$nor = [{ card_id: { $in: providedIds } }];
        }
        await this.flashcardModel.deleteMany(deleteQuery);

        const chunkSize = 10;
        for (let i = 0; i < data.flashcards.length; i += chunkSize) {
          const chunk = data.flashcards.slice(i, i + chunkSize);
          await Promise.all(
            chunk.map(async (flashcard: any) => {
              const cardData = {
                ...flashcard,
                card_userId: flashcard.card_userId
                  ? new Types.ObjectId(flashcard.card_userId)
                  : deck.deck_userId,
                card_deckId: deck._id,
              };

              const filter = flashcard.card_id
                ? { card_id: flashcard.card_id }
                : null;

              if (filter) {
                return this.flashcardModel.updateOne(
                  filter,
                  { $set: cardData },
                  { upsert: true },
                );
              } else {
                return this.flashcardModel.create(cardData);
              }
            }),
          );
        }
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

  async cloneFlashcardDeck(deck_id: string, userId: string) {
    try {
      const originalDeck = await this.flashcardDeckModel.findOne({ deck_id }).lean();
      if (!originalDeck) {
        return Response.error('Flashcard deck not found', 404, 'NOT_FOUND');
      }

      // 1. Create a copy of the deck
      const newDeckData = {
        deck_userId: new Types.ObjectId(userId),
        deck_name: originalDeck.deck_name + ' (Clone)',
        deck_description: originalDeck.deck_description,
        deck_image: originalDeck.deck_image,
        deck_tags: originalDeck.deck_tags,
        deck_level: originalDeck.deck_level,
        deck_language: originalDeck.deck_language,
        deck_totalCards: originalDeck.deck_totalCards,
        deck_isPublic: false,
      };

      const newDeck = await this.flashcardDeckModel.create(newDeckData);

      // 2. Fetch all cards of the original deck
      const originalCards = await this.flashcardModel
        .find({ card_deckId: originalDeck._id })
        .lean();

      // 3. Create copies of the cards
      if (originalCards.length > 0) {
        const newCardsData = originalCards.map((card) => ({
          card_userId: new Types.ObjectId(userId),
          card_deckId: newDeck._id,
          card_front: card.card_front,
          card_back: card.card_back,
          card_hint: card.card_hint,
          card_tags: card.card_tags,
          card_image: card.card_image,
          card_audio: card.card_audio,
          card_difficulty: card.card_difficulty,
          card_isPublic: false,
        }));

        const insertedCards = await this.flashcardModel.insertMany(newCardsData);

        // Update deck_cardIds
        const cardIds = insertedCards.map(c => c._id);
        await this.flashcardDeckModel.updateOne(
          { _id: newDeck._id },
          { $set: { deck_cardIds: cardIds } }
        );
      }

      return Response.success({ ...newDeck.toObject(), cloned_from: deck_id });
    } catch (error) {
      return Response.error(error.message, 400, 'Bad Request');
    }
  }

  // FlashcardProgress methods
  async updateFlashcardProgress(
    card_id: string,
    user_id: string,
    data: Record<string, any>,
  ) {
    try {
      const updateData: Record<string, any> = {};
      const allowedFields = [
        'mastery_level',
        'review_count',
        'correct_count',
        'incorrect_count',
        'is_mastered',
        'is_favorite',
        'status',
        'next_review',
      ];
      for (const field of allowedFields) {
        if (data[field] !== undefined) {
          updateData[field] = data[field];
        }
      }
      updateData.last_reviewed = new Date();

      const progress = await this.flashcardProgressModel.findOneAndUpdate(
        { card_id, user_id },
        { $set: updateData },
        { new: true, upsert: true },
      );
      return Response.success(progress);
    } catch (error) {
      return Response.error(error.message, 400, 'Bad Request');
    }
  }

  async getFlashcardProgress(card_id: string, user_id: string) {
    try {
      const progress = await this.flashcardProgressModel.findOne({
        card_id,
        user_id,
      });
      if (!progress) {
        // Return default "new" state if no record yet
        return Response.success({
          card_id,
          user_id,
          status: 'new',
          mastery_level: 0,
          review_count: 0,
          correct_count: 0,
          incorrect_count: 0,
          is_mastered: false,
          is_favorite: false,
        });
      }
      return Response.success(progress);
    } catch (error) {
      return Response.error(error.message, 400, 'Bad Request');
    }
  }
}
