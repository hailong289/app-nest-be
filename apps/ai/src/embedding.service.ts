import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, FilterQuery, Types } from 'mongoose';
import crypto from 'crypto';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { ConfigService } from '@nestjs/config';
import { AIEmbedding } from 'libs/db/src/mongo/model/AIEmbedding.model';
import axios from 'axios';
import Utils from '@app/helpers/utils';
import type {
  AiEmbeddingSnapshot,
  AiEmbeddingSourceService,
  AiEmbeddingSourceType,
} from '@app/dto/ai.dto';

@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);
  private readonly gemini: GoogleGenerativeAI;

  constructor(
    private cfg: ConfigService,
    @InjectModel(AIEmbedding.name)
    private readonly embedModel: Model<AIEmbedding>,
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

  private toObjectId(id?: string): Types.ObjectId | undefined {
    if (!id || !Types.ObjectId.isValid(id)) return undefined;
    return new Types.ObjectId(id);
  }

  private legacyContextType(
    sourceType: AiEmbeddingSourceType,
  ): 'room' | 'doc' | 'file' {
    if (sourceType === 'message') return 'room';
    if (sourceType === 'document') return 'doc';
    return 'file';
  }

  private sourceTypeFromContext(contextType?: string): AiEmbeddingSourceType {
    if (contextType === 'doc') return 'document';
    if (contextType === 'file') return 'attachment';
    return 'message';
  }

  private sourceServiceFromSource(
    sourceType: AiEmbeddingSourceType,
    service?: string,
  ): AiEmbeddingSourceService {
    if (sourceType === 'message') return 'chat';
    if (sourceType === 'attachment') return 'filesystem';
    if (service === 'document') return 'filesystem';
    return 'filesystem';
  }

  private embeddingRoomMatch(roomId: string) {
    const roomObjectId = this.toObjectId(roomId);
    const legacyMatches: Record<string, unknown>[] = [];
    if (roomObjectId) {
      legacyMatches.push({ contextType: 'room', contextId: roomObjectId });
    }

    return {
      $and: [
        {
          $or: [{ roomId }, { roomIds: roomId }, ...legacyMatches],
        },
        {
          $or: [
            { isSystemMessage: { $ne: true } },
            { isSystemMessage: { $exists: false } },
          ],
        },
        {
          $or: [
            { sourceType: { $in: ['message', 'attachment', 'document'] } },
            { contextType: { $in: ['room', 'file', 'doc'] } },
          ],
        },
      ],
    };
  }

  private documentEmbeddingMatch() {
    return {
      $or: [
        { sourceType: { $in: ['document', 'attachment'] } },
        { contextType: { $in: ['doc', 'file'] } },
      ],
    };
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
    metadata: {
      userId?: string;
      userBusinessId?: string;
      usrId?: string;
      msgType?: string;
      isSystemMessage?: boolean;
      createdAt?: string | Date;
      snapshot?: AiEmbeddingSnapshot;
    } = {},
  ) {
    return this.createEmbedding({
      text,
      contextId: roomId,
      contextType: 'room',
      service: 'chat',
      sourceService: 'chat',
      sourceType: 'message',
      sourceId: messageId,
      roomId,
      messageId,
      userId: metadata.userId,
      userBusinessId: metadata.userBusinessId,
      usrId: metadata.usrId,
      isSystemMessage:
        metadata.isSystemMessage ?? metadata.msgType === 'system',
      snapshot: {
        content: text,
        msgType: metadata.msgType,
        createdAt: metadata.createdAt,
        ...(metadata.snapshot ?? {}),
      },
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
  async searchSimilarMessages(
    query: string,
    roomId: string,
    limit = 5,
    _userId?: string,
  ) {
    type SearchResult = {
      text: string;
      contextId?: string | Types.ObjectId;
      sourceId?: string;
      sourceType?: string;
      messageId?: string | Types.ObjectId;
      createdAt: Date;
      score: number;
    };
    const roomMatch = this.embeddingRoomMatch(roomId);

    try {
      const queryVector = await this.generateVector(query);
      const vectorPipeline: any[] = [
        {
          $vectorSearch: {
            index: 'vector_index',
            path: 'vector',
            queryVector,
            numCandidates: limit * 20,
            limit: limit * 2,
          },
        },
        { $match: roomMatch },
        {
          $project: {
            _id: 0,
            text: 1,
            contextId: 1,
            sourceId: 1,
            sourceType: 1,
            messageId: 1,
            createdAt: 1,
            score: { $meta: 'vectorSearchScore' },
          },
        },
      ];

      const keywordQuery = {
        ...roomMatch,
        text: { $regex: Utils.escapeRegex(query), $options: 'i' },
      };

      const [vectorResults, keywordResults] = await Promise.all([
        this.embedModel
          .aggregate<SearchResult>(vectorPipeline)
          .catch(async (err: unknown) => {
            const errMsg = err instanceof Error ? err.message : String(err);
            this.logger.warn(
              `Vector search failed (likely local): ${errMsg}. Switching to manual Cosine Similarity.`,
            );

            const candidates = await this.embedModel
              .find(roomMatch)
              .select(
                'text contextId sourceId sourceType messageId createdAt vector',
              )
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
          .select('-_id text contextId sourceId sourceType messageId createdAt')
          .lean()
          .exec()
          .then((docs) =>
            docs.map(
              (d) =>
                ({
                  ...d,
                  score: 1.5,
                }) as unknown as SearchResult,
            ),
          ),
      ]);

      const uniqueMap = new Map<string, SearchResult>();
      for (const item of [...keywordResults, ...vectorResults]) {
        const key =
          item.sourceId ||
          item.messageId?.toString?.() ||
          item.contextId?.toString?.() ||
          item.text;
        const existing = uniqueMap.get(key);
        if (!existing || item.score > existing.score) {
          uniqueMap.set(key, item);
        }
      }

      const ranked = Array.from(uniqueMap.values())
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map((item) => ({
          ...item,
          contextId: item.contextId?.toString?.() ?? item.sourceId ?? '',
          messageId: item.messageId?.toString?.() ?? '',
        }));

      return ranked.length > 0
        ? ranked
        : this.fallbackKeywordSearchOnEmbeddings(query, roomMatch, limit);
    } catch (error) {
      this.logger.error(
        'Search failed, falling back to embedding keyword search',
        error,
      );
      return this.fallbackKeywordSearchOnEmbeddings(query, roomMatch, limit);
    }
  }

  private async fallbackKeywordSearchOnEmbeddings(
    query: string,
    match: Record<string, unknown>,
    limit: number,
  ) {
    const trimmed = query.trim();
    if (!trimmed) return [];

    try {
      const docs = await this.embedModel
        .find({
          ...match,
          text: { $regex: Utils.escapeRegex(trimmed), $options: 'i' },
        })
        .sort({ createdAt: -1 })
        .limit(limit)
        .select('-_id text contextId sourceId sourceType messageId createdAt')
        .lean()
        .exec();

      return docs.map((d) => ({
        text: d.text,
        contextId: d.contextId?.toString?.() ?? d.sourceId ?? '',
        messageId: d.messageId?.toString?.() ?? '',
        sourceId: d.sourceId,
        sourceType: d.sourceType,
        createdAt: d.createdAt,
        score: 0.3,
      }));
    } catch (err) {
      this.logger.error(
        `[Fallback] Embedding keyword search failed: ${
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
    contextId?: string; // roomId hoặc docId
    contextType?: 'room' | 'doc' | 'file';
    service?: string;
    sourceService?: AiEmbeddingSourceService;
    sourceType?: AiEmbeddingSourceType;
    sourceId?: string;
    roomId?: string;
    roomIds?: string[];
    userId?: string;
    userBusinessId?: string;
    usrId?: string;
    messageId?: string;
    isSystemMessage?: boolean;
    visibility?: string;
    snapshot?: AiEmbeddingSnapshot;
    cleanContent?: boolean;
    replaceOld?: boolean;
  }) {
    const {
      text,
      userId,
      messageId,
      cleanContent = false,
      replaceOld = false,
    } = params;
    const sourceType =
      params.sourceType ?? this.sourceTypeFromContext(params.contextType);
    const sourceService =
      params.sourceService ??
      this.sourceServiceFromSource(sourceType, params.service);
    const sourceId =
      params.sourceId ??
      (sourceType === 'message' ? messageId : undefined) ??
      params.contextId;
    const contextType =
      params.contextType ?? this.legacyContextType(sourceType);
    const contextId =
      params.contextId ??
      (sourceType === 'message' ? params.roomId : undefined) ??
      sourceId;
    const service = params.service ?? sourceService;
    const roomIds = Array.from(
      new Set(
        [
          ...(params.roomId ? [params.roomId] : []),
          ...(params.roomIds ?? []),
        ].filter(Boolean),
      ),
    );

    if (!text || !contextId || !sourceId) return;

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
      const legacyContextId = this.toObjectId(contextId);
      const legacyMessageId = this.toObjectId(messageId);
      const sourceQuery: FilterQuery<AIEmbedding> = {
        sourceType,
        sourceId,
      };
      const legacyQuery: FilterQuery<AIEmbedding> | null = legacyContextId
        ? {
            contextType,
            contextId: legacyContextId,
            ...(legacyMessageId ? { messageId: legacyMessageId } : {}),
          }
        : null;

      // 2. Xử lý dữ liệu cũ (Update mode)
      if (replaceOld) {
        await this.embedModel.deleteMany({
          $or: legacyQuery ? [sourceQuery, legacyQuery] : [sourceQuery],
        });
      } else {
        // Append mode: Check exist
        const exists = await this.embedModel.exists({
          $or: legacyQuery ? [sourceQuery, legacyQuery] : [sourceQuery],
        });
        if (exists) return;
      }

      // 3. Tạo Vector & Hash
      const vector = await this.generateVector(text);
      const hash = this.hashText(text);

      // Check duplicate hash (nếu không phải update mode)
      if (!replaceOld) {
        const existingHash = await this.embedModel.exists({
          hash,
          sourceType,
          sourceId,
        });
        if (existingHash) {
          this.logger.debug(`Skipped duplicate hash content for ${sourceId}`);
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
          contextId: legacyContextId,
          messageId: legacyMessageId,
          sourceService,
          sourceType,
          sourceId,
          roomId: params.roomId,
          roomIds,
          userId,
          userBusinessId: params.userBusinessId,
          usrId: params.usrId,
          isSystemMessage: params.isSystemMessage ?? false,
          visibility: params.visibility,
          snapshot: params.snapshot ?? {},
          text,
          hash,
          vector,
        });

        this.logger.log(
          `✅ Embedded [${sourceService}/${sourceType}] ${sourceId}`,
        );
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
      sourceId?: string;
      sourceType?: string;
      score: number;
    }>
  > {
    type RawSearchResult = {
      text: string;
      contextId?: string | Types.ObjectId;
      contextType: string | undefined;
      sourceId?: string;
      sourceType?: string;
      score: number;
    };

    let results: RawSearchResult[] = [];
    let queryVector: number[] | null = null;
    const documentMatch = this.documentEmbeddingMatch();

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
          $match: documentMatch,
        },
        {
          $project: {
            _id: 0,
            text: 1,
            contextId: 1,
            contextType: 1,
            sourceId: 1,
            sourceType: 1,
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
          .find(documentMatch)
          .select('text contextId contextType sourceId sourceType vector')
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
            contextId: item.contextId?.toString?.() ?? item.sourceId ?? '',
            contextType:
              item.contextType ??
              (item.sourceType === 'attachment' ? 'file' : 'doc'),
          }));
      } else {
        this.logger.error('Vector search failed', error);
      }
    }

    if (!results || results.length === 0) {
      this.logger.log(`Fallback to keyword search for doc/file: "${query}"`);
      const docs = await this.embedModel
        .find({
          ...documentMatch,
          text: { $regex: query, $options: 'i' },
        })
        .limit(limit)
        .select('-_id text contextId contextType sourceId sourceType')
        .lean()
        .exec();

      this.logger.log(
        `Found ${docs.length} docs/files via regex fallback for "${query}"`,
      );

      results = docs.map((d) => ({
        ...d,
        score: 0.5,
        contextId: d.contextId?.toString?.() ?? d.sourceId ?? '',
        contextType:
          d.contextType ?? (d.sourceType === 'attachment' ? 'file' : 'doc'),
      }));
    }

    return results.map((r) => ({
      text: r.text,
      contextId:
        typeof r.contextId === 'string'
          ? r.contextId
          : (r.contextId?.toString?.() ?? ''),
      contextType: r.contextType ?? 'doc',
      sourceId: r.sourceId,
      sourceType: r.sourceType,
      score: r.score,
    }));
  }

  async processFileEmbedding(params: {
    fileUrl: string;
    fileType: string;
    attachmentId: string;
    userId: string;
    mimeType?: string;
    messageId?: string;
    roomId?: string;
    userBusinessId?: string;
    usrId?: string;
    name?: string;
    size?: number;
    snapshot?: AiEmbeddingSnapshot;
  }) {
    const {
      fileUrl,
      fileType,
      attachmentId,
      userId,
      mimeType = 'application/octet-stream',
      messageId,
      roomId,
    } = params;
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
        this.logger.log(`Extracted text for ${attachmentId}: ${textToEmbed}`);
        await this.createEmbedding({
          text: textToEmbed,
          contextId: attachmentId,
          contextType: 'file',
          service: 'filesystem',
          sourceService: 'filesystem',
          sourceType: 'attachment',
          sourceId: attachmentId,
          roomId,
          userId,
          userBusinessId: params.userBusinessId,
          usrId: params.usrId,
          replaceOld: true,
          messageId,
          snapshot: {
            url: fileUrl,
            kind: fileType,
            mimeType,
            name: params.name,
            size: params.size,
            ...(params.snapshot ?? {}),
          },
        });
      } else {
        this.logger.warn(`No text extracted from file ${attachmentId}`);
      }
    } catch (error) {
      this.logger.error(
        `Failed to process file embedding for ${attachmentId}`,
        error,
      );
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
