import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, FilterQuery, Types } from 'mongoose';
import crypto from 'crypto';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { ConfigService } from '@nestjs/config';
import { AIEmbedding } from 'libs/db/src/mongo/model/AIEmbedding.model';
import { Attachment } from 'libs/db/src/mongo/model/Attachment.model';
import { Document } from 'libs/db/src/mongo/model/Document.model';
import { Message } from 'libs/db/src/mongo/model/messages.model';
import axios from 'axios';
import Utils from '@app/helpers/utils';

/**
 * Strip Vietnamese diacritics + lowercase. Mirrors the `normalizeVi` hook in
 * messages.model.ts so a query like "tin nhan" matches stored
 * `msg_content_norm` for "tin nhắn".
 */
function normalizeVi(s = ''): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();
}

@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);
  private readonly gemini: GoogleGenerativeAI;

  constructor(
    private cfg: ConfigService,
    @InjectModel(AIEmbedding.name)
    private readonly embedModel: Model<AIEmbedding>,
    @InjectModel(Attachment.name)
    private readonly attachmentModel: Model<Attachment>,
    @InjectModel(Document.name)
    private readonly documentModel: Model<Document>,
    @InjectModel(Message.name)
    private readonly messageModel: Model<Message>,
  ) {
    if (typeof global.crypto === 'undefined') {
      (global as any).crypto = crypto;
    }
    this.gemini = new GoogleGenerativeAI(
      this.cfg.get<string>('google.apiKey') || '',
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
        model: 'gemini-2.5-flash',
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
    return this.createEmbedding({
      text,
      contextId: roomId,
      contextType: 'room',
      service: 'chat',
      messageId,
      cleanContent: true,
      replaceOld: false,
    });
  }

  /**
   * Xóa vector từ Google Gemini
   * @param roomId ID của phòng chat
   * @param messageId ID của tin nhắn chat
   */
  async deleteVectorChat(roomId: string, messageId: string) {
    try {
      const result = await this.embedModel.deleteOne({
        contextId: Utils.convertToObjectIdMongoose(roomId),
        contextType: 'room',
        messageId: Utils.convertToObjectIdMongoose(messageId),
      });
      if (result.deletedCount > 0) {
        this.logger.log(`🗑️ Deleted vector for message ${messageId}`);
      }
    } catch (error) {
      this.logger.error(`Failed to delete vector ${messageId}`, error);
    }
  }

  /**
   * Xóa toàn bộ cache embeddings (Dùng cho dev/debug)
   */
  async clearAllEmbeddings() {
    try {
      const result = await this.embedModel.deleteMany({});
      this.logger.warn(`⚠️ Cleared all ${result.deletedCount} embeddings!`);
      return { deleted: result.deletedCount };
    } catch (error) {
      this.logger.error('Failed to clear embeddings', error);
      throw error;
    }
  }

  /**
   * Tìm tin nhắn cũ có ý nghĩa tương đồng
   * @param query Câu hỏi/từ khóa của người dùng
   * @param roomId ID của phòng chat
   * @param limit Số lượng kết quả
   */
  /**
   * Tính Cosine Similarity giữa 2 vector
   */
  private cosineSimilarity(vecA: number[], vecB: number[]): number {
    if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < vecA.length; i++) {
      dotProduct += vecA[i] * vecB[i];
      normA += vecA[i] * vecA[i];
      normB += vecB[i] * vecB[i];
    }
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  /**
   * Tìm tin nhắn cũ có ý nghĩa tương đồng
   * @param query Câu hỏi/từ khóa của người dùng
   * @param roomId ID của phòng chat
   * @param limit Số lượng kết quả
   */
  async searchSimilarMessages(query: string, roomId: string, limit = 5) {
    type SearchResult = {
      text: string;
      contextId: string;
      messageId: string;
      createdAt: Date;
      score: number;
    };
    const roomObjectId = Utils.convertToObjectIdMongoose(roomId);

    try {
      // 1. Lấy danh sách file và doc thuộc room này
      const [fileIds, docIds] = await Promise.all([
        this.attachmentModel
          .find({ room_id: roomObjectId })
          .distinct('_id')
          .exec(),
        this.documentModel
          .find({ roomIds: roomObjectId })
          .distinct('_id')
          .exec(),
      ]);

      this.logger.log(
        `Search in Room ${roomId}: Found ${fileIds.length} files, ${docIds.length} docs`,
      );

      // 2. Chuẩn bị Vector Search Pipeline
      const queryVector = await this.generateVector(query);
      const vectorPipeline: any[] = [
        {
          $vectorSearch: {
            index: 'vector_index',
            path: 'vector',
            queryVector: queryVector,
            numCandidates: limit * 20,
            limit: limit * 2,
          },
        },
        {
          $match: {
            $or: [
              { contextType: 'room', contextId: roomObjectId },
              { contextType: 'file', contextId: { $in: fileIds } },
              { contextType: 'doc', contextId: { $in: docIds } },
            ],
          },
        },
        {
          $project: {
            _id: 0,
            text: 1,
            contextId: 1,
            messageId: 1,
            createdAt: 1,
            score: { $meta: 'vectorSearchScore' },
          },
        },
      ];

      // 3. Chuẩn bị Keyword Search (Regex) Query
      // Tìm kiếm chính xác từ khóa để đảm bảo không bỏ sót
      const keywordQuery = {
        $or: [
          { contextType: 'room', contextId: roomObjectId },
          { contextType: 'file', contextId: { $in: fileIds } },
          { contextType: 'doc', contextId: { $in: docIds } },
        ],
        text: { $regex: Utils.escapeRegex(query), $options: 'i' },
      };

      // 4. Chạy song song (Hybrid Search)
      const [vectorResults, keywordResults] = await Promise.all([
        this.embedModel
          .aggregate<SearchResult>(vectorPipeline)
          .catch(async (err: unknown) => {
            const errMsg = err instanceof Error ? err.message : String(err);
            this.logger.warn(
              `Vector search failed (likely local): ${errMsg}. Switching to manual Cosine Similarity.`,
            );

            // Manual Vector Search (Local Fallback)
            const candidates = await this.embedModel
              .find({
                $or: [
                  { contextType: 'room', contextId: roomObjectId },
                  { contextType: 'file', contextId: { $in: fileIds } },
                  { contextType: 'doc', contextId: { $in: docIds } },
                ],
              })
              .select('text contextId messageId createdAt vector')
              .lean()
              .exec();

            const scored = candidates.map((c) => ({
              ...c,
              score: this.cosineSimilarity(queryVector, c.vector),
            }));

            return scored
              .sort((a, b) => b.score - a.score)
              .slice(0, limit) as unknown as SearchResult[];
          }),
        this.embedModel
          .find(keywordQuery)
          .limit(limit)
          .select('-_id text contextId messageId createdAt')
          .lean()
          .exec()
          .then((docs) => {
            this.logger.log(
              `Keyword search found ${docs.length} results for "${query}"`,
            );
            return docs.map(
              (d) =>
                ({
                  ...d,
                  score: 1.5, // Hack: Ưu tiên kết quả khớp từ khóa chính xác cao hơn vector
                }) as unknown as SearchResult,
            );
          }),
      ]);
      // 5. Merge & Deduplicate
      const combined = [...keywordResults, ...vectorResults];
      const uniqueMap = new Map<string, SearchResult>();

      combined.forEach((item) => {
        // Key để deduplicate: messageId (nếu có) hoặc contextId (cho doc)
        const key = item.messageId
          ? item.messageId.toString()
          : item.contextId.toString();

        if (!uniqueMap.has(key)) {
          uniqueMap.set(key, item);
        } else {
          // Nếu trùng, giữ lại cái có score cao hơn
          const existing = uniqueMap.get(key)!;
          if (item.score > existing.score) {
            uniqueMap.set(key, item);
          }
        }
      });

      // 6. Sort & Drop system-message hits, then limit.
      // AIEmbeddings may have been generated for system messages (member
      // added, call started, ...) but users searching chat content don't
      // want those. Look up messageId → msg_type and filter post-hoc so we
      // don't have to alter the vector pipeline `$match` stage.
      const sortedAll = Array.from(uniqueMap.values()).sort(
        (a, b) => b.score - a.score,
      );
      const messageIds = sortedAll
        .map((r) => r.messageId)
        .filter((id) => !!id);
      const systemMessageIds = new Set<string>();
      if (messageIds.length > 0) {
        const systemDocs = await this.messageModel
          .find(
            { _id: { $in: messageIds }, msg_type: 'system' },
            { _id: 1 },
          )
          .lean()
          .exec();
        systemDocs.forEach((d) =>
          systemMessageIds.add(String((d as { _id: unknown })._id)),
        );
      }

      const ranked = sortedAll
        .filter((r) => !systemMessageIds.has(String(r.messageId)))
        .slice(0, limit);

      // 7. Fallback: if no embeddings/vectors matched (room never indexed,
      // AI offline, etc.) fall back to a plain regex over Messages.msg_content_norm
      // — same UX as a regular keyword search.
      if (ranked.length === 0) {
        return this.fallbackKeywordSearchOnMessages(
          query,
          roomObjectId,
          limit,
        );
      }

      return ranked;
    } catch (error) {
      this.logger.error('Search failed, falling back to keyword search', error);
      return this.fallbackKeywordSearchOnMessages(
        query,
        Utils.convertToObjectIdMongoose(roomId),
        limit,
      );
    }
  }

  /**
   * Plain keyword search over the Messages collection — used as a fallback
   * when the AI/vector pipeline returns no hits (room not yet embedded, AI
   * service unavailable, ...). Searches against `msg_content_norm` (Vietnamese
   * diacritics-stripped index) so "tin nhan" matches "tin nhắn".
   */
  private async fallbackKeywordSearchOnMessages(
    query: string,
    roomObjectId: Types.ObjectId,
    limit: number,
  ) {
    const trimmed = query.trim();
    if (!trimmed) return [];

    try {
      const normalized = normalizeVi(trimmed);
      const safe = Utils.escapeRegex(normalized);

      const docs = await this.messageModel
        .find({
          msg_roomId: roomObjectId,
          msg_content_norm: { $regex: safe, $options: 'i' },
          deletedAt: null,
          // Exclude system messages (member added/left, call started/ended,
          // ...) — they're notifications, not actual chat content the user
          // would search for.
          msg_type: { $ne: 'system' },
        })
        .sort({ createdAt: -1 })
        .limit(limit)
        .select('_id msg_roomId msg_content createdAt')
        .lean()
        .exec();

      this.logger.log(
        `[Fallback] Keyword search on Messages found ${docs.length} hits for "${query}" in room ${roomObjectId.toString()}`,
      );

      return docs.map((d) => ({
        text: d.msg_content,
        contextId: d.msg_roomId,
        messageId: d._id,
        createdAt: d.createdAt,
        // Lower than vector hits (>=0.5) and lower than embedding-keyword hits
        // (1.5) — keeps fallback results visually distinct.
        score: 0.3,
      }));
    } catch (err) {
      this.logger.error(
        `[Fallback] Keyword search failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return [];
    }
  }

  /**
   * Tạo vector và lưu vào DB cho Document
   * @param text Nội dung plain text của document
   * @param docId ID của document
   * @param userId ID người tạo/sửa
   */
  /**
   * Hàm chung tạo embedding cho mọi loại (Chat, Doc, File...)
   */
  async createEmbedding(params: {
    text: string;
    contextId: string; // roomId hoặc docId
    contextType: string; // 'room', 'doc', 'file'
    service: string; // 'chat', 'document'
    userId?: string;
    messageId?: string;
    cleanContent?: boolean; // Có chạy AI lọc rác không? (Chat cần, Doc không cần)
    replaceOld?: boolean; // True: Xóa cũ tạo mới (Doc). False: Chỉ tạo mới nếu chưa có (Chat)
  }) {
    const {
      text,
      contextId,
      contextType,
      service,
      userId,
      messageId,
      cleanContent = false,
      replaceOld = false,
    } = params;

    if (!text) return;

    // 1. Validate & Clean content
    if (cleanContent) {
      if (!(await this.isMessageWorthy(text))) {
        this.logger.debug(
          `Skipped unworthy content: ${text.substring(0, 50)}...`,
        );
        return;
      }
    } else {
      if (text.trim().length < 2) {
        this.logger.debug(`Skipped short content: ${contextId}`);
        return;
      }
    }

    try {
      // 2. Xử lý dữ liệu cũ (Update mode)
      if (replaceOld) {
        await this.embedModel.deleteMany({
          contextId: Utils.convertToObjectIdMongoose(contextId),
          contextType: contextType,
        });
      } else {
        // Append mode: Check exist
        const query: FilterQuery<AIEmbedding> = {
          contextId: Utils.convertToObjectIdMongoose(contextId),
          contextType: contextType,
        };
        if (messageId) {
          query.messageId = Utils.convertToObjectIdMongoose(messageId);
        }

        const exists = await this.embedModel.exists(query);
        if (exists) return;
      }

      // 3. Tạo Vector & Hash
      const vector = await this.generateVector(text);
      const hash = this.hashText(text);

      // Check duplicate hash (nếu không phải update mode)
      if (!replaceOld) {
        const existingHash = await this.embedModel.exists({ hash });
        if (existingHash) {
          this.logger.debug(`Skipped duplicate hash content`);
          return;
        }
      }

      // 4. Lưu vào DB
      try {
        await this.embedModel.create({
          service,
          provider: 'google',
          model: 'text-embedding-004',
          contextType,
          contextId: Utils.convertToObjectIdMongoose(contextId),
          messageId: messageId
            ? Utils.convertToObjectIdMongoose(messageId)
            : undefined,
          userId,
          text,
          hash,
          vector,
        });

        this.logger.log(`✅ Embedded [${service}/${contextType}] ${contextId}`);
      } catch (error: any) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        if (error?.code === 11000) {
          this.logger.warn(
            `Skipped duplicate hash insertion (E11000) for ${contextId}`,
          );
          return;
        }
        throw error;
      }
    } catch (error) {
      this.logger.error(`Failed to embed ${contextId}`, error);
    }
  }

  /**
   * Tìm kiếm document theo ngữ nghĩa
   * @param query Câu hỏi/từ khóa
   * @param userId ID user (để check quyền - TODO)
   * @param limit Số lượng kết quả
   */
  async searchSimilarDocuments(
    query: string,
    userId: string,
    limit = 5,
  ): Promise<
    Array<{
      text: string;
      contextId: string;
      contextType: string;
      score: number;
    }>
  > {
    type RawSearchResult = {
      text: string;
      contextId: string | Types.ObjectId;
      contextType: string | undefined;
      score: number;
    };

    let results: RawSearchResult[] = [];
    let queryVector: number[] | null = null;

    try {
      queryVector = await this.generateVector(query);

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
            contextType: { $in: ['doc', 'file'] },
            // TODO: Thêm logic check quyền (ví dụ: userId == ownerId hoặc doc public)
            // Hiện tại tạm thời search all docs
          },
        },
        {
          $project: {
            _id: 0,
            text: 1,
            contextId: 1,
            contextType: 1,
            score: { $meta: 'vectorSearchScore' },
          },
        },
      ];

      results = await this.embedModel.aggregate<RawSearchResult>(pipeline);
    } catch (error: any) {
      const err = error as { code?: number; message?: string };
      if (
        queryVector &&
        (err.code === 6047401 || err.message?.includes('Vector search'))
      ) {
        this.logger.warn(
          'Vector search not supported. Falling back to manual Cosine Similarity.',
        );

        // Manual Vector Search
        const candidates = await this.embedModel
          .find({
            contextType: { $in: ['doc', 'file'] },
          })
          .select('text contextId contextType vector')
          .lean()
          .exec();

        const scored = candidates.map((c) => ({
          ...c,
          score: this.cosineSimilarity(queryVector!, c.vector),
        }));

        results = scored
          .sort((a, b) => b.score - a.score)
          .slice(0, limit)
          .map((item) => ({
            ...item,
            contextId: item.contextId?.toString?.() ?? '',
            contextType: item.contextType ?? 'doc',
          }));
      } else {
        this.logger.error('Vector search failed', error);
      }
    }

    if (!results || results.length === 0) {
      this.logger.log(`Fallback to keyword search for doc/file: "${query}"`);
      const docs = await this.embedModel
        .find({
          contextType: { $in: ['doc', 'file'] },
          text: { $regex: query, $options: 'i' },
        })
        .limit(limit)
        .select('-_id text contextId contextType')
        .lean()
        .exec();

      this.logger.log(
        `Found ${docs.length} docs/files via regex fallback for "${query}"`,
      );

      results = docs.map((d) => ({
        ...d,
        score: 0.5,
        contextId: d.contextId?.toString?.() ?? '',
        contextType: d.contextType ?? 'doc',
      }));
    }

    return results.map((r) => ({
      text: r.text,
      contextId:
        typeof r.contextId === 'string'
          ? r.contextId
          : (r.contextId?.toString?.() ?? ''),
      contextType: r.contextType ?? 'doc',
      score: r.score,
    }));
  }

  async processFileEmbedding(
    fileUrl: string,
    fileType: string,
    docId: string,
    userId: string,
    mimeType: string,
    messageId: string,
  ) {
    try {
      this.logger.log(`Processing file embedding: ${fileUrl} (${fileType})`);

      // 1. Download file
      const response = await axios.get<ArrayBuffer>(fileUrl, {
        responseType: 'arraybuffer',
      });
      const arrayBuffer = response.data;
      const buffer: Buffer = Buffer.from(arrayBuffer);

      let textToEmbed = '';

      if (fileType === 'image') {
        textToEmbed = await this.describeImage(buffer, mimeType);
      } else if (fileType === 'video') {
        textToEmbed = await this.describeVideo(buffer, mimeType);
      } else if (fileType === 'audio') {
        textToEmbed = await this.describeAudio(buffer, mimeType);
      } else if (fileType === 'file') {
        if (mimeType === 'text/plain') {
          textToEmbed = buffer.toString('utf-8');
        }
      }

      if (textToEmbed) {
        this.logger.log(`Extracted text for ${docId}: ${textToEmbed}`);
        await this.createEmbedding({
          text: textToEmbed,
          contextId: docId,
          contextType: 'file',
          service: 'document',
          userId,
          replaceOld: true,
          messageId,
        });
      } else {
        this.logger.warn(`No text extracted from file ${docId}`);
      }
    } catch (error) {
      this.logger.error(`Failed to process file embedding for ${docId}`, error);
    }
  }

  private async describeImage(
    buffer: Buffer,
    mimeType: string,
  ): Promise<string> {
    try {
      const model = this.gemini.getGenerativeModel({
        model: 'gemini-2.5-flash',
      });
      const prompt =
        'Hãy đóng vai một chuyên gia SEO hình ảnh. Hãy viết một đoạn mô tả (caption) dưới 50 từ cho hình ảnh này. Tập trung tuyệt đối vào các chi tiết thị giác quan trọng (đối tượng, màu sắc, khung cảnh) mà người dùng sẽ gõ vào thanh tìm kiếm để tìm thấy bức ảnh này. Cuối cùng, liệt kê thêm các từ khóa (keywords) liên quan nhất.';
      const imagePart = {
        inlineData: {
          data: buffer.toString('base64'),
          mimeType,
        },
      };
      const result = await model.generateContent([prompt, imagePart]);
      return result.response.text();
    } catch (error) {
      this.logger.error('Failed to describe image', error);
      return '';
    }
  }

  private async describeVideo(
    buffer: Buffer,
    mimeType: string,
  ): Promise<string> {
    try {
      const model = this.gemini.getGenerativeModel({
        model: 'gemini-2.5-flash',
      });
      const prompt = `Phân tích video này để tạo dữ liệu chỉ mục tìm kiếm (Search Indexing). Hãy cung cấp thông tin ngắn gọn, 'đậm đặc' (high information density) theo cấu trúc sau:

Tóm tắt nội dung (Summary): Một câu mô tả chính xác video nói về cái gì.

Hình ảnh & Hành động (Visuals): Mô tả các đối tượng chính, màu sắc, bối cảnh và diễn biến hành động cụ thể trong video.

Âm thanh (Audio): Mô tả loại âm thanh (nhạc nền buồn/vui, giọng nói nam/nữ, tiếng ồn môi trường). Nếu có lời thoại hoặc giọng nói rõ ràng, hãy tóm tắt ý chính.

Văn bản trên màn hình (OCR): Trích xuất các dòng chữ xuất hiện trong video (nếu có).

Từ khóa (Keywords): Liệt kê 10-15 từ khóa quan trọng nhất để người dùng có thể tìm thấy video này (bao gồm cả danh từ, động từ và tính từ chỉ cảm xúc).`;
      const videoPart = {
        inlineData: {
          data: buffer.toString('base64'),
          mimeType,
        },
      };
      const result = await model.generateContent([prompt, videoPart]);
      return result.response.text();
    } catch (error) {
      this.logger.error('Failed to describe video', error);
      return '';
    }
  }

  private async describeAudio(
    buffer: Buffer,
    mimeType: string,
  ): Promise<string> {
    try {
      const model = this.gemini.getGenerativeModel({
        model: 'gemini-2.5-flash',
      });
      const prompt =
        'Hãy chuyển đổi âm thanh này thành văn bản (Speech to Text). Chỉ trả về nội dung văn bản, không thêm mô tả.';
      const audioPart = {
        inlineData: {
          data: buffer.toString('base64'),
          mimeType,
        },
      };
      const result = await model.generateContent([prompt, audioPart]);
      return result.response.text();
    } catch (error) {
      this.logger.error('Failed to transcribe audio', error);
      return '';
    }
  }
}
