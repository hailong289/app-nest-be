import {
  LoginDto,
  RegisterDto,
  UpdateAvatarDto,
  UpdateProfileDto,
  SearchUserDto,
} from '@app/dto';
import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Response } from 'libs/helpers/response';
import { compare, hash } from 'bcrypt';
import { JwtService } from '@nestjs/jwt';
import Utils from 'libs/helpers/utils';
import axios from 'axios';
import Userschema, { User } from 'libs/db/src/mongo/model/user.model';
import { Key } from 'libs/db/src/mongo/model/keys.model';
import { Otp } from 'libs/db/src/mongo/model/otp.model';
import { RedisService } from 'libs/db/src';
import { REDISKEY } from '@app/constants/RedisKey';

@Injectable()
export class AuthService {
  private readonly gatewayUrl = process.env.GATEWAY_URL;
  private readonly key = REDISKEY;
  constructor(
    @InjectModel(Userschema.name) private readonly userModel: Model<User>,
    @InjectModel('Key') private readonly keyModel: Model<Key>,
    @InjectModel('Otp') private readonly otpModel: Model<Otp>,
    private readonly redis: RedisService,
    @Inject() private readonly jwtService: JwtService,
  ) {}

  async login(loginDto: LoginDto) {
    console.log('Login attempt:', loginDto);
    const user = await this.userModel
      .findOne({
        $or: [
          { usr_email: loginDto.username },
          { usr_phone: loginDto.username },
        ],
      })
      .exec();

    console.log('for username:', loginDto);

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

    // Generate JTI
    const jti = Utils.randomId();

    const accessToken = this.jwtService.sign(
      { ...userData, jti },
      {
        secret: process.env.JWT_ACCESS_SECRET || 'access_secret',
        expiresIn: '7d', // access token sống 7 ngày
      },
    );

    const refreshToken = this.jwtService.sign(
      { ...userData, jti },
      {
        secret: process.env.JWT_REFRESH_SECRET || 'refresh_secret',
        expiresIn: '30d', // refresh token sống 30 ngày
      },
    );
    // Store JTI in Redis
    await this.redis.setData(
      this.key.REFRESH_TOKEN(user._id.toString(), jti),
      'valid',
      30 * 24 * 60 * 60,
    );

    // Update Key document
    const updateOps: {
      $addToSet?: { tkn_fcmToken: string };
    } = {};

    if (loginDto.fcmToken) {
      updateOps.$addToSet = { tkn_fcmToken: loginDto.fcmToken };
      // save info redis
      await this.redis.sAdd(
        this.key.USER_FCM_TOKENS(user._id.toString()),
        loginDto.fcmToken,
      );
    }

    await this.keyModel.findOneAndUpdate({ tkn_userId: user._id }, updateOps, {
      upsert: true,
    });

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

  async register(registerDto: RegisterDto) {
    if (
      registerDto.type === 'email' &&
      !Utils.isEmail(registerDto.email || '')
    ) {
      return Response.error('Email không hợp lệ', 400, 'Bad Request');
    }

    if (
      registerDto.type === 'phone' &&
      !Utils.isPhone(registerDto.phone || '')
    ) {
      return Response.error('Số điện thoại không hợp lệ', 400, 'Bad Request');
    }

    const existingUser = await this.userModel
      .findOne({
        [registerDto.type === 'email' ? 'usr_email' : 'usr_phone']:
          registerDto.type === 'email' ? registerDto.email : registerDto.phone,
      })
      .exec();

    if (existingUser) {
      return Response.error(
        registerDto.type === 'email'
          ? 'Email đã được sử dụng'
          : 'Số điện thoại đã được sử dụng',
        400,
      );
    }

    const hashedPassword = await hash(registerDto.password, 10);

    const newUser = new this.userModel({
      usr_fullname: registerDto.fullname,
      usr_email: registerDto.email || '',
      usr_phone: registerDto.phone || '',
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
      // Generate JTI
      const jti = Utils.randomId();
      const accessToken = this.jwtService.sign(
        { ...userData, jti },
        {
          secret: process.env.JWT_ACCESS_SECRET || 'access_secret',
          expiresIn: '7d', // access token sống 7 ngày
        },
      );

      const refreshToken = this.jwtService.sign(
        { ...userData, jti },
        {
          secret: process.env.JWT_REFRESH_SECRET || 'refresh_secret',
          expiresIn: '30d', // refresh token sống 30 ngày
        },
      );

      if (registerDto.fcmToken) {
        // Lưu fcmToken vào database
        await this.keyModel.create({
          tkn_userId: newUser._id,
          tkn_fcmToken: [registerDto.fcmToken],
          tkn_createdAt: new Date(),
        });
        // save to redis
        await this.redis.sAdd(
          this.key.USER_FCM_TOKENS(newUser._id.toString()),
          registerDto.fcmToken,
        );
      }
      // Store JTI in Redis
      await this.redis.setData(
        this.key.REFRESH_TOKEN(newUser._id.toString(), jti),
        'valid',
        30 * 24 * 60 * 60,
      );

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
      return { success: false, message: 'User not found' };
    }

    return {
      success: true,
      user: Utils.omit(user.toObject(), ['usr_salt', '__v']),
    };
  }

  async verifyOtp(
    indicator: string,
    otp: string,
    type: string = 'reset-password',
  ) {
    const keyEntry = await this.otpModel
      .findOne({ indicator: indicator, otp, type })
      .exec();

    console.log('Verifying OTP for indicator:', indicator, 'with OTP:', otp);

    if (!keyEntry) {
      return Response.error(
        'Mã OTP không hợp lệ hoặc đã hết hạn',
        400,
        'Invalid OTP',
      );
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
        expiresIn: '30m', // access token sống 30 phút
      });
      return Response.success({ accessToken }, 'Xác thực OTP thành công');
    }
    // OTP hợp lệ, xóa entry sau khi sử dụng
    await this.otpModel.deleteOne({ _id: keyEntry._id }).exec();
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

    try {
      if (isMobile) {
        // Lưu OTP vào database để verify
        const otpCode = Utils.generateOtp(6);
        await this.otpModel.create({
          indicator: email,
          otp: otpCode,
          expiresAt: Date.now() + 5 * 60 * 1000, // 5 phút
          type: 'reset-password',
          userId: user.usr_id,
        });
        // Gửi OTP về email thông qua Notification Service
        await axios.post(`${this.gatewayUrl}/api/notifications/send-otp`, {
          email: email,
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
        email: email,
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
    await user.save();
    return Response.success(null, 'Cập nhật thông tin thành công');
  }

  async logout(userId: string, jti: string) {
    try {
      if (jti) {
        // Remove from Redis
        await this.redis.delKey(this.key.REFRESH_TOKEN(userId, jti));

        // Add to Blacklist in DB
        await this.keyModel.findOneAndUpdate(
          { tkn_userId: Utils.convertToObjectIdMongoose(userId) },
          { $addToSet: { tkn_jit: jti } },
          { upsert: true },
        );
      }

      return Response.success(null, 'Đăng xuất thành công');
    } catch {
      // Token invalid or expired, just ignore
      return Response.success(null, 'Đăng xuất thành công');
    }
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
  async refreshToken(userId: string, jti: string) {
    try {
      // Input Validation
      if (!userId || !jti) {
        throw new UnauthorizedException('Token không hợp lệ (thiếu thông tin)');
      }

      // --- CHECK PHASE ---
      // Check 1: Redis (Whitelist) - Xem session còn sống không
      const isValidRedis: string | null = await this.redis.getData(
        this.key.REFRESH_TOKEN(userId, jti),
      );

      // Check 2: MongoDB (Blacklist) - Xem token này đã bị revoke chưa
      // Lưu ý: userId convert sang ObjectId để query chuẩn
      const userObjectId = Utils.convertToObjectIdMongoose(userId);
      const isBlacklisted = await this.keyModel
        .findOne({
          tkn_userId: userObjectId,
          tkn_jit: jti,
        })
        .lean()
        .exec();

      // Nếu không có trong Redis HOẶC đã nằm trong Blacklist -> Chặn
      if (!isValidRedis || isBlacklisted) {
        // Security Alert: Có thể log lại vụ này vì nghi ngờ hack
        throw new UnauthorizedException(
          'Refresh token không hợp lệ hoặc đã bị thu hồi',
        );
      }

      // --- REVOKE PHASE (Giống Logout) ---
      // Xóa token cũ khỏi Redis & ném vào Blacklist DB
      await Promise.all([
        this.redis.delKey(this.key.REFRESH_TOKEN(userId, jti)),
        this.keyModel.updateOne(
          { tkn_userId: userObjectId },
          { $addToSet: { tkn_jit: jti } },
          { upsert: true },
        ),
      ]);

      // --- ISSUE PHASE ---
      // Lấy user mới nhất từ DB (để đảm bảo role/permission không bị cũ)
      const user = await this.userModel.findById(userId).lean().exec();
      if (!user) throw new UnauthorizedException('User không tồn tại');

      const newJti = Utils.randomId();
      const userData = Utils.omit(user, ['usr_salt', '__v']);

      // Payload mới
      const payload = {
        ...userData, // Reset time
        jti: newJti,
        _id: userId,
      };

      // Ký cặp token mới
      const [newAccessToken, newRefreshToken] = await Promise.all([
        this.jwtService.signAsync(payload, {
          secret: process.env.JWT_ACCESS_SECRET || 'access_secret',
          expiresIn: '7d',
        }),
        this.jwtService.signAsync(payload, {
          secret: process.env.JWT_REFRESH_SECRET || 'refresh_secret',
          expiresIn: '30d',
        }),
      ]);

      // Active token mới trong Redis
      await this.redis.setData(
        this.key.REFRESH_TOKEN(userId, newJti),
        'valid',
        30 * 24 * 60 * 60,
      );

      return Response.success(
        {
          accessToken: newAccessToken,
          refreshToken: newRefreshToken,
          expiresIn: 7 * 24 * 60 * 60,
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

  async searchUser(searchDto: SearchUserDto) {
    const { keyword, page = 1, limit = 10 } = searchDto;
    const skip = (page - 1) * limit;
    const regex = new RegExp(keyword, 'i');

    const users = await this.userModel
      .find({
        $or: [
          { usr_fullname: regex },
          { usr_email: regex },
          { usr_phone: regex },
        ],
      })
      .skip(skip)
      .limit(limit)
      .select('-usr_password -usr_salt -__v')
      .exec();

    return Response.success(users, 'Tìm kiếm thành công');
  }
}
