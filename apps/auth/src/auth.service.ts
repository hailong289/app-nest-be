import {
  LoginDto,
  RegisterDto,
  UpdateAvatarDto,
  UpdateProfileDto,
  SearchUserDto,
} from '@app/dto';
import {
  Inject,
  Injectable,
  UnauthorizedException,
  OnModuleInit,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Response } from 'libs/helpers/response';
import { compare, hash } from 'bcrypt';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import Utils from 'libs/helpers/utils';
import axios from 'axios';
import Userschema, { User } from 'libs/db/src/mongo/model/user.model';
import { Key } from 'libs/db/src/mongo/model/keys.model';
import { Otp } from 'libs/db/src/mongo/model/otp.model';
import { RedisService, UserCacheRepository } from 'libs/db/src';
import { REDISKEY } from '@app/constants/RedisKey';

/**
 * Subset of the device-origin fields shared by LoginDto / RegisterDto /
 * RefreshTokenGrpcDto. Declared structurally (no @app/dto import) so
 * `buildDeviceContextUpdate` can accept ANY of those DTOs without
 * having to type-assert at the call site.
 */
interface DeviceContextInput {
  ip?: string | null;
  userAgent?: string | null;
  location?: {
    country?: string;
    countryName?: string;
    region?: string;
    city?: string;
    lat?: number;
    lng?: number;
    timezone?: string;
    isp?: string;
  } | null;
  deviceInfo?: {
    browser?: string;
    browserVersion?: string;
    os?: string;
    osVersion?: string;
    deviceType?: string;
    deviceVendor?: string;
    deviceModel?: string;
  } | null;
}

/**
 * Strict shape of the `$set` payload produced by `buildDeviceContextUpdate`.
 * Mirrors the device-tracking fields on the Keys schema — typed here so
 * MongoDB driver gets a precise update doc instead of `Record<string,
 * unknown>` (which silently allows typos like `tkn_lastsSeenAt`).
 *
 * Optional fields are only set when the caller passed a value, so we
 * never overwrite a previously-good value with `null`/`undefined`.
 */
interface KeysDeviceContextUpdate {
  tkn_lastSeenAt: Date;
  tkn_ip?: string;
  tkn_lastSeenIp?: string;
  tkn_userAgent?: string;
  tkn_location?: DeviceContextInput['location'];
  tkn_deviceInfo?: DeviceContextInput['deviceInfo'];
}

@Injectable()
export class AuthService implements OnModuleInit {
  private get gatewayUrl() {
    return process.env.GATEWAY_URL || 'http://localhost:5000';
  }
  private readonly key = REDISKEY;
  private readonly logger = new Logger(AuthService.name);

  /**
   * Convert a JWT-style duration string ("7d", "1h", "30m", "60s") or a
   * raw number-of-seconds string into seconds.
   *
   * Why: JWT signing accepts strings ("7d") but Redis TTL needs seconds.
   * Hardcoding 30*24*60*60 in setData calls drifted from the actual
   * `JWT_REFRESH_EXPIRES_IN` value (7d), causing Redis entries to live
   * 4× longer than the JWT they correspond to. This helper keeps them
   * in lockstep — Redis TTL = JWT exp.
   */
  private parseExpiresInToSeconds(
    value: string | undefined,
    fallback: number,
  ): number {
    if (!value) return fallback;
    const trimmed = value.trim();
    // Pure numeric → already seconds.
    if (/^\d+$/.test(trimmed)) return parseInt(trimmed, 10);
    const m = /^(\d+)\s*([smhdwy])$/i.exec(trimmed);
    if (!m) return fallback;
    const n = parseInt(m[1], 10);
    const unit = m[2].toLowerCase();
    const mult: Record<string, number> = {
      s: 1,
      m: 60,
      h: 60 * 60,
      d: 60 * 60 * 24,
      w: 60 * 60 * 24 * 7,
      y: 60 * 60 * 24 * 365,
    };
    return n * (mult[unit] ?? 1);
  }

  /** Refresh-token TTL in seconds, derived from JWT_REFRESH_EXPIRES_IN. */
  private get refreshTtlSeconds(): number {
    return this.parseExpiresInToSeconds(
      process.env.JWT_REFRESH_EXPIRES_IN,
      7 * 24 * 60 * 60, // default 7d, matches JWT signing default below
    );
  }

  /**
   * Add a JTI to the Redis blacklist with TTL = max possible token life.
   * The entry auto-expires after the JWT would have expired anyway, so
   * no manual cleanup is needed — Redis is just a fast-path "this token
   * was revoked" check before the JWT signature/exp verify.
   *
   * Pattern change: Redis used to store ACTIVE tokens (whitelist) at
   * REFRESH_TOKEN(userId, jti) = 'valid'. We switched to BLACKLIST
   * semantics — presence in Redis means "this token has been revoked".
   * Live tokens are NOT stored at all (smaller Redis footprint).
   * The MongoDB `tkn_jit` array is kept as a durable secondary
   * blacklist (survives Redis flush + multi-pod restart).
   */
  private async blacklistJti(userId: string, jti: string): Promise<void> {
    if (!userId || !jti) return;
    await this.redis.setData(
      this.key.REFRESH_TOKEN(userId, jti),
      'revoked',
      this.refreshTtlSeconds,
    );
  }

