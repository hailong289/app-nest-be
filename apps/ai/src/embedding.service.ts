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
      // Dùng model Pro (stable API)
      const model = this.gemini.getGenerativeModel({
        model: 'gemini-2-5-flash',
      });

      const prompt = `
       Đóng vai trò là "Trình quản lý dữ liệu" cho một Ứng dụng nhắn tin có tích hợp tìm kiếm ngữ nghĩa (semantic search) và RAG.

Nhiệm vụ của bạn:
1. Phân tích nội dung tin nhắn.
2. Quyết định xem tin nhắn có đáng được LƯU LẠI để đưa vào kho tìm kiếm ngữ nghĩa/RAG hay không.
3. Nếu CÓ LƯU, hãy chuẩn hoá nội dung thành dạng dễ tìm kiếm: tóm tắt ngắn gọn, rút trích thông tin quan trọng, chuẩn hoá cách viết.

--- TIÊU CHÍ GIỮ LẠI (keep = true) ---
Giữ lại nếu tin nhắn chứa ÍT NHẤT MỘT trong các loại thông tin sau:
- Sự kiện, kế hoạch, lịch trình, deadline, mốc thời gian, nhắc việc.
- Thông tin kỹ thuật: giải pháp, ý tưởng, kiến trúc, quy trình, mã nguồn (code), lệnh có ngữ cảnh, cấu hình, kết quả thử nghiệm.
- Quyết định quan trọng: chốt phương án, chọn giải pháp, thay đổi rule, thay đổi cấu trúc dữ liệu, policy, quy định nội bộ...
- Thông tin nhận diện: địa chỉ, thông tin liên hệ, số điện thoại, email, tên riêng (tên người, tên dự án, tên service, tên repo...).
- Ý kiến / phản hồi có ý nghĩa: nhận xét chi tiết, góp ý thiết kế, review task, mô tả bug, mô tả behavior, feedback người dùng.
- Tri thức ổn định có thể tái sử dụng: hướng dẫn, checklist, best practice, quy tắc nghiệp vụ, định nghĩa khái niệm.

--- TIÊU CHÍ HỦY BỎ (keep = false) ---
Không lưu nếu tin nhắn:
- Chỉ là lời chào / xã giao: "hi", "hello", "chào buổi sáng", "ok bạn", "thanks", "hahaha", emoji, reaction...
- Chỉ thể hiện cảm xúc: "buồn quá", "mệt thật", "ghê vậy", "tệ vãi" mà không có ngữ cảnh cụ thể.
- Điều phối lịch hẹn chưa có kết luận: "khi nào họp?", "mai rảnh không?", "chiều gọi nhé?" (không có thời gian rõ ràng hoặc không chốt).
- Chỉ chứa link hoặc file mà không mô tả nội dung: "https://...", "file này nè".
- Chỉ chứa lệnh/command rời rạc KHÔNG có ngữ cảnh: "npm run dev", "git pull", "ls", "cd ..".
- Trùng lặp hoàn toàn với thông tin đã xuất hiện trước đó (spam, nhắc lại đúng y chang).

--- YÊU CẦU ĐẦU RA ---
Luôn trả về JSON HỢP LỆ, KHÔNG thêm text ngoài JSON.

Cấu trúc:
{
  "keep": boolean,              // true nếu nên lưu vào kho RAG, false nếu bỏ
  "reason": string,             // lý do ngắn gọn vì sao keep hoặc vì sao bỏ
  "normalized_text": string,    // NẾU keep = true: bản chuẩn hoá để indexing semantic search
  "tags": string[]              // danh sách tag gợi ý: ví dụ ["schedule", "deadline", "architecture", "bug", "code", "decision", "contact", "feedback"]
}

Quy tắc:
- Nếu keep = false:
  - "normalized_text" phải là chuỗi rỗng "".
  - "tags" phải là [].
- "normalized_text" nên:
  - Lược bỏ emoji, filler, tiếng lóng không cần thiết.
  - Giữ nguyên nội dung quan trọng, có thể rewrite lại cho rõ nghĩa hơn.
  - Ưu tiên dạng câu đầy đủ, dễ hiểu, dễ search.
- "reason" chỉ cần 1–2 câu ngắn.

--- VÍ DỤ NGẮN ---

Ví dụ 1:
Tin nhắn: "Chiều mai 15h họp review kiến trúc microservices, nhớ chuẩn bị sơ đồ sequence."

→ keep = true
→ normalized_text có thể là: "Họp review kiến trúc microservices lúc 15h chiều mai, cần chuẩn bị sơ đồ sequence."

Ví dụ 2:
Tin nhắn: "ok, để mai tính"

→ keep = false (chỉ là phản hồi mơ hồ, không có thông tin hữu ích để search sau này).

---

Tin nhắn đầu vào: "${text}"
Trả về MỘT đối tượng JSON DUY NHẤT như định dạng trên.

      `;

      const result = await model.generateContent(prompt);
      const responseText = result.response.text();

      // Clean chuỗi json (phòng trường hợp AI trả về markdown ```json ... ```)
      const cleanJson = responseText
        .replaceAll('```json', '')
        .replaceAll('```', '')
        .trim();
      type AIRelevanceResponse = { keep: boolean };
      const decision = JSON.parse(cleanJson) as AIRelevanceResponse;

      return decision.keep === true;
    } catch (e) {
      this.logger.warn(
        `AI lọc rác lỗi cho tin nhắn: "${text}". Để an toàn, giữ lại. Error: ${e instanceof Error ? e.message : String(e)}`,
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
      const errorMsg =
        typeof err === 'object' && err !== null && 'message' in err
          ? (err as { message?: string }).message
          : String(err);
      this.logger.error(`⚠️ Gemini embedding failed: ${errorMsg}`);
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

      // Kiểm tra hash trùng trước khi insert
      const existingHash = await this.embedModel.exists({ hash });
      if (existingHash) {
        this.logger.debug(`Skipped duplicate hash for message ${messageId}`);
        return;
      }

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
   * @param roomId ID của phòng chat
   * @param limit Số lượng kết quả
   */
  /**
   * Tìm tin nhắn cũ có ý nghĩa tương đồng
   * @param query Câu hỏi/từ khóa của người dùng
   * @param roomId ID của phòng chat
   * @param limit Số lượng kết quả
   */
  async searchSimilarMessages(query: string, roomId: string, limit = 5) {
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
      {
        $match: {
          contextType: 'room',
          contextId: roomId,
        },
      },
      {
        $project: {
          _id: 0,
          text: 1,
          contextId: 1,
          messageId: 1, // Quan trọng: Để FE biết tin nhắn nào
          createdAt: 1,
          score: { $meta: 'vectorSearchScore' },
        },
      },
    ];

    return this.embedModel.aggregate(pipeline);
  }

  /**
   * Tạo vector và lưu vào DB cho Document
   * @param text Nội dung plain text của document
   * @param docId ID của document
   * @param userId ID người tạo/sửa
   */
  async createDocumentEmbedding(text: string, docId: string, userId: string) {
    if (!text || text.trim().length < 10) {
      this.logger.debug(`Skipped short document content: ${docId}`);
      return;
    }

    try {
      // Xóa embedding cũ của doc này (nếu có) để update mới
      await this.embedModel.deleteMany({
        contextId: docId,
        contextType: 'doc',
      });

      // Tạo vector
      const vector = await this.generateVector(text);
      const hash = this.hashText(text);

      await this.embedModel.create({
        service: 'document',
        provider: 'google',
        model: 'text-embedding-004',
        contextType: 'doc',
        contextId: docId,
        userId: userId,
        text: text, // Lưu text gốc (hoặc tóm tắt nếu cần)
        hash: hash,
        vector: vector,
      });

      this.logger.log(`✅ Embedded document ${docId}`);
    } catch (error) {
      this.logger.error(`Failed to index document ${docId}`, error);
    }
  }

  /**
   * Tìm kiếm document theo ngữ nghĩa
   * @param query Câu hỏi/từ khóa
   * @param userId ID user (để check quyền - TODO)
   * @param limit Số lượng kết quả
   */
  async searchSimilarDocuments(query: string, userId: string, limit = 5) {
    const queryVector = await this.generateVector(query);

    const pipeline: any[] = [
      {
        $vectorSearch: {
          index: 'vector_index',
          path: 'vector',
          queryVector: queryVector,
          numCandidates: limit * 10,
          limit: limit,
        },
      },
      {
        $match: {
          contextType: 'doc',
          // TODO: Thêm logic check quyền (ví dụ: userId == ownerId hoặc doc public)
          // Hiện tại tạm thời search all docs
        },
      },
      {
        $project: {
          _id: 0,
          text: 1,
          contextId: 1,
          score: { $meta: 'vectorSearchScore' },
        },
      },
    ];

    return this.embedModel.aggregate(pipeline);
  }
}
