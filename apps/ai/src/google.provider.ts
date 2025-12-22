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
      this.cfg.get<string>('google.apiKey') || '',
    );
    this.model = client.getGenerativeModel({
      model: this.cfg.get<string>('google.model') || 'gemini-2.5-flash-lite',
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

  async suggestReplies(messages: string[]) {
    try {
      if (!messages || messages.length === 0)
        return { suggestions: [], emojis: [], gif_keywords: [] };

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

      const result = await this.model.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 0.4,
        },
      });
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
      if (error?.status === 429) {
        this.logger.warn('Gemini API rate limit exceeded.');
        return { suggestions: [], emojis: [], gif_keywords: [] };
      }
      this.logger.error('Failed to suggest replies', error);
      return { suggestions: [], emojis: [], gif_keywords: [] };
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

  async generateQuizz(
    file: MulterFile,
    text: string,
    type: 'text' | 'document',
  ) {
    const prompt = `
    Role: Bạn là một chuyên gia soạn đề thi. 
    Nhiệm vụ: Phân tích nội dung được cung cấp, sau đó tạo ra một bộ câu hỏi trắc nghiệm và trả về kết quả dưới định dạng JSON chuẩn (Raw JSON), không kèm theo bất kỳ văn bản dẫn dắt nào khác (như "Dưới đây là JSON...").
    Loại nội dung: ${type}
    **1. Nhiệm vụ cụ thể:**
- Đọc kỹ nội dung đầu vào.
- Trích xuất các ý chính, khái niệm quan trọng để đặt câu hỏi.
- Tự động tạo quiz_title và quiz_description phù hợp với nội dung tổng quan.
- Tạo danh sách câu hỏi quiz_questions với logic đúng/sai dựa trên nội dung.

**2. Quy tắc dữ liệu:**
- question_type: Mặc định là "single_choice" (trừ khi nội dung yêu cầu chọn nhiều).
- points: Mặc định là 10 điểm cho mỗi câu.
- explanation: Giải thích ngắn gọn tại sao đáp án đó đúng dựa trên văn bản gốc.
- order: Đánh số thứ tự tăng dần bắt đầu từ 1.
- Ngôn ngữ: Tiếng Việt (trừ khi nội dung đầu vào hoàn toàn là tiếng Anh thì giữ nguyên tiếng Anh).

**3. Cấu trúc JSON bắt buộc:**
Kết quả trả về phải tuân thủ chính xác Schema sau:

{
  "quiz_title": "String - Tiêu đề bài trắc nghiệm",
  "quiz_description": "String - Mô tả ngắn về nội dung bài kiểm tra",
  "quiz_questions": [
    {
      "question_text": "String - Nội dung câu hỏi",
      "question_type": "single_choice",
      "points": 10,
      "order": 1,
      "explanation": "String - Giải thích đáp án",
      "answers": [
        { "answer_text": "String - Đáp án A", "is_correct": boolean },
        { "answer_text": "String - Đáp án B", "is_correct": boolean },
        { "answer_text": "String - Đáp án C", "is_correct": boolean },
        { "answer_text": "String - Đáp án D", "is_correct": boolean }
      ]
    }
  ]
}

**4. Dữ liệu đầu vào:**
${type === 'text' ? text : `Tải file lên: ${file.originalname}`}
    `;

    try {
      const result = await this.model.generateContent({
        contents: [
          {
            role: 'user',
            parts: [
              { text: prompt },
              type === 'document'
                ? {
                    inlineData: {
                      mimeType: file.mimetype,
                      data: Buffer.from(file.buffer).toString('base64'),
                    },
                  }
                : { text: text },
            ],
          },
        ],
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: 0.4,
        },
      });

      const jsonString = result.response.text();
      const parsedResult = JSON.parse(jsonString);

      return Response.success(
        parsedResult,
        'Tạo câu hỏi trắc nghiệm thành công',
        200,
        'OK',
      );
    } catch (err) {
      this.logger.error('Lỗi generate quizz:', err.message);
    }
    return Response.error(
      'Không thể tạo câu hỏi trắc nghiệm lúc này',
      400,
      'Bad input',
    );
  }
}
