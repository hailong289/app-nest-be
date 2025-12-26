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
      model: cfg.get<string>('google.model') ?? 'gemini-2.5-flash',
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
    // 1. Soạn Prompt chi tiết để AI tóm tắt có cấu trúc
    const prompt = `
  Role: Bạn là chuyên gia phân tích và tổng hợp thông tin.
  Nhiệm vụ: Đọc tài liệu đính kèm và tạo bản tóm tắt nội dung chính.

  YÊU CẦU ĐẦU RA (JSON FORMAT):
  Hãy trả về một object JSON duy nhất (không markdown) với cấu trúc sau:
  {
    "title": "Tiêu đề ngắn gọn phù hợp với nội dung tài liệu",
    "summary": "Đoạn văn tóm tắt tổng quan khoảng 2-3 câu",
    "key_points": [
      "Ý chính 1",
      "Ý chính 2",
      "Ý chính 3 (Tối đa 5-7 ý chính quan trọng nhất)"
    ],
    "language": "Ngôn ngữ chính của tài liệu (ví dụ: Tiếng Việt, Tiếng Anh)"
  }
  
  Lưu ý: Nếu tài liệu là tiếng nước ngoài, hãy dịch phần tóm tắt sang Tiếng Việt.
`;

    // 2. Cấu trúc request gửi lên Gemini
    const contents = [
      {
        role: 'user',
        parts: [
          { text: prompt }, // Gửi prompt hướng dẫn
          {
            inlineData: {
              mimeType: file.mimetype,
              data: Buffer.from(file.buffer).toString('base64'), // Gửi file binary
            },
          },
        ],
      },
    ];

    try {
      // 3. Gọi model với config JSON
      const result = await this.model.generateContent({
        contents: contents,
        generationConfig: {
          temperature: 0.4, // Giữ mức sáng tạo vừa phải để tóm tắt chính xác
          responseMimeType: 'application/json', // Bắt buộc trả về JSON
        },
      });

      // 4. Parse kết quả
      const jsonString = result.response.text();
      const parsedData = JSON.parse(jsonString);

      console.log('parsedData', parsedData);

      // Map data để đảm bảo đúng structure với proto (keyPoints thay vì key_points)
      const metadata = {
        summary: parsedData.summary || '',
        title: parsedData.title || '',
        keyPoints: parsedData.key_points || parsedData.keyPoints || [],
        language: parsedData.language || '',
      };

      return Response.success(
        metadata, // Trả về object đã structure đúng với proto
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