  /**
   * Build the `$set` payload that persists device-origin context onto a
   * Keys document. Always bumps `tkn_lastSeenAt` (any login/refresh =
   * activity); writes ip/UA/location only when provided so we don't
   * overwrite a previously-good value with a null from a downstream
   * caller that didn't forward the context.
   */
  private buildDeviceContextUpdate(
    ctx: DeviceContextInput | undefined,
  ): KeysDeviceContextUpdate {
    const update: KeysDeviceContextUpdate = {
      tkn_lastSeenAt: new Date(),
    };
    if (!ctx) return update;
    if (ctx.ip) {
      update.tkn_ip = ctx.ip;
      update.tkn_lastSeenIp = ctx.ip;
    }
    if (ctx.userAgent) {
      update.tkn_userAgent = ctx.userAgent;
    }
    if (ctx.location) {
      update.tkn_location = ctx.location;
    }
    if (ctx.deviceInfo) {
      update.tkn_deviceInfo = ctx.deviceInfo;
    }
    return update;
  }

  constructor(
    @InjectModel(Userschema.name) private readonly userModel: Model<User>,
    @InjectModel('Key') private readonly keyModel: Model<Key>,
    @InjectModel('Otp') private readonly otpModel: Model<Otp>,
    private readonly redis: RedisService,
    @Inject() private readonly jwtService: JwtService,
    private readonly userCache: UserCacheRepository,
  ) {}

  async onModuleInit() {
    this.logger.log('Syncing FCM tokens to Redis...');
    try {
      // Per-device docs now hold a single fcmToken (string|null) instead
      // of the per-user array we used to scan. Filter out nulls + the
      // legacy-array shape (which would have $type=array on Mongo) so
      // this still works during the rolling deploy.
      const keysWithTokens = await this.keyModel
        .find({
          tkn_fcmToken: { $exists: true, $ne: null, $type: 'string' },
        })
        .exec();

      let count = 0;
      for (const keyDoc of keysWithTokens) {
        if (
          keyDoc.tkn_userId &&
          typeof keyDoc.tkn_fcmToken === 'string' &&
          keyDoc.tkn_fcmToken.length > 0
        ) {
          await this.redis.sAdd(
            this.key.USER_FCM_TOKENS(keyDoc.tkn_userId.toString()),
            keyDoc.tkn_fcmToken,
          );
          count++;
        }
      }
      this.logger.log(`Synced FCM tokens for ${count} device sessions.`);
    } catch (error) {
      this.logger.error('Failed to sync FCM tokens:', error);
    }
  }

  async getActiveFcmTokensForUsers(userIds: string[]) {
    const uniqueUserIds = Array.from(
      new Set(
        (userIds || [])
          .filter((userId): userId is string => typeof userId === 'string')
          .map((userId) => userId.trim())
          .filter(Boolean),
      ),
    );

    const invalid = uniqueUserIds.filter(
      (userId) => !Types.ObjectId.isValid(userId),
    );
    if (invalid.length > 0) {
      return Response.error(
        'userIds phải là Mongo ObjectId',
        400,
        'INVALID_USER_IDS',
        { invalid },
      );
    }

    const keys = await this.keyModel
      .find({
        tkn_userId: {
          $in: uniqueUserIds.map((userId) => new Types.ObjectId(userId)),
        },
        tkn_fcmToken: { $exists: true, $ne: null, $type: 'string' },
        tkn_revokedAt: null,
      })
      .select('tkn_userId tkn_fcmToken')
      .lean()
      .exec();

    const tokenMap = new Map<string, Set<string>>();
    for (const key of keys) {
      if (!key.tkn_fcmToken) continue;
      const userId = key.tkn_userId.toString();
      if (!tokenMap.has(userId)) {
        tokenMap.set(userId, new Set());
      }
      tokenMap.get(userId)?.add(key.tkn_fcmToken);
    }

    return Response.success(
      {
        items: uniqueUserIds.map((userId) => ({
          userId,
          fcmTokens: Array.from(tokenMap.get(userId) ?? []),
        })),
      },
      'Lấy FCM tokens thành công',
    );
  }

  private toUserSummary(user: Record<string, any>) {
    return {
      _id: user._id.toString(),
      userId: user._id.toString(),
      usr_id: user.usr_id,
      id: user.usr_id,
      name: user.usr_fullname,
      fullname: user.usr_fullname,
      email: user.usr_email,
      phone: user.usr_phone,
      avatar: user.usr_avatar,
      status: user.usr_status,
      slug: user.usr_slug,
    };
  }

