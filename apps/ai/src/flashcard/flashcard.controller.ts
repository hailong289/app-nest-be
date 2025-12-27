import { Controller } from '@nestjs/common';
import { FlashcardService } from './flashcard.service';
import { GrpcMethod } from '@nestjs/microservices';
import {
  CreateFlashcardDto,
  DeleteFlashcardDto,
  GetFlashcardDto,
  ListFlashcardsDto,
  UpdateFlashcardDto,
  CreateFlashcardDeckDto,
  DeleteFlashcardDeckDto,
  GetFlashcardDeckDto,
  ListFlashcardDecksDto,
  UpdateFlashcardDeckDto,
} from './dto/flashcard.dto';

@Controller()
export class FlashcardController {
  constructor(private readonly flashcardService: FlashcardService) {}

  // Flashcard methods
  @GrpcMethod('FlashcardService', 'CreateFlashcard')
  async createFlashcard(data: CreateFlashcardDto) {
    return await this.flashcardService.createFlashcard(data);
  }

  @GrpcMethod('FlashcardService', 'GetFlashcard')
  async getFlashcard(data: GetFlashcardDto) {
    return await this.flashcardService.getFlashcardById(data.card_id);
  }

  @GrpcMethod('FlashcardService', 'ListFlashcards')
  async listFlashcards(
    data: ListFlashcardsDto & { userId?: string; deckId?: string },
  ) {
    return await this.flashcardService.listFlashcards(
      data.page,
      data.limit,
      data.userId,
      data.deckId,
    );
  }

  @GrpcMethod('FlashcardService', 'UpdateFlashcard')
  async updateFlashcard(data: UpdateFlashcardDto & { card_id: string }) {
    return await this.flashcardService.updateFlashcardById(data.card_id, data);
  }

  @GrpcMethod('FlashcardService', 'DeleteFlashcard')
  async deleteFlashcard(data: DeleteFlashcardDto) {
    return await this.flashcardService.deleteFlashcardById(data.card_id);
  }

  // Flashcard Deck methods
  @GrpcMethod('FlashcardService', 'CreateFlashcardDeck')
  async createFlashcardDeck(data: CreateFlashcardDeckDto) {
    return await this.flashcardService.createFlashcardDeck(data);
  }

  @GrpcMethod('FlashcardService', 'GetFlashcardDeck')
  async getFlashcardDeck(data: GetFlashcardDeckDto) {
    return await this.flashcardService.getFlashcardDeckById(data.deck_id);
  }

  @GrpcMethod('FlashcardService', 'ListFlashcardDecks')
  async listFlashcardDecks(data: ListFlashcardDecksDto & { userId?: string }) {
    return await this.flashcardService.listFlashcardDecks(
      data.page,
      data.limit,
      data.userId,
    );
  }

  @GrpcMethod('FlashcardService', 'UpdateFlashcardDeck')
  async updateFlashcardDeck(
    data: UpdateFlashcardDeckDto & { deck_id: string },
  ) {
    return await this.flashcardService.updateFlashcardDeckById(
      data.deck_id,
      data,
    );
  }

  @GrpcMethod('FlashcardService', 'DeleteFlashcardDeck')
  async deleteFlashcardDeck(data: DeleteFlashcardDeckDto) {
    return await this.flashcardService.deleteFlashcardDeckById(data.deck_id);
  }
}
