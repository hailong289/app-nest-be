import { SERVICES } from '@app/constants';
import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import type { ClientGrpc } from '@nestjs/microservices';
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
} from 'apps/ai/src/flashcard/dto/flashcard.dto';
import { Observable } from 'rxjs';
import { GatewayService } from '../../gateway/gateway.service';

interface FlashcardGrpcService {
  CreateFlashcard(data: CreateFlashcardDto): Observable<any>;
  GetFlashcard(data: GetFlashcardDto): Observable<any>;
  ListFlashcards(data: ListFlashcardsDto): Observable<any>;
  UpdateFlashcard(
    data: UpdateFlashcardDto & { card_id: string },
  ): Observable<any>;
  DeleteFlashcard(
    data: DeleteFlashcardDto & { card_id: string },
  ): Observable<any>;
  CreateFlashcardDeck(data: CreateFlashcardDeckDto): Observable<any>;
  GetFlashcardDeck(data: GetFlashcardDeckDto): Observable<any>;
  ListFlashcardDecks(data: ListFlashcardDecksDto): Observable<any>;
  UpdateFlashcardDeck(
    data: UpdateFlashcardDeckDto & { deck_id: string },
  ): Observable<any>;
  DeleteFlashcardDeck(
    data: DeleteFlashcardDeckDto & { deck_id: string },
  ): Observable<any>;
}

@Controller('ai/flashcard')
export class GatewayFlashcardController {
  private flashcardService: FlashcardGrpcService;
  constructor(
    @Inject(SERVICES.AI) private readonly aiClient: ClientGrpc,
    private readonly gatewayService: GatewayService,
  ) {
    this.flashcardService =
      this.aiClient.getService<FlashcardGrpcService>('FlashcardService');
  }

  // Flashcard endpoints
  @Post('create')
  async createFlashcard(@Body() body: CreateFlashcardDto) {
    return await this.gatewayService.dispatchGrpcRequest(
      this.flashcardService.CreateFlashcard.bind(this.flashcardService),
      body,
    );
  }

  @Get('get/:card_id')
  async getFlashcard(@Param('card_id') card_id: string) {
    return await this.gatewayService.dispatchGrpcRequest(
      this.flashcardService.GetFlashcard.bind(this.flashcardService),
      { card_id },
    );
  }

  @Get('list')
  async listFlashcards(
    @Query('page') page: number,
    @Query('limit') limit: number,
    @Query('userId') userId?: string,
    @Query('deckId') deckId?: string,
  ) {
    return await this.gatewayService.dispatchGrpcRequest(
      this.flashcardService.ListFlashcards.bind(this.flashcardService),
      { page, limit, userId, deckId },
    );
  }

  @Patch('update/:card_id')
  async updateFlashcard(
    @Param('card_id') card_id: string,
    @Body() body: UpdateFlashcardDto,
  ) {
    return await this.gatewayService.dispatchGrpcRequest(
      this.flashcardService.UpdateFlashcard.bind(this.flashcardService),
      { card_id, ...body },
    );
  }

  @Delete('delete/:card_id')
  async deleteFlashcard(@Param('card_id') card_id: string) {
    return await this.gatewayService.dispatchGrpcRequest(
      this.flashcardService.DeleteFlashcard.bind(this.flashcardService),
      { card_id },
    );
  }

  // Flashcard Deck endpoints
  @Post('deck/create')
  async createFlashcardDeck(@Body() body: CreateFlashcardDeckDto) {
    return await this.gatewayService.dispatchGrpcRequest(
      this.flashcardService.CreateFlashcardDeck.bind(this.flashcardService),
      body,
    );
  }

  @Get('deck/get/:deck_id')
  async getFlashcardDeck(@Param('deck_id') deck_id: string) {
    return await this.gatewayService.dispatchGrpcRequest(
      this.flashcardService.GetFlashcardDeck.bind(this.flashcardService),
      { deck_id },
    );
  }

  @Get('deck/list')
  async listFlashcardDecks(
    @Query('page') page: number,
    @Query('limit') limit: number,
    @Query('userId') userId?: string,
  ) {
    return await this.gatewayService.dispatchGrpcRequest(
      this.flashcardService.ListFlashcardDecks.bind(this.flashcardService),
      { page, limit, userId },
    );
  }

  @Patch('deck/update/:deck_id')
  async updateFlashcardDeck(
    @Param('deck_id') deck_id: string,
    @Body() body: UpdateFlashcardDeckDto,
  ) {
    return await this.gatewayService.dispatchGrpcRequest(
      this.flashcardService.UpdateFlashcardDeck.bind(this.flashcardService),
      { deck_id, ...body },
    );
  }

  @Delete('deck/delete/:deck_id')
  async deleteFlashcardDeck(@Param('deck_id') deck_id: string) {
    return await this.gatewayService.dispatchGrpcRequest(
      this.flashcardService.DeleteFlashcardDeck.bind(this.flashcardService),
      { deck_id },
    );
  }
}
