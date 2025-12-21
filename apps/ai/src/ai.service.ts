import { Injectable, Logger } from '@nestjs/common';
import { GoogleModerationProvider } from './google.provider';
import { Response } from '@app/helpers/response';
import { ConfigService } from '@nestjs/config';
import { GoogleGenerativeAI } from '@google/generative-ai';

@Injectable()
export class AIService {
  private readonly logger = new Logger(AIService.name);
  private readonly gemini: GoogleGenerativeAI;

  constructor(
    private readonly googleProvider: GoogleModerationProvider,
    private readonly cfg: ConfigService,
    // @InjectModel(AIUsageLog.name)
    // private readonly logModel: Model<AIUsageLog>,
  ) {
    this.gemini = new GoogleGenerativeAI(
      this.cfg.get<string>('google.apiKey') || '',
    );
  }

  async checkMessage(text: string, userId: string, contextId?: string) {
    console.log('🚀 ~ AIService ~ checkMessage ~ contextId:', contextId);
    console.log('🚀 ~ AIService ~ checkMessage ~ userId:', userId);
    const result = await this.googleProvider.moderate(text);
    return result;
  }

  async suggestReplies(messages: string[]): Promise<string[]> {
    // Suggest replies based on context
    console.log('🚀 ~ AIService ~ constructor ~  this.cfg:', this.cfg);
    try {
      if (!messages || messages.length === 0) return [];

      const model = this.gemini.getGenerativeModel({
        model: 'gemini-2.5-flash', // ✅ Tên chuẩn
        generationConfig: {
          responseMimeType: 'application/json', // ✅ Ép trả về JSON, bao mượt
        },
      });

      const prompt = `
        Dựa trên đoạn hội thoại sau đây, hãy gợi ý 3 câu trả lời ngắn gọn, tự nhiên và phù hợp ngữ cảnh (bằng tiếng Việt).
        Chỉ trả về danh sách 3 câu trả lời, ngăn cách bởi dấu gạch đứng "|". Không thêm bất kỳ dẫn giải nào.

        Hội thoại:
        ${messages.map((m) => `- ${m}`).join('\n')}

        Gợi ý:
      `;

      const result = await model.generateContent(prompt);
      const responseText = result.response.text();
      console.log(
        '🚀 ~ AIService ~ suggestReplies ~ responseText:',
        responseText,
      );

      // Tách chuỗi và lọc rác
      const suggestions = responseText
        .split('|')
        .map((s) => s.trim())
        .filter((s) => s.length > 0 && s.length < 50) // Lọc câu quá dài
        .slice(0, 3);

      return suggestions;
    } catch (error: any) {
      if (error?.status === 429) {
        this.logger.warn(
          'Gemini API rate limit exceeded. Returning empty suggestions.',
        );
        return [];
      }
      this.logger.error('Failed to suggest replies', error);
      return [];
    }
  }
}