  async resolveBusinessIds(usrIds: string[]) {
    const uniqueUsrIds = Array.from(
      new Set(
        (usrIds || [])
          .filter((usrId): usrId is string => typeof usrId === 'string')
          .map((usrId) => usrId.trim())
          .filter(Boolean),
      ),
    );

    const users = await this.userModel
      .find({ usr_id: { $in: uniqueUsrIds } })
      .select(
        '_id usr_id usr_fullname usr_email usr_phone usr_avatar usr_status usr_slug',
      )
      .lean()
      .exec();

    return Response.success(
      {
        items: users.map((user) => ({
          ...this.toUserSummary(user),
          usrId: user.usr_id,
        })),
      },
      'Resolve business ids thành công',
    );
  }

  async getUsersBatch(userIds: string[], search = '') {
    const uniqueUserIds = Array.from(
      new Set(
        (userIds || [])
          .filter((userId): userId is string => typeof userId === 'string')
          .map((userId) => userId.trim())
          .filter(Boolean),
      ),
    );

    const invalid = uniqueUserIds.filter(
      (userId) => !Types.ObjectId.isValid(userId),
    );
    if (invalid.length > 0) {
      return Response.error(
        'userIds phải là Mongo ObjectId',
        400,
        'INVALID_USER_IDS',
        { invalid },
      );
    }

    const query: Record<string, any> = {
      _id: { $in: uniqueUserIds.map((userId) => new Types.ObjectId(userId)) },
    };
    const keyword = search.trim();
    if (keyword) {
      const regex = new RegExp(keyword, 'i');
      query.$or = [
        { usr_fullname: regex },
        { usr_email: regex },
        { usr_phone: regex },
        { usr_id: regex },
      ];
    }

    const users = await this.userModel
      .find(query)
      .select(
        '_id usr_id usr_fullname usr_email usr_phone usr_avatar usr_status usr_slug',
      )
      .lean()
      .exec();

    return Response.success(
      {
        items: users.map((user) => this.toUserSummary(user)),
      },
      'Lấy thông tin user thành công',
    );
  }

  async searchUser(searchDto: SearchUserDto) {
    const {
      keyword = '',
      page = 1,
      limit = 100,
      excludeUsrId,
      excludeUserIds,
    } = searchDto;
    const safePage = Number(page) > 0 ? Number(page) : 1;
    const safeLimit = Number(limit) > 0 ? Number(limit) : 100;
    const skip = (safePage - 1) * safeLimit;
    const regex = new RegExp(keyword, 'i');
    const query: Record<string, any> = {
      $or: [
        { usr_fullname: regex },
        { usr_email: regex },
        { usr_phone: regex },
        { usr_id: regex },
      ],
    };

    const excludedObjectIds = Array.from(
      new Set(
        (excludeUserIds || [])
          .filter((id): id is string => typeof id === 'string')
          .filter((id) => Types.ObjectId.isValid(id)),
      ),
    );
    if (excludedObjectIds.length > 0) {
      query._id = {
        $nin: excludedObjectIds.map((id) => new Types.ObjectId(id)),
      };
    }
    if (excludeUsrId) {
      query.usr_id = { $ne: excludeUsrId };
    }

    const [users, total] = await Promise.all([
      this.userModel
        .find(query)
        .skip(skip)
        .limit(safeLimit)
        .select('-usr_password -usr_salt -__v')
        .lean()
        .exec(),
      this.userModel.countDocuments(query),
    ]);

    return Response.success(
      {
        users: users.map((user) => this.toUserSummary(user)),
        total,
        totalPage: Math.ceil(total / safeLimit),
        page: safePage,
        limit: safeLimit,
      },
      'Tìm kiếm thành công',
    );
  }

  async login(loginDto: LoginDto) {
    const user = await this.userModel
      .findOne({
        $or: [
          { usr_email: loginDto.username },
          { usr_phone: loginDto.username },
        ],
      })
      .exec();

    if (!user) {
      return Response.error('Tài khoản không tồn tại', 400);
    }

    const isPasswordValid = await compare(loginDto.password, user.usr_salt);

    if (!isPasswordValid) {
      return Response.error('Mật khẩu không chính xác', 400);
    }

    const userData: Record<string, any> = Utils.omit(user.toObject(), [
      'usr_salt',
      '__v',
    ]);

    // Each login = a new device session. clientId is generated here and
    // embedded in the JWT alongside jti — refresh-token rotation
    // preserves the same clientId so device identity persists across
    // the entire session lifetime (login → many refreshes → logout).
    // Multiple concurrent logins from the same physical device produce
    // distinct sessions (intentional — re-login = new session).
    const jti = Utils.randomId();
    const clientId = Utils.randomId();
    const tokenPayload = { ...userData, jti, clientId };

    const accessToken = this.jwtService.sign(tokenPayload, {
      secret: process.env.JWT_ACCESS_SECRET || 'access_secret',
      expiresIn: (process.env.JWT_ACCESS_EXPIRES_IN ||
        '7d') as JwtSignOptions['expiresIn'],
    });

    const refreshToken = this.jwtService.sign(tokenPayload, {
      secret: process.env.JWT_REFRESH_SECRET || 'refresh_secret',
      expiresIn: (process.env.JWT_REFRESH_EXPIRES_IN ||
        '7d') as JwtSignOptions['expiresIn'],
    });
    // No Redis whitelist — Redis stores blacklist only (revoked JTIs).
    // Active tokens are valid as long as: (a) JWT signature + exp pass,
    // and (b) JTI is NOT in Redis blacklist + NOT in DB tkn_jit array.

    // Create the per-device Keys row. Composite unique index on
    // (tkn_userId, tkn_clientId) guarantees no collision even if
    // randomId() somehow repeats — Mongo would reject the duplicate.
    try {
      await this.keyModel.create({
        tkn_userId: user._id,
        tkn_clientId: clientId,
        tkn_fcmToken: loginDto.fcmToken || null,
        ...this.buildDeviceContextUpdate(loginDto),
      });
    } catch (err) {
      this.logger.error('[login] Keys.create failed', err as Error);
    }

    if (loginDto.fcmToken) {
      // Mirror to Redis for fast notification fan-out (one Redis SET
      // lookup beats scanning Mongo on every push).
      await this.redis.sAdd(
        this.key.USER_FCM_TOKENS(user._id.toString()),
        loginDto.fcmToken,
      );
    }

    return Response.success(
      {
        accessToken,
        refreshToken,
        expiresIn: 7 * 24 * 60 * 60, // 7 days in seconds
        user: Utils.unprefix(userData, 'usr_'),
      },
      'Đăng nhập thành công',
    );
  }

