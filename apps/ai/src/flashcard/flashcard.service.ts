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
        .sort({ createdAt: -1 })
        .lean();

      const enhancedDecks = await Promise.all(
        decks.map(async (deck) => {
          const flashcards = await this.flashcardModel
            .find({ card_deckId: deck._id })
            .lean();

          const total_cards = flashcards.length;
          let new_cards = total_cards;
          let learning_cards = 0;
          let review_cards = 0;
          let mastered_cards = 0;

          if (userId) {
            flashcards.forEach((card: any) => {
              const progress = card.card_progress?.find(
                (p: any) => p.user_id.toString() === userId,
              );
              if (progress) {
                new_cards--;
                if (progress.status === 'mastered' || progress.is_mastered) {
                  mastered_cards++;
                } else if (progress.status === 'review') {
                  review_cards++;
                } else if (progress.status === 'learning') {
                  learning_cards++;
                } else {
                  new_cards++;
                }
              }
            });
          }

          return {
            ...deck,
            total_cards,
            progress: {
              new_cards,
              learning_cards,
              review_cards,
              mastered_cards,
              total_cards,
            },
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
          deleteQuery.$nor = [
            { card_id: { $in: providedIds } }
          ];
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
                  { upsert: true }
                );
              } else {
                return this.flashcardModel.create(cardData);
              }
            })
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
}
