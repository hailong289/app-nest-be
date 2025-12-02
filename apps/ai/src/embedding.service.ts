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

  /** Tạo embedding (Google hoặc local fallback) */
  async generateVector(text: string): Promise<number[]> {
    try {
      const model = this.gemini.getGenerativeModel({ model: 'embedding-001' });
      const res = await model.embedContent(text);
      return res.embedding.values;
    } catch (err) {
      this.logger.warn(
        `⚠️ Gemini embedding failed, using fallback: ${err.message}`,
      );
      // fallback: vector ngẫu nhiên để tránh crash
      return Array(768)
        .fill(0)
        .map(() => Math.random() * 0.02 - 0.01);
    }
  }

  /** Tạo hoặc lấy embedding đã có */
  async createEmbedding(params: {
    text: string;
    service: string;
    provider?: string;
    model?: string;
    label?: string;
    userId?: string;
    contextType?: string;
    contextId?: string;
    categories?: string[];
    metadata?: Record<string, any>;
  }): Promise<AIEmbedding> {
    const {
      text,
      service,
      provider = 'google',
      model = 'embedding-001',
      label = 'unknown',
      userId,
      contextType,
      contextId,
      categories = [],
      metadata = {},
    } = params;

    const hash = this.hashText(text);
    const existing = await this.embedModel.findOne({ hash, service });
    if (existing) {
      this.logger.debug(`✅ Embedding found (hash=${hash.slice(0, 8)})`);
      return existing;
    }

    const vector = await this.generateVector(text);

    const created = await this.embedModel.create({
      service,
      provider,
      model,
      hash,
      text,
      vector,
      userId,
      contextType,
      contextId,
      label,
      categories,
      confidence: 1,
      hitCount: 1,
      usedInCache: false,
      usedInTraining: false,
      metadata,
    });

    this.logger.log(`🧩 Created new embedding [${service}:${label}]`);
    return created;
  }

  /** Tính cosine similarity */
  private cosine(a: number[], b: number[]): number {
    const dot = a.reduce((sum, v, i) => sum + v * b[i], 0);
    const magA = Math.sqrt(a.reduce((s, v) => s + v * v, 0));
    const magB = Math.sqrt(b.reduce((s, v) => s + v * v, 0));
    return dot / (magA * magB);
  }

  /** Tìm embedding gần giống */
  async findSimilar(
    text: string,
    service: string,
    threshold = 0.9,
  ): Promise<AIEmbedding | null> {
    const hash = this.hashText(text);
    const existing = await this.embedModel.findOne({ hash, service });
    if (existing) return existing;

    const vector = await this.generateVector(text);
    const docs = (await this.embedModel.find({ service })) as AIEmbedding[];

    let best: { score: number; doc: AIEmbedding | null } = {
      score: 0,
      doc: null,
    };
    for (const doc of docs) {
      const score = this.cosine(vector, doc.vector);
      if (score > best.score) best = { score, doc };
    }

    if (best.doc && best.score >= threshold) {
      best.doc.similarity = best.score;
      this.logger.debug(
        `🔍 Found similar embedding (${(best.score * 100).toFixed(1)}%)`,
      );
      return best.doc;
    }
    return null;
  }

  /** Cập nhật confidence & hitCount nếu gặp lại */
  async updateConfidence(
    id: string,
    label: string,
    source = 'auto',
    boost = 1,
  ): Promise<void> {
    await this.embedModel.updateOne(
      { _id: id },
      {
        $set: { label, provider: source },
        $inc: { confidence: boost, hitCount: 1 },
      },
    );
  }

  /** Thêm hoặc cập nhật mẫu bậy */
  async addOffensive(params: {
    text: string;
    service: string;
    label: string;
    categories?: string[];
    userId?: string;
    contextType?: string;
    contextId?: string;
    confidence?: number;
    metadata?: Record<string, any>;
  }): Promise<void> {
    const {
      text,
      service,
      label,
      categories = [],
      userId,
      contextType,
      contextId,
      confidence = 1,
      metadata = {},
    } = params;

    const similar = await this.findSimilar(text, service, 0.93);
    if (similar) {
      await this.updateConfidence(similar._id, label, 'google', confidence);
      return;
    }

    await this.createEmbedding({
      text,
      service,
      label,
      provider: 'google',
      userId,
      contextType,
      contextId,
      categories,
      metadata: { ...metadata, confidence },
    });
  }
}