  async sendOtp(email: string, type: string) {
    const normalizedEmail = (email || '').trim().toLowerCase();
    if (!Utils.isEmail(normalizedEmail)) {
      return Response.error('Email không hợp lệ', 400, 'Bad Request');
    }

    if (type === 'register') {
      const existingUser = await this.userModel
        .findOne({ usr_email: normalizedEmail })
        .exec();
      if (existingUser) {
        return Response.conflict('Email đã được sử dụng');
      }
    }

    const otpCode = Utils.generateOtp(6);
    await this.otpModel.create({
      indicator: normalizedEmail,
      otp: otpCode,
      type,
    });

    try {
      await axios.post(`${this.gatewayUrl}/api/notifications/send-otp`, {
        email: normalizedEmail,
        otp: otpCode,
      });
    } catch (error) {
      this.logger.error('Error sending OTP email:', error);
      return Response.error('Gửi OTP thất bại', 500);
    }

    return Response.success(null, 'Đã gửi OTP đến email của bạn');
  }

  async register(registerDto: RegisterDto) {
    let email: string;

    try {
      const payload = this.jwtService.verify(registerDto.tempRegisterToken, {
        secret: process.env.REGISTER_TOKEN_SECRET || 'register_token_secret',
      }) as { email?: string; scope?: string };

      if (payload.scope !== 'register') {
        return Response.error('Token sai scope', 400, 'Bad Request');
      }
      email = (payload.email ?? '').trim().toLowerCase();
    } catch {
      return Response.error(
        'Token đăng ký không hợp lệ hoặc đã hết hạn',
        400,
        'Bad Request',
      );
    }

    if (!Utils.isEmail(email)) {
      return Response.error('Email không hợp lệ', 400, 'Bad Request');
    }

    const existingUser = await this.userModel
      .findOne({ usr_email: email })
      .exec();

    if (existingUser) {
      return Response.conflict('Email đã tồn tại');
    }

    const hashedPassword = await hash(registerDto.password, 10);

    const newUser = new this.userModel({
      usr_fullname: registerDto.fullname,
      usr_email: email,
      usr_phone: '',
      usr_salt: hashedPassword,
      usr_gender: registerDto.gender || 'other',
      usr_date_of_birth: registerDto.dateOfBirth || '',
    });

    try {
      await newUser.save();
      const userData: Record<string, any> = Utils.omit(newUser.toObject(), [
        'usr_salt',
        '__v',
      ]);
      // First-login session — same shape as login(): generate jti +
      // clientId, embed both in JWT, create the per-device Keys row.
      const jti = Utils.randomId();
      const clientId = Utils.randomId();
      const tokenPayload = { ...userData, jti, clientId };

      const accessToken = this.jwtService.sign(tokenPayload, {
        secret: process.env.JWT_ACCESS_SECRET || 'access_secret',
        expiresIn: (process.env.JWT_ACCESS_EXPIRES_IN ||
          '1d') as JwtSignOptions['expiresIn'],
      });

      const refreshToken = this.jwtService.sign(tokenPayload, {
        secret: process.env.JWT_REFRESH_SECRET || 'refresh_secret',
        expiresIn: (process.env.JWT_REFRESH_EXPIRES_IN ||
          '7d') as JwtSignOptions['expiresIn'],
      });

      // Always create a Keys document on register — even if no fcmToken
      // (push perms denied / native client). Without this the first-time
      // user has no device record and refresh-token has nothing to scope
      // by until they log in again.
      await this.keyModel.create({
        tkn_userId: newUser._id,
        tkn_clientId: clientId,
        tkn_fcmToken: registerDto.fcmToken || null,
        ...this.buildDeviceContextUpdate(registerDto),
      });

      if (registerDto.fcmToken) {
        await this.redis.sAdd(
          this.key.USER_FCM_TOKENS(newUser._id.toString()),
          registerDto.fcmToken,
        );
      }
      // Blacklist-only Redis pattern: don't store ACTIVE tokens.
      // The token is implicitly valid until it appears in the blacklist
      // or its JWT signature/exp fails.

      return Response.success(
        {
          accessToken,
          refreshToken,
          expiresIn: 7 * 24 * 60 * 60, // 7 days in seconds
          user: Utils.unprefix(userData, 'usr_'),
        },
        'Đăng ký thành công',
      );
    } catch (error) {
      console.error('Auth register error:', error);
      return Response.error('Đăng ký thất bại', 400);
    }
  }

