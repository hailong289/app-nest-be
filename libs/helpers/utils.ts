
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

    static isBoolean(value: any): value is boolean {
        return typeof value === 'boolean';
    }

    static isArray(value: any): value is any[] {
        return Array.isArray(value);
    }

    static isObject(value: any): value is object {
        return value && typeof value === 'object' && !Array.isArray(value);
    }

    static isFunction(value: any): value is Function {
        return typeof value === 'function';
    }

    static isEmail(email: string): boolean {
        const re = /^(([^<>()\[\]\\.,;:\s@"]+(\.[^<>()\[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
        return re.test(String(email).toLowerCase());
    }

    static isPhone(phone: string): boolean {
        const re = /^(\+84|84|0)(3|5|7|8|9)\d{8}$/; // E.164 format
        return re.test(phone);
    }

    // Chọn các thuộc tính mong muốn từ một đối tượng
    static pick<T extends object, K extends keyof T>(obj: T, keys: K[]): Pick<T, K> {
        const result = {} as Pick<T, K>;
        keys.forEach(key => {
            if (key in obj) {
                result[key] = obj[key];
            }
        });
        return result;
    }

    // Loại bỏ các thuộc tính không mong muốn khỏi một đối tượng
    static omit<T extends object, K extends keyof T>(obj: T, keys: K[]): Omit<T, K> {
        const result = { ...obj } as T;
        keys.forEach(key => {
            if (key in result) {
                delete result[key];
            }
        });
        return result;
    }

    // xóa prefix object
    static unprefix<T extends object, P extends string>(obj: T, prefix: P): Partial<Unprefixed<T, P>> {
        const result = {} as Partial<Unprefixed<T, P>>;
        Object.keys(obj).forEach(key => {
            if (key.startsWith(prefix)) {
                const newKey = key.slice(prefix.length) as keyof Unprefixed<T, P>;
                result[newKey] = obj[key as keyof T] as unknown as Unprefixed<T, P>[typeof newKey];
            } else {
                // Nếu không có prefix, giữ nguyên key
                result[key as keyof Unprefixed<T, P>] = obj[key as keyof T] as unknown as Unprefixed<T, P>[keyof Unprefixed<T, P>];
            }
        });
        return result;
    }

    // Thêm prefix object
    static prefix<T extends object, P extends string>(obj: T, prefix: P): { [K in keyof T as `${P}${string & K}`]: T[K] } {
        const result = {} as { [K in keyof T as `${P}${string & K}`]: T[K] };
        Object.keys(obj).forEach(key => {
            const newKey = `${prefix}${key}` as keyof typeof result;
            result[newKey] = obj[key as keyof T] as any;
        });
        return result;
    }

    static randomId = (() => {
        let lastMs = 0;
        let seq = 0;
        const MAX_SEQ = 0xFFFFFF; // ~16.7 triệu ID trong 1ms

        const toHex = (n, width) => n.toString(16).padStart(width, "0");

        return function () {
            let now = Date.now();

            // chống đồng hồ hệ thống giật lùi
            if (now < lastMs) now = lastMs;

            if (now === lastMs) {
                // cùng 1 ms -> tăng sequence
                if (++seq > MAX_SEQ) { // quá tải 1ms -> nhảy logic sang ms tiếp theo
                    lastMs = lastMs + 1;
                    seq = 0;
                }
            } else {
                // ms mới -> reset sequence
                lastMs = now;
                seq = 0;
            }

            // fixed-width -> so sánh theo chuỗi cũng đúng thứ tự
            const timeHex = toHex(lastMs, 12);                 // 48-bit time
            const seqHex = toHex(seq, 6);                     // 24-bit seq
            const randHex = toHex((Math.random() * 0x10000) | 0, 4); // 16-bit random (không ảnh hưởng thứ tự)

            return `${timeHex}${seqHex}${randHex}`;
        };
    })();
}

export default Utils;