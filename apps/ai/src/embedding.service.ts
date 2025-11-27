import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import crypto from 'crypto';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { ConfigService } from '@nestjs/config';
import { AIEmbedding } from 'libs/db/src/mongo/model/AIEmbedding.model';

@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);
  private readonly gemini: GoogleGenerativeAI;

  constructor(
    private cfg: ConfigService,
    @InjectModel(AIEmbedding.name)
    private readonly embedModel: Model<AIEmbedding>,
  ) {
    this.gemini = new GoogleGenerativeAI(
      cfg.get<string>('google.apiKey') || '',
    );
  }

  /** Tạo hash duy nhất cho text */
  private hashText(text: string): string {
    return crypto
      .createHash('sha256')
      .update(text.trim().toLowerCase())
      .digest('hex');
  }

  /**
   * Lọc rác với AI
   * @param text Nội dung tin nhắn
   * @returns true nếu tin nhắn đủ "chất lượng"
   */
  private async checkRelevanceWithAI(text: string): Promise<boolean> {
    try {
      // Dùng model Flash: Nhanh như điện, rẻ như cho
      const model = this.gemini.getGenerativeModel({
        model: 'gemini-1.5-flash',
      });

      const prompt = `
        Đóng vai trò là Người quản lý dữ liệu cho Ứng dụng nhắn tin.
        Phân tích tin nhắn sau và quyết định xem nó có chứa thông tin CÓ GIÁ TRỊ đáng lưu trữ để truy xuất trong tương lai hay không (Tìm kiếm/RAG).
        
        Tiêu chí cho GIỮ LẠI (ĐÚNG):
          - Chứa thông tin, sự kiện, lịch trình, hạn chót.
          - Chứa các giải pháp kỹ thuật, mã, quyết định.
          - Chứa địa chỉ cụ thể, thông tin liên hệ, danh từ riêng.
          - Chứa ý kiến ​​hoặc phản hồi có ý nghĩa.

       Tiêu chí cho HỦY BỎ (SAI):
          - Lời chào thân mật ("Xin chào", "Chào buổi sáng").
          - Biểu cảm pha trộn ("Được", "Tôi hiểu rồi", "Tuyệt vời", "Hahaha").
          - Điều phối lịch trình không có kết luận ("Bạn rảnh không?", "Khi nào?").
          - Khiếu nại/cảm xúc không có ngữ cảnh.
          - Tin nhắn chỉ chứa link (không có ngữ nghĩa để search)
          - Tin nhắn chỉ chứa lệnh (commands)

        Tin nhắn: "${text}"

        Trả về một đối tượng JSON chính xác: { "keep": boolean }
      `;

      const result = await model.generateContent(prompt);
      const responseText = result.response.text();

      // Clean chuỗi json (phòng trường hợp AI trả về markdown ```json ... ```)
      const cleanJson = responseText.replace(/```json|```/g, '').trim();
      const decision = JSON.parse(cleanJson);

      return decision.keep === true;
    } catch (e) {
      this.logger.warn(
        `AI lọc rác lỗi cho tin nhắn: "${text}". Để an toàn, giữ lại.`,
      );
      return true;
    }
  }

  /**
   * Bộ lọc: Kiểm tra xem tin nhắn có đáng để Embed không?
   * @returns true nếu tin nhắn đủ "chất lượng"
   */
  private async isMessageWorthy(text: string): Promise<boolean> {
    if (!text) return false;
    const cleanText = text.trim();

    // Loại bỏ tin nhắn quá ngắn (dưới 5 từ) -> Tiết kiệm chi phí & bộ nhớ
    const wordCount = cleanText.split(/\s+/).length;
    if (wordCount < 5) return false;

    // Loại bỏ tin chỉ chứa link (không có ngữ nghĩa để search)
    const urlRegex = /^(http|https):\/\/[^ "]+$/;
    if (urlRegex.test(cleanText)) return false;

    // Loại bỏ lệnh (commands)
    if (cleanText.startsWith('/')) return false;

    const isUseful = await this.checkRelevanceWithAI(text);
    // lọc thêm với AI
    if (!isUseful) {
      this.logger.debug(`Skipped (AI Filter): ${text}`);
      return false;
    }

    return true;
  }

  /** Tạo vector từ Google Gemini */
  async generateVector(text: string): Promise<number[]> {
    try {
      // dùng 'text-embedding-004' nếu key mới hỗ trợ
      const model = this.gemini.getGenerativeModel({
        model: 'text-embedding-004',
      });
      const res = await model.embedContent(text);
      return res.embedding.values;
    } catch (err) {
      this.logger.error(`⚠️ Gemini embedding failed: ${err.message}`);
      throw err;
    }
  }

  /**
   * Tạo vector và lưu vào DB cho 1 tin nhắn chat
   * @param text Nội dung tin nhắn
   * @param roomId ID của phòng chat (để link ngược lại)
   * @param messageId ID của tin nhắn chat (để link ngược lại)
   * @param userId ID người gửi
   */
  async createChatMessageEmbedding(
    text: string,
    roomId: string,
    messageId: string,
  ) {
    // Lọc rác
    if (!(await this.isMessageWorthy(text))) {
      this.logger.debug(`Skipped unworthy message content: ${text}`);
      return;
    }

    try {
      const exists = await this.embedModel.exists({
        contextId: roomId,
        contextType: 'room',
        messageId: messageId,
      });
      if (exists) return;

      // Tạo vector
      const vector = await this.generateVector(text);
      const hash = this.hashText(text);

      await this.embedModel.create({
        service: 'chat',
        provider: 'google',
        model: 'text-embedding-004',
        contextType: 'room', // Đánh dấu đây là tin nhắn chat
        contextId: roomId, // Link với bảng Message gốc
        messageId: messageId, // Link với bảng Message gốc
        text: text,
        hash: hash,
        vector: vector,
      });

      this.logger.log(`✅ Embedded message ${messageId}`);
    } catch (error) {
      this.logger.error(`Failed to index message ${messageId}`, error);
    }
  }

  /**
   * Xóa vector từ Google Gemini
   * @param roomId ID của phòng chat
   * @param messageId ID của tin nhắn chat
   */
  async deleteVectorChat(roomId: string, messageId: string) {
    try {
      const result = await this.embedModel.deleteOne({
        contextId: roomId,
        contextType: 'room',
        messageId: messageId,
      });
      if (result.deletedCount > 0) {
        this.logger.log(`🗑️ Deleted vector for message ${messageId}`);
      }
    } catch (error) {
      this.logger.error(`Failed to delete vector ${messageId}`, error);
    }
  }

  /**
   * Tìm tin nhắn cũ có ý nghĩa tương đồng
   * @param query Câu hỏi/từ khóa của người dùng
   * @param limit Số lượng kết quả
   * @param roomId ID của phòng chat
   */
  async searchSimilarMessages(query: string, limit = 5, roomId: string) {
    // 1. Embed câu query của người dùng để lấy vector so sánh
    const queryVector = await this.generateVector(query);

    const pipeline: any[] = [
      {
        $vectorSearch: {
          index: 'vector_index', // Tên Index bạn đặt trên Atlas
          path: 'vector', // Tên trường chứa vector trong Schema
          queryVector: queryVector,
          numCandidates: limit * 10, // Quét rộng hơn để tăng độ chính xác
          limit: limit,
        },
      },
    ];

    const matchStage: any = {
      contextType: 'room',
      contextId: roomId,
    };

    pipeline.push({ $match: matchStage });

    pipeline.push({
      $project: {
        _id: 0,
        text: 1,
        contextId: 1, // Để frontend biết là tin nhắn nào
        createdAt: 1,
        score: { $meta: 'vectorSearchScore' }, // Điểm tương đồng (0 -> 1)
      },
    });
    return this.embedModel.aggregate(pipeline);
  }
}