  async getUser(userId: string) {
    const user = await this.userModel.findById(userId).exec();

    if (!user) {
      return Response.error('Tài khoản không tồn tại', 404);
    }

    // Return the SAME shape as login/register so FE consumers
    // (`fetchMe()` in useAuthStore) can read `metadata.user` uniformly.
    // Also strip the `usr_` prefix — FE types use `fullname` / `email`
    // / `phone`, not the raw Mongoose field names.
    const userData = Utils.omit(user.toObject(), ['usr_salt', '__v']);
    return Response.success(
      { user: Utils.unprefix(userData, 'usr_') },
      'Thông tin người dùng',
    );
  }

  async verifyOtp(
    indicator: string,
    otp: string,
    type: string = 'reset-password',
  ) {
    const normalizedIndicator = (indicator || '').trim().toLowerCase();
    const keyEntry = await this.otpModel
      .findOne({ indicator: normalizedIndicator, otp, type })
      .exec();

    if (!keyEntry) {
      return Response.error(
        'Mã OTP không hợp lệ hoặc đã hết hạn',
        400,
        'Invalid OTP',
      );
    }

    // OTP valid — delete it so it can't be reused
    await this.otpModel.deleteOne({ _id: keyEntry._id }).exec();

    if (type === 'register') {
      const tempRegisterToken = this.jwtService.sign(
        { email: normalizedIndicator, scope: 'register' },
        {
          secret: process.env.REGISTER_TOKEN_SECRET || 'register_token_secret',
          expiresIn: '15m',
        },
      );
      return Response.success({ tempRegisterToken }, 'Xác thực OTP thành công');
    }

    if (keyEntry.userId) {
      const user = await this.userModel
        .findOne({ usr_id: keyEntry.userId })
        .exec();
      if (!user) {
        return Response.error('Tài khoản không tồn tại', 404);
      }
      const userData: Record<string, any> = Utils.omit(user.toObject(), [
        'usr_salt',
        '__v',
      ]);
      const accessToken = this.jwtService.sign(userData, {
        secret: process.env.JWT_ACCESS_SECRET || 'access_secret',
        expiresIn: '30m',
      });
      return Response.success({ accessToken }, 'Xác thực OTP thành công');
    }

    return Response.success(null, 'Xác thực OTP thành công');
  }

  async updatePassword({
    oldPassword,
    newPassword,
    userId,
  }: {
    oldPassword: string;
    newPassword: string;
    userId: string;
  }) {
    const user = await this.userModel.findById(userId).exec();
    if (!user) {
      return Response.error('Tài khoản không tồn tại', 404);
    }
    // Nếu có oldPassword thì kiểm tra, không có thì bỏ qua (dành cho trường hợp quên mật khẩu)
    const isOldPasswordValid = await compare(oldPassword, user.usr_salt);
    if (!isOldPasswordValid) {
      return Response.error('Mật khẩu cũ không chính xác', 400);
    }
    const hashedNewPassword = await hash(newPassword, 10);
    user.usr_salt = hashedNewPassword;
    await user.save();
    return Response.success(null, 'Cập nhật mật khẩu thành công');
  }

  async resetPassword(userId: string, newPassword: string) {
    const user = await this.userModel.findById(userId).exec();
    if (!user) {
      return Response.error('Tài khoản không tồn tại', 404);
    }
    const hashedNewPassword = await hash(newPassword, 10);
    user.usr_salt = hashedNewPassword;
    await user.save();
    return Response.success(null, 'Đặt lại mật khẩu thành công');
  }

