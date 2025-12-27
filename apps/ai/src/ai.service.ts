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
    const result = await this.googleProvider.moderate(text);
    return result;
  }

  async suggestReplies(messages: string[]): Promise<{
    suggestions: string[];
    emojis: string[];
    gif_keywords: string[];
  }> {
    try {
      if (!messages || messages.length === 0)
        return { suggestions: [], emojis: [], gif_keywords: [] };

      // 1. Dùng tên model chuẩn + Config JSON mode
      const model = this.gemini.getGenerativeModel({
        model: 'gemini-2.5-flash', // ✅ Tên chuẩn
        generationConfig: {
          responseMimeType: 'application/json', // ✅ Ép trả về JSON, bao mượt
        },
      });

      // 2. Prompt định hướng rõ ràng hơn
      const prompt = `
        Bạn là một trợ lý AI thông minh, chuyên gợi ý tin nhắn nhanh cho người dùng Gen Z.
        Dựa trên đoạn hội thoại dưới đây, hãy đưa ra:
        1. 3 phương án trả lời ngắn gọn (dưới 10 từ), tự nhiên, đời thường.
        2. 5 emoji phù hợp với ngữ cảnh.
        3. 3 từ khóa tiếng Anh để tìm kiếm GIF phù hợp với cảm xúc của hội thoại.
        
        Yêu cầu output JSON format:
        {
          "suggestions": ["string", "string", "string"],
          "emojis": ["string", "string", "string", "string", "string"],
          "gif_keywords": ["string", "string", "string"]
        }
        
        Tone giọng: Thân thiện, nhanh gọn, có thể dùng từ lóng nhẹ nhàng nếu hợp ngữ cảnh.

        Hội thoại:
        ${messages.map((m) => `- ${m}`).join('\n')}
      `;

      const result = await model.generateContent(prompt);
      const responseText = result.response.text();

      // 3. Parse JSON an toàn
      let parsedData: {
        suggestions: string[];
        emojis: string[];
        gif_keywords: string[];
      } = { suggestions: [], emojis: [], gif_keywords: [] };
      try {
        parsedData = JSON.parse(responseText) as {
          suggestions: string[];
          emojis: string[];
          gif_keywords: string[];
        };
      } catch (e) {
        console.warn('Lỗi parse JSON', e);
      }

      // 4. Validate cuối cùng
      return {
        suggestions: Array.isArray(parsedData.suggestions)
          ? parsedData.suggestions.slice(0, 3)
          : [],
        emojis: Array.isArray(parsedData.emojis)
          ? parsedData.emojis.slice(0, 5)
          : [],
        gif_keywords: Array.isArray(parsedData.gif_keywords)
          ? parsedData.gif_keywords.slice(0, 3)
          : [],
      };
    } catch (error: any) {
      this.logger.error('Failed to suggest replies', error);
      return { suggestions: [], emojis: [], gif_keywords: [] };
    }
  }
}
