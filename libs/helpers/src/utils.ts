import {
  INestApplication,
  INestMicroservice,
  Logger,
  Type,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import {
  ClientKafka,
  KafkaOptions,
  MicroserviceOptions,
  Transport,
} from '@nestjs/microservices';
import axios from 'axios';
import { Types } from 'mongoose';
import { Response } from '../response';
import { SharedKafkaConfig } from '../../kafka';
import {
  catchError,
  lastValueFrom,
  Observable,
  throwError,
  timeout,
} from 'rxjs';
import { Metadata } from '@grpc/grpc-js';

type Unprefixed<T, P extends string> = {
  [K in keyof T as K extends `${P}${infer R}` ? R : never]: T[K];
};

class Utils {
  static isEmptyObject(obj: object): boolean {
    return Object.keys(obj).length === 0 && obj.constructor === Object;
  }

  static isString(value: any): value is string {
    return typeof value === 'string' || value instanceof String;
  }

  static isNumber(value: any): value is number {
    return typeof value === 'number' && isFinite(value);
  }
  static escapeRegex(str: string) {
    return str.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
  }

  static isBoolean(value: any): value is boolean {
    return typeof value === 'boolean';
  }

  static isArray(value: any): value is any[] {
    return Array.isArray(value);
  }

  static isObject(value: any): value is object {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  static isFunction(value: any): value is (...args: any[]) => any {
    return typeof value === 'function';
  }

  static isEmail(email: string): boolean {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(String(email).toLowerCase());
  }

  static isPhone(phone: string): boolean {
    const re = /^(\+84|84|0)[35789]\d{8}$/; // E.164 format
    return re.test(phone);
  }

  // Chọn các thuộc tính mong muốn từ một đối tượng
  static pick<T extends object, K extends keyof T>(
    obj: T,
    keys: K[],
  ): Pick<T, K> {
    const result = {} as Pick<T, K>;
    for (const key of keys) {
      if (key in obj) {
        result[key] = obj[key];
      }
    }
    return result;
  }

  // Loại bỏ các thuộc tính không mong muốn khỏi một đối tượng
  static omit<T extends object, K extends keyof T>(
    obj: T,
    keys: K[],
  ): Omit<T, K> {
    const result = { ...obj };
    for (const key of keys) {
      if (key in result) {
        delete result[key];
      }
    }
    return result;
  }

  // xóa prefix object
  static unprefix<T extends object, P extends string>(
    obj: T,
    prefix: P,
    excludeFields: string[] = [],
  ): Partial<Unprefixed<T, P>> {
    const result = {} as Partial<Unprefixed<T, P>>;
    for (const key of Object.keys(obj)) {
      // Bỏ qua các trường ngoại lệ
      if (excludeFields.includes(key)) {
        continue;
      }

      if (key.startsWith(prefix)) {
        const newKey = key.slice(prefix.length) as keyof Unprefixed<T, P>;
        result[newKey] = obj[key as keyof T] as unknown as Unprefixed<
          T,
          P
        >[typeof newKey];
      } else {
        // Nếu không có prefix, giữ nguyên key
        result[key as keyof Unprefixed<T, P>] = obj[
          key as keyof T
        ] as unknown as Unprefixed<T, P>[keyof Unprefixed<T, P>];
      }
    }
    return result;
  }

  // Thêm prefix object
  static prefix<T extends object, P extends string>(
    obj: T,
    prefix: P,
    excludeFields: string[] = [],
  ): { [K in keyof T as `${P}${string & K}`]: T[K] } {
    const result = {} as { [K in keyof T as `${P}${string & K}`]: T[K] };
    for (const key of Object.keys(obj)) {
      // Bỏ qua các trường ngoại lệ
      if (excludeFields.includes(key)) {
        continue;
      }
      const newKey = `${prefix}${key}` as keyof typeof result;
      result[newKey] = obj[key as keyof T] as (typeof result)[typeof newKey];
    }
    return result;
  }

  static readonly randomId = (() => {
    let lastMs = 0;
    let seq = 0;
    const MAX_SEQ = 0xffffff; // ~16.7 triệu ID trong 1ms

    const toHex = (n: number, width: number): string =>
      n.toString(16).padStart(width, '0');

    return function () {
      let now = Date.now();

      // chống đồng hồ hệ thống giật lùi
      if (now < lastMs) now = lastMs;

      if (now === lastMs) {
        // cùng 1 ms -> tăng sequence
        if (++seq > MAX_SEQ) {
          // quá tải 1ms -> nhảy logic sang ms tiếp theo
          lastMs = lastMs + 1;
          seq = 0;
        }
      } else {
        // ms mới -> reset sequence
        lastMs = now;
        seq = 0;
      }

      // fixed-width -> so sánh theo chuỗi cũng đúng thứ tự
      const timeHex = toHex(lastMs, 12); // 48-bit time
      const seqHex = toHex(seq, 6); // 24-bit seq
      const randHex = toHex((Math.random() * 0x10000) | 0, 4); // 16-bit random (không ảnh hưởng thứ tự)

      return `${timeHex}${seqHex}${randHex}`;
    };
  })();

  static sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  static generateOtp(length: number = 6): string {
    let otp = '';
    for (let i = 0; i < length; i++) {
      otp += Math.floor(Math.random() * 10).toString();
    }
    return otp;
  }
  static convertToObjectIdMongoose(id: string) {
    return new Types.ObjectId(id);
  }

  static isValidObjectId(id: unknown): id is string {
    return typeof id === 'string' && Types.ObjectId.isValid(id);
  }

  static pairRoomId(a: string, b: string) {
    const sa = String(a),
      sb = String(b);
    return sa < sb ? `${sa}.${sb}` : `${sb}.${sa}`;
  }
  // hàm tạo service
  static async createKafkaMicroservice<T>(
    module: Type<T>,
    serviceName: string,
  ): Promise<INestMicroservice> {
    // Tạo context để lấy config
    const appContext = await NestFactory.createApplicationContext(module);
    const configService = appContext.get(ConfigService);
    const logger = new Logger('Create Microservice Kafka');

    // Get kafka config from the proper nested structure with proper typing
    const kafkaConfig = configService.get<SharedKafkaConfig>('kafka');

    if (!kafkaConfig) {
      throw new Error('❌ Kafka Config Not Found! Check import in AppModule.');
    }

    const options: KafkaOptions['options'] = {
      client: {
        clientId: kafkaConfig.client.clientId,
        brokers: kafkaConfig.client.brokers as string[],
        connectionTimeout: kafkaConfig.client.connectionTimeout,
        requestTimeout: kafkaConfig.client.requestTimeout,
        ssl: kafkaConfig.client.ssl,
        sasl: kafkaConfig.client.sasl as never,
        retry: kafkaConfig.client.retry,
      },
      consumer: {
        groupId: kafkaConfig.consumer.groupId,
        sessionTimeout: kafkaConfig.consumer.sessionTimeout,
        heartbeatInterval: kafkaConfig.consumer.heartbeatInterval,
      },
    };

    const microservice =
      await NestFactory.createMicroservice<MicroserviceOptions>(module, {
        transport: Transport.KAFKA,
        options,
      });
    logger.log(`Create microservice ${serviceName} with Kafka`);
    return microservice;
  }

  static createKafkaMicroserviceFromApplication(
    application: INestApplication,
    serviceName: string,
  ): INestMicroservice {
    const logger = new Logger(`KafkaSetup:${serviceName}`);
    const configService = application.get(ConfigService);

    const kafkaConfig = configService.get<SharedKafkaConfig>('kafka');
    if (!kafkaConfig) {
      throw new Error('❌ Kafka Config Not Found! Check import in AppModule.');
    }

    const brokers = kafkaConfig.client.brokers as string[];

    logger.log(`=================================================`);
    logger.log(`🔌 Service [${serviceName}] connecting to Kafka...`);
    logger.log(`🎯 BROKERS: ${JSON.stringify(brokers)}`);
    logger.log(`🎯 GROUP_ID: ${kafkaConfig.consumer.groupId}`);
    logger.log(`=================================================`);

    const microservice = application.connectMicroservice<MicroserviceOptions>({
      transport: Transport.KAFKA,
      options: {
        client: {
          ...kafkaConfig.client,
          brokers: brokers,
          clientId: serviceName,
        },
        consumer: kafkaConfig.consumer,
        producer: kafkaConfig.producer,
      },
    });

    return microservice;
  }

  static async callApiGateway(
    url: string,
    method: string,
    body: Record<string, any> = {},
    headers: Record<string, any> = {},
    timeout: number = 5000,
  ): Promise<any> {
    // cho 5s
    try {
      const response = await axios.request({
        url,
        method,
        data: body,
        headers,
        timeout,
      });
      return response.data;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return Response.error(message, 500, 'INTERNAL_SERVER_ERROR');
    }
  }

  static async dispatchEventKafka(
    client: ClientKafka,
    pattern: string,
    data: Record<string, unknown> = {},
  ): Promise<
    ReturnType<typeof Response.success> | ReturnType<typeof Response.error>
  > {
    // bắt đầu connection kafka
    try {
      await client.connect();
    } catch (error) {
      return Response.error(
        `Không thể kết nối đến Kafka: ${
          error && typeof error === 'object' && 'message' in error
            ? (error as { message: string }).message
            : String(error)
        }`,
        503,
        'SERVICE_UNAVAILABLE',
      );
    }
    try {
      await client.emit(pattern, data).toPromise();
    } catch (error) {
      const errorMessage =
        error && typeof error === 'object' && 'message' in error
          ? (error as { message: string }).message
          : String(error);
      return Response.error(
        `Không thể gửi event ${pattern}: ${errorMessage}`,
        503,
        'SERVICE_UNAVAILABLE',
      );
    }
    return Response.success(true, 'Gửi event thành công');
  }

  static async dispatchGrpcRequest<T>(
    grpcMethod: (data: T, metadata?: Metadata) => Observable<unknown>,
    data: T,
    timeoutMs = 20000,
  ): Promise<unknown> {
    try {
      const metadata = new Metadata();
      return await lastValueFrom(
        grpcMethod(data, metadata).pipe(
          timeout(timeoutMs),
          catchError((err: any) => {
            // Lấy message chi tiết hơn nếu có
            const detailedMessage =
              err.details || err.message || JSON.stringify(err);

            return throwError(
              () => new Error(`Service unavailable: ${detailedMessage}`),
            );
          }),
        ),
      );
    } catch (error) {
      console.log('🚀 ~ GatewayService ~ dispatchGrpcRequest ~ error:', error);
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return Response.error(errorMessage, 503, 'SERVICE_UNAVAILABLE');
    }
  }

  static parsePrivateKey(raw: string): string {
    if (!raw) {
      throw new Error('FIREBASE PRIVATE KEY is missing');
    }

    const trimmed = raw.trim();

    // Nếu là base64 → giải mã
    const isBase64 =
      // chỉ gồm ký tự hợp lệ của base64
      /^[A-Za-z0-9+/=]+$/.test(trimmed) &&
      // độ dài divisible by 4
      trimmed.length % 4 === 0;

    if (isBase64) {
      try {
        const decoded = Buffer.from(trimmed, 'base64').toString('utf8');

        // Kiểm tra xem sau khi decode có đúng PEM không
        if (decoded.includes('BEGIN PRIVATE KEY')) {
          return decoded;
        }
      } catch {
        // Nếu decode fail → rơi xuống dùng kiểu cũ
      }
    }

    // Ngược lại là dạng chứa \n → convert
    return String.raw({ raw: trimmed }).replaceAll('\\n', '\n');
  }

  static extractUrls(text: string): string[] {
    if (!text) return [];

    const urlRegex = /((https?:\/\/)?([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}(\S*)?)/gi;

    return [...text.matchAll(urlRegex)].map((m) => {
      let url = m[0];

      // Nếu không có http/https → auto thêm
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        url = 'https://' + url;
      }

      return url;
    });
  }
}

export default Utils;