  async forgotPassword(
    email: string,
    username: string,
    isMobile: boolean = false,
  ) {
    const user = await this.userModel
      .findOne({
        $or: [{ usr_email: username }, { usr_phone: username }],
      })
      .exec();

    if (!user) {
      return Response.error('Tài khoản không tồn tại', 404);
    }

    const requestEmail = (email || '').trim().toLowerCase();
    const accountEmail = (user.usr_email || '').trim().toLowerCase();
    const recipientEmail = requestEmail || accountEmail;

    if (!Utils.isEmail(recipientEmail)) {
      return Response.error(
        'Tài khoản chưa có email hợp lệ để nhận mã khôi phục',
        400,
      );
    }

    try {
      if (isMobile) {
        // Lưu OTP vào database để verify
        const otpCode = Utils.generateOtp(6);
        await this.otpModel.create({
          indicator: recipientEmail,
          otp: otpCode,
          type: 'reset-password',
          userId: user.usr_id,
        });
        // Gửi OTP về email thông qua Notification Service
        await axios.post(`${this.gatewayUrl}/api/notifications/send-otp`, {
          email: recipientEmail,
          otp: otpCode,
        });
        return Response.success(null, 'Đã gửi mã OTP đến email của bạn');
      }
      const userData: Record<string, any> = Utils.omit(user.toObject(), [
        'usr_salt',
        '__v',
      ]);
      const accessToken = this.jwtService.sign(userData, {
        secret: process.env.JWT_ACCESS_SECRET || 'access_secret',
        expiresIn: '30m', // access token sống 30 phút
      });
      // Gửi token về email thông qua Notification Service
      await axios.post(`${this.gatewayUrl}/api/notifications/forgot-password`, {
        email: recipientEmail,
        token: accessToken,
      });
    } catch (error) {
      console.error('Error sending OTP:', error);
      return Response.error('Gửi mã OTP thất bại', 500);
    }

    return Response.success(null, 'Đã gửi mã OTP đến email của bạn');
  }

  async updateAvatar(data: UpdateAvatarDto & { userId: string }) {
    const user = await this.userModel.findById(data.userId).exec();
    if (!user) {
      return Response.error('Tài khoản không tồn tại', 404);
    }
    try {
      user.usr_avatar = data.avatarUrl;
      await user.save();
      await Promise.all([
        this.userCache.invalidate(String(user._id)),
        this.userCache.invalidate(user.usr_id),
      ]);
      return Response.success(
        { url: data.avatarUrl },
        'Cập nhật ảnh đại diện thành công',
      );
    } catch (error) {
      console.error('Error updating avatar:', error);
      return Response.error(
        'Cập nhật ảnh đại diện thất bại',
        400,
        'ERROR_UPDATE_AVATAR',
        error,
      );
    }
  }

  async updateProfile(data: UpdateProfileDto & { userId: string }) {
    const user = await this.userModel.findById(data.userId).exec();
    if (!user) {
      return Response.error('Tài khoản không tồn tại', 404);
    }
    user.usr_fullname = data.fullname;
    user.usr_gender = data.gender;
    user.usr_dateOfBirth = new Date(data.dateOfBirth);
    if (data.address !== undefined) {
      user.usr_address = data.address;
    }
    await user.save();
    await Promise.all([
      this.userCache.invalidate(String(user._id)),
      this.userCache.invalidate(user.usr_id),
    ]);
    const userData = Utils.omit(user.toObject(), ['usr_salt', '__v']);
    return Response.success(
      { user: Utils.unprefix(userData, 'usr_') },
      'Cập nhật thông tin thành công',
    );
  }

  async logout(
    userId: string,
    jti: string | undefined,
    fcmToken?: string,
    clientId?: string,
  ) {
    try {
      const userObjectId = Utils.convertToObjectIdMongoose(userId);

      if (jti) {
        // Redis blacklist (fast path) — TTL = max remaining token life.
        // Verifiers (auth middleware, socket gateways) check Redis first.
        await this.blacklistJti(userId, jti);

        // DB blacklist scoped to THIS device's Keys row. Survives Redis
        // flush + provides a permanent revocation record. Falls back
        // to user-wide if clientId is missing (legacy callers).
        const filter: Record<string, unknown> = { tkn_userId: userObjectId };
        if (clientId) filter.tkn_clientId = clientId;
        await this.keyModel.findOneAndUpdate(filter, {
          $addToSet: { tkn_jit: jti },
        });
      }

      if (fcmToken) {
        // Redis: remove from the user's FCM set so notifications stop
        // fanning out to this token.
        await this.redis.sRem(this.key.USER_FCM_TOKENS(userId), fcmToken);
      }

      // Soft-delete the device session. Row stays for history; flag +
      // null fcmToken signal "ended". Scope by clientId when available
      // so we don't accidentally revoke a sibling device.
      if (clientId) {
        await this.keyModel.updateOne(
          { tkn_userId: userObjectId, tkn_clientId: clientId },
          {
            $set: {
              tkn_fcmToken: null,
              tkn_revokedAt: new Date(),
              tkn_revokedReason: 'logout',
            },
          },
        );
      }

      return Response.success(null, 'Đăng xuất thành công');
    } catch {
      // Token invalid or expired, just ignore
      return Response.success(null, 'Đăng xuất thành công');
    }
  }

