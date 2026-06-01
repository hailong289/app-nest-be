import {
  Body,
  Controller,
  Headers,
  Inject,
  OnModuleInit,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ClientGrpc } from '@nestjs/microservices';
import type { Observable } from 'rxjs';
import { SERVICES } from '@app/constants/services';
import { GatewayService } from '../gateway/gateway.service';
import { Response } from 'libs/helpers/response';

type LearningCardType = 'quiz' | 'flashcard_deck' | 'todo_project';

interface QuizzGrpcService {
  GetQuizz(data: { quiz_id: string }): Observable<unknown>;
}

interface FlashcardGrpcService {
  GetFlashcardDeck(data: { deck_id: string }): Observable<unknown>;
}

interface TodoGrpcService {
  GetProject(data: { project_id: string }): Observable<unknown>;
}

@Controller('internal/learning')
export class GatewayInternalLearningController implements OnModuleInit {
  private quizzService!: QuizzGrpcService;
  private flashcardService!: FlashcardGrpcService;
  private todoService!: TodoGrpcService;

  constructor(
    @Inject(SERVICES.LEARNING) private readonly learningClient: ClientGrpc,
    private readonly gatewayService: GatewayService,
    private readonly configService: ConfigService,
  ) {}

  onModuleInit() {
    this.quizzService =
      this.learningClient.getService<QuizzGrpcService>('QuizzService');
    this.flashcardService =
      this.learningClient.getService<FlashcardGrpcService>('FlashcardService');
    this.todoService =
      this.learningClient.getService<TodoGrpcService>('TodoService');
  }

  @Post('cards/hydrate')
  async hydrateCards(
    @Body()
    body: { items: Array<{ type: LearningCardType; id: string }> },
    @Headers('x-internal-service') internalService?: string,
    @Headers('x-internal-secret') internalSecret?: string,
  ) {
    this.assertInternalRequest(internalService, internalSecret);

    const items = await Promise.all(
      (body.items || []).map(async (item) => {
        const response = (await this.fetchCard(item.type, item.id)) as {
          statusCode?: number;
          metadata?: Record<string, unknown>;
        };
        return {
          ...item,
          found: response?.statusCode === 200 && Boolean(response.metadata),
          metadata: response?.metadata || null,
        };
      }),
    );

    return Response.success({ items }, 'Hydrate learning cards thành công');
  }

  private fetchCard(type: LearningCardType, id: string) {
    if (type === 'quiz') {
      return this.gatewayService.dispatchGrpcRequest(
        this.quizzService.GetQuizz.bind(this.quizzService),
        { quiz_id: id },
        30000,
      );
    }
    if (type === 'flashcard_deck') {
      return this.gatewayService.dispatchGrpcRequest(
        this.flashcardService.GetFlashcardDeck.bind(this.flashcardService),
        { deck_id: id },
        30000,
      );
    }
    return this.gatewayService.dispatchGrpcRequest(
      this.todoService.GetProject.bind(this.todoService),
      { project_id: id },
      30000,
    );
  }

  private assertInternalRequest(
    internalService?: string,
    internalSecret?: string,
  ) {
    if (internalService !== 'chat') {
      throw new UnauthorizedException('Invalid internal service');
    }

    const expectedSecret =
      this.configService.get<string>('GATEWAY_INTERNAL_SECRET') || '';
    if (expectedSecret && internalSecret !== expectedSecret) {
      throw new UnauthorizedException('Invalid internal secret');
    }
  }
}
