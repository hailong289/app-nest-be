import { Types } from 'mongoose';

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
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
    keys.forEach((key) => {
      if (key in obj) {
        result[key] = obj[key];
      }
    });
    return result;
  }

  // Loại bỏ các thuộc tính không mong muốn khỏi một đối tượng
  static omit<T extends object, K extends keyof T>(
    obj: T,
    keys: K[],
  ): Omit<T, K> {
    const result = { ...obj };
    keys.forEach((key) => {
      if (key in result) {
        delete result[key];
      }
    });
    return result;
  }

  // xóa prefix object
  static unprefix<T extends object, P extends string>(
    obj: T,
    prefix: P,
    excludeFields: string[] = [],
  ): Partial<Unprefixed<T, P>> {
    const result = {} as Partial<Unprefixed<T, P>>;
    Object.keys(obj).forEach((key) => {
      // Bỏ qua các trường ngoại lệ
      if (excludeFields.includes(key)) {
        return;
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
    });
    return result;
  }

  // Thêm prefix object
  static prefix<T extends object, P extends string>(
    obj: T,
    prefix: P,
    excludeFields: string[] = [],
  ): { [K in keyof T as `${P}${string & K}`]: T[K] } {
    const result = {} as { [K in keyof T as `${P}${string & K}`]: T[K] };
    Object.keys(obj).forEach((key) => {
      // Bỏ qua các trường ngoại lệ
      if (excludeFields.includes(key)) {
        return;
      }
      const newKey = `${prefix}${key}` as keyof typeof result;
      result[newKey] = obj[key as keyof T] as (typeof result)[typeof newKey];
    });
    return result;
  }

  static randomId = (() => {
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

  static pairRoomId(a: string, b: string) {
    const sa = String(a),
      sb = String(b);
    return sa < sb ? `${sa}.${sb}` : `${sb}.${sa}`;
  }
}

export default Utils;