  /**
   * Logout EVERY device for the user. Used by the "Đăng xuất tất cả
   * thiết bị" action in account settings. Wipes all Keys docs for the
   * user, blacklists every JTI we know about (best-effort — Redis TTLs
   * may have aged some out already, in which case JWT exp is the
   * remaining safety net).
   */
  async logoutAllDevices(userId: string) {
    const userObjectId = Utils.convertToObjectIdMongoose(userId);
    const sessions = await this.keyModel
      .find({ tkn_userId: userObjectId, tkn_revokedAt: null })
      .lean()
      .exec();

    // Blacklist every known JTI in Redis. Iterate ACTIVE sessions
    // only — already-revoked rows have nothing live left to blacklist.
    for (const s of sessions) {
      for (const jti of s.tkn_jit ?? []) {
        await this.blacklistJti(userId, jti).catch(() => undefined);
      }
    }

    // Soft-revoke every active session. History rows stay intact.
    await this.keyModel.updateMany(
      { tkn_userId: userObjectId, tkn_revokedAt: null },
      {
        $set: {
          tkn_fcmToken: null,
          tkn_revokedAt: new Date(),
          tkn_revokedReason: 'logout_all',
        },
      },
    );

    // Clear Redis FCM set — no active devices left to push to.
    await this.redis
      .delKey(this.key.USER_FCM_TOKENS(userId))
      .catch(() => undefined);

    return Response.success(null, 'Đã đăng xuất khỏi tất cả thiết bị');
  }

  /**
   * Logout a SPECIFIC device by its clientId — invoked from the
   * settings UI's session list. Caller must be the same user (verified
   * upstream by AuthMiddleware) but doesn't need to BE that device.
   */
  async logoutDevice(userId: string, clientId: string) {
    if (!clientId) {
      return Response.error('Thiếu clientId thiết bị', 400);
    }
    const userObjectId = Utils.convertToObjectIdMongoose(userId);
    const session = await this.keyModel
      .findOne({ tkn_userId: userObjectId, tkn_clientId: clientId })
      .lean()
      .exec();

    if (!session) {
      return Response.error('Phiên thiết bị không tồn tại', 404);
    }
    if (session.tkn_revokedAt) {
      // Already revoked — idempotent success keeps the UI flow simple.
      return Response.success(null, 'Thiết bị đã đăng xuất từ trước');
    }

    // Blacklist every JTI on that session (the device's history of
    // refresh-rotations). After this, that device's tokens — current
    // OR cached — bounce on the next request.
    for (const jti of session.tkn_jit ?? []) {
      await this.blacklistJti(userId, jti).catch(() => undefined);
    }

    if (session.tkn_fcmToken) {
      await this.redis
        .sRem(this.key.USER_FCM_TOKENS(userId), session.tkn_fcmToken)
        .catch(() => undefined);
    }

    // Soft-revoke — keep the row as login history.
    await this.keyModel.updateOne(
      { tkn_userId: userObjectId, tkn_clientId: clientId },
      {
        $set: {
          tkn_fcmToken: null,
          tkn_revokedAt: new Date(),
          tkn_revokedReason: 'logout_device',
        },
      },
    );

    return Response.success(null, 'Đã đăng xuất thiết bị');
  }

  /**
   * List active device sessions for the user — backs the "Quản lý thiết
   * bị" page in settings. Returns one entry per Keys document with
   * device/origin info so the FE can render a recognisable list ("Chrome
   * trên Windows • Hồ Chí Minh • last seen 5 phút trước").
   */
  async listSessions(
    userId: string,
    currentClientId?: string,
    opts?: { includeRevoked?: boolean },
  ) {
    const userObjectId = Utils.convertToObjectIdMongoose(userId);
    const filter: Record<string, unknown> = { tkn_userId: userObjectId };
    if (!opts?.includeRevoked) {
      // Default: only active sessions (the "Thiết bị đang đăng nhập"
      // tab). Pass includeRevoked=true for the full login-history view.
      filter.tkn_revokedAt = null;
    }
    const sessions = await this.keyModel
      .find(filter)
      .sort({ tkn_lastSeenAt: -1, updatedAt: -1 })
      .lean()
      .exec();

    return Response.success(
      sessions.map((s) => ({
        clientId: s.tkn_clientId,
        ip: s.tkn_ip,
        userAgent: s.tkn_userAgent,
        deviceInfo: s.tkn_deviceInfo,
        location: s.tkn_location,
        lastSeenAt: s.tkn_lastSeenAt,
        lastSeenIp: s.tkn_lastSeenIp,
        revokedAt: s.tkn_revokedAt,
        revokedReason: s.tkn_revokedReason,
        // Mongoose timestamps — use as "first seen" / session start.
        createdAt: (s as { createdAt?: Date }).createdAt ?? null,
        // FE marks this row as "this device" so the logout button is
        // labelled "Đăng xuất thiết bị này" + can't be the current one
        // (would lock the UI mid-request).
        isCurrent: currentClientId ? s.tkn_clientId === currentClientId : false,
      })),
      'Danh sách thiết bị',
    );
  }

