// apps/moderation/src/google.provider.ts
import { Injectable, Logger } from '@nestjs/common';
import { GoogleGenerativeAI, GenerativeModel } from '@google/generative-ai';
import { ConfigService } from '@nestjs/config';
import { Response } from '@app/helpers/response';
import type { MulterFile } from '@app/dto';
@Injectable()
export class GoogleModerationProvider {
  private readonly model: GenerativeModel;
  private readonly logger = new Logger(GoogleModerationProvider.name);

  constructor(private cfg: ConfigService) {
    const client = new GoogleGenerativeAI(
      cfg.get<string>('google.apiKey') || '',
    );
    this.model = client.getGenerativeModel({
      model: cfg.get<string>('google.model') ?? 'gemini-1.5-flash',
    });
  }

  async moderate(text: string) {
    if (!text || text.length > 10000) {
      return {
        provider: 'google',
        verdict: 'review',
        error: 'Văn bản không hợp lệ',
        categories: [],
      };
    }

    try {
      const start = Date.now();
      const response = await this.model.generateContent(text);
      const latencyMs = Date.now() - start;
      return Response.success(
        response,
        'Moderation completed successfully',
        200,
        'OK',
      );
    } catch (err) {
      this.logger.error('Lỗi moderation:', err.message);
      return Response.error('Lỗi xử lý', 400, 'Bad input');
    }
  }

  async summaryDocument(file: MulterFile) {
    const contents = [
      { text: 'Tóm tắt tài liệu sau: ' },
      {
        inlineData: {
          mimeType: file.mimetype,
          data: Buffer.from(file.buffer).toString('base64'),
        },
      },
    ];
    try {
      const result = await this.model.generateContent(contents);
      return Response.success(
        result.response.text(),
        'Tóm tắt tài liệu thành công',
        200,
        'OK',
      );
    } catch (err) {
      this.logger.error('Lỗi summary document:', err.message);
      return Response.error('Lỗi xử lý tóm tắt tài liệu', 400, 'Bad input');
    }
  }

  async translation(text: string, from: string, to: string) {
    const prompt = `
    Role: Bạn là một biên dịch viên chuyên nghiệp.
    Nhiệm vụ: Dịch văn bản bên dưới từ ngôn ngữ '${from}' sang ngôn ngữ '${to}'.

    YÊU CẦU QUAN TRỌNG:
    1. Giữ nguyên các thuật ngữ chuyên ngành tiếng Anh nếu có.
    2. Văn phong: Dễ hiểu, không quá chuyên sâu.
    3. Định dạng: Giữ nguyên cấu trúc dòng, bullet points.

    INPUT TEXT:
    """
    ${text}
    """

    OUTPUT FORMAT:
    Trả về duy nhất 1 chuỗi JSON hợp lệ (không markdown) theo cấu trúc:
    { "translated_text": "Nội dung đã dịch ở đây" }
  `;

    try {
      // 2. Cấu hình gọi model
      const result = await this.model.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: 'application/json', // Ép buộc trả về JSON
          temperature: 0.3, // Giảm sáng tạo để dịch chính xác hơn
        },
      });

      // 3. Xử lý kết quả trả về
      const jsonString = result.response.text();
      const parsedResult = JSON.parse(jsonString); // Parse chuỗi JSON thành Object

      return Response.success(
        parsedResult.translated_text, // Chỉ trả về chuỗi text đã dịch sạch sẽ
        'Dịch thành công',
        200,
        'OK',
      );
    } catch (err) {
      this.logger.error('Lỗi translation:', err.message);

      // Fallback: Nếu lỗi JSON parse hoặc lỗi API, trả về nguyên nhân
      return Response.error(
        'Không thể dịch văn bản lúc này',
        400,
        'Bad input or Model Error',
      );
    }
  }
}
