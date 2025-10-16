import { LoginDto, RegisterDto } from '@app/dto';
import { Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Response } from 'libs/helpers/response';
import { compare, hash } from 'bcrypt';
import { JwtService } from '@nestjs/jwt';
import Utils from 'libs/helpers/utils';
import axios from 'axios';
import Userschema, { User } from 'libs/db/src/mongo/model/user.model';
import { Key } from 'libs/db/src/mongo/model/keys.model';
import { Otp } from 'libs/db/src/mongo/model/otp.model';

@Injectable()
export class AuthService {
  private readonly gatewayUrl = process.env.GATEWAY_URL;
  constructor(
    @InjectModel(Userschema.name) private readonly userModel: Model<User>,
    @InjectModel('Key') private readonly keyModel: Model<Key>,
    @InjectModel('Otp') private readonly otpModel: Model<Otp>,
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

    const userData = Utils.omit(user.toObject(), ['usr_salt', '__v']);

    const accessToken = this.jwtService.sign(userData, {
      secret: process.env.JWT_ACCESS_SECRET || 'access_secret',
      expiresIn: '7d', // access token sống 7 ngày
    });

    const refreshToken = this.jwtService.sign(userData, {
      secret: process.env.JWT_REFRESH_SECRET || 'refresh_secret',
      expiresIn: '30d', // refresh token sống 30 ngày
    });

    if (loginDto.fcmToken) {
      // Lưu fcmToken vào database
      await this.keyModel.create({
        tkn_userId: user._id,
        tkn_fcmToken: loginDto.fcmToken,
        tkn_createdAt: new Date(),
      });
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
      usr_avatar: `https://avatar.iran.liara.run/public/username?username=${registerDto.fullname.toLocaleLowerCase().replace(/\s+/g, '')}`,
    });

    try {
      await newUser.save();
      const userData = Utils.omit(newUser.toObject(), ['usr_salt', '__v']);
      const accessToken = this.jwtService.sign(userData, {
        secret: process.env.JWT_ACCESS_SECRET || 'access_secret',
        expiresIn: '7d', // access token sống 7 ngày
      });

      const refreshToken = this.jwtService.sign(userData, {
        secret: process.env.JWT_REFRESH_SECRET || 'refresh_secret',
        expiresIn: '30d', // refresh token sống 30 ngày
      });

      if (registerDto.fcmToken) {
        // Lưu fcmToken vào database
        await this.keyModel.create({
          tkn_userId: newUser._id,
          tkn_fcmToken: registerDto.fcmToken,
          tkn_createdAt: new Date(),
        });
      }

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

  logout(userId: string) {
    // Xóa hết key của user khi logout
    this.keyModel.deleteMany({ tkn_userId: new Types.ObjectId(userId) }).exec();
    return Response.success(null, 'Đăng xuất thành công');
  }

  async refreshToken(userId: string) {
    // Tạo access token mới dựa trên userId
    const user = await this.userModel.findById(userId).exec();
    if (!user) {
      return Response.error('User not found', 404);
    }
    const userData = Utils.omit(user.toObject(), ['usr_salt', '__v']);
    const accessToken = this.jwtService.sign(userData, {
      secret: process.env.JWT_ACCESS_SECRET || 'access_secret',
      expiresIn: '7d', // access token sống 7 ngày
    });

    const refreshToken = this.jwtService.sign(userData, {
      secret: process.env.JWT_REFRESH_SECRET || 'refresh_secret',
      expiresIn: '30d', // refresh token sống 30 ngày
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
      const accessToken = this.jwtService.sign(
        Utils.omit(user.toObject(), ['usr_salt', '__v']),
        {
          secret: process.env.JWT_ACCESS_SECRET || 'access_secret',
          expiresIn: '30m', // access token sống 30 phút
        },
      );
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
      const accessToken = this.jwtService.sign(
        Utils.omit(user.toObject(), ['usr_salt', '__v']),
        {
          secret: process.env.JWT_ACCESS_SECRET || 'access_secret',
          expiresIn: '30m', // access token sống 30 phút
        },
      );
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
}