  /**
   * Refresh token logic: now takes userId and jti as input, like logout, for consistency.
   * Optionally, you can still support the old token string for backward compatibility.
   */
  /**
   * Refresh token:
   * - Input: userId và jti (được lấy từ Middleware/Guard)
   * - Logic:
   * 1. Check Redis & DB xem token cũ còn sống không.
   * 2. Hủy token cũ (Remove Redis + Add Blacklist DB) -> Y hệt logout.
   * 3. Lấy info user mới nhất từ DB (để đảm bảo role/permission update).
   * 4. Ký token mới với jti mới.
   */
  async refreshToken(
    userId: string,
    jti: string,
    clientId: string,
    deviceContext?: DeviceContextInput,
  ) {
    try {
      if (!userId || !jti) {
        throw new UnauthorizedException('Token không hợp lệ (thiếu thông tin)');
      }

      // Migration handling: tokens issued before the per-device
      // refactor don't carry `clientId` in their JWT payload. Instead
      // of bouncing those users (forces logout mid-session, drops
      // sockets / live calls), promote the refresh into a fresh
      // device session — generate a clientId, create a Keys row, and
      // sign new tokens with the new id. Once the old refresh token
      // rotates out, the user is fully on the new shape.
      const isLegacyTokenWithoutClientId = !clientId;
      const userObjectId = Utils.convertToObjectIdMongoose(userId);

      // --- CHECK PHASE ---
      // BLACKLIST checks (Redis + DB) scoped to (userId, clientId). DB
      // lookup also ensures the device session still exists — if the
      // user revoked this device from Settings, no Keys row matches and
      // we reject. Legacy path skips the Keys check (no row exists yet).
      const [redisRevoked, sessionDoc] = await Promise.all([
        this.redis.getData<string>(this.key.REFRESH_TOKEN(userId, jti)),
        isLegacyTokenWithoutClientId
          ? Promise.resolve(null)
          : this.keyModel
              .findOne({
                tkn_userId: userObjectId,
                tkn_clientId: clientId,
              })
              .lean()
              .exec(),
      ]);

      if (redisRevoked) {
        throw new UnauthorizedException(
          'Refresh token không hợp lệ hoặc đã bị thu hồi',
        );
      }
      if (!isLegacyTokenWithoutClientId) {
        if (!sessionDoc) {
          throw new UnauthorizedException('Phiên thiết bị không còn tồn tại');
        }
        if (sessionDoc.tkn_revokedAt) {
          throw new UnauthorizedException(
            'Phiên đã bị huỷ — vui lòng đăng nhập lại',
          );
        }
        if (sessionDoc.tkn_jit?.includes(jti)) {
          throw new UnauthorizedException(
            'Refresh token không hợp lệ hoặc đã bị thu hồi',
          );
        }
      }

      // For legacy tokens, mint a fresh clientId now and treat
      // everything below as a brand-new device session (Keys row
      // created via upsert in the rotate phase).
      const effectiveClientId = clientId || Utils.randomId();

      // --- ROTATE PHASE ---
      // Blacklist the OLD jti so replay hits the redisRevoked branch
      // above. Upsert the Keys row: existing devices update lastSeen,
      // legacy migrations create a fresh row with the new clientId.
      await Promise.all([
        this.blacklistJti(userId, jti),
        this.keyModel.updateOne(
          { tkn_userId: userObjectId, tkn_clientId: effectiveClientId },
          {
            $addToSet: { tkn_jit: jti },
            $set: this.buildDeviceContextUpdate(deviceContext),
            $setOnInsert: {
              tkn_userId: userObjectId,
              tkn_clientId: effectiveClientId,
            },
          },
          { upsert: true },
        ),
      ]);

      // --- ISSUE PHASE ---
      const user = await this.userModel.findById(userId).lean().exec();
      if (!user) throw new UnauthorizedException('User không tồn tại');

      const newJti = Utils.randomId();
      const userData = Utils.omit(user, ['usr_salt', '__v']);

      // PRESERVE clientId across rotation — that's the whole point of
      // device-scoped sessions. Only jti rotates. For legacy tokens we
      // already minted `effectiveClientId` above, so the new pair is
      // first-class on the new shape.
      const payload = {
        ...userData,
        jti: newJti,
        clientId: effectiveClientId,
        _id: userId,
      };

      const [newAccessToken, newRefreshToken] = await Promise.all([
        this.jwtService.signAsync(payload, {
          secret: process.env.JWT_ACCESS_SECRET || 'access_secret',
          expiresIn: (process.env.JWT_ACCESS_EXPIRES_IN ||
            '15m') as JwtSignOptions['expiresIn'],
        }),
        this.jwtService.signAsync(payload, {
          secret: process.env.JWT_REFRESH_SECRET || 'refresh_secret',
          expiresIn: (process.env.JWT_REFRESH_EXPIRES_IN ||
            '7d') as JwtSignOptions['expiresIn'],
        }),
      ]);

      return Response.success(
        {
          accessToken: newAccessToken,
          refreshToken: newRefreshToken,
          expiresIn: this.refreshTtlSeconds,
          user: Utils.unprefix(userData, 'usr_'),
        },
        'Làm mới token thành công',
      );
    } catch (error) {
      throw new UnauthorizedException(
        `Lỗi refresh token: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
