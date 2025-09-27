import { LoginDto, RegisterDto } from '@app/dto';
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { User, UserDocument } from './models/user';
import { Model, Types } from 'mongoose';
import { Response } from 'libs/helpers/response';
import { compare, hash } from "bcrypt";
import { JwtService } from '@nestjs/jwt';
import Utils from 'libs/helpers/utils';
import { Key, KeyDocument } from './models/keys';

@Injectable()
export class AuthService {
  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(Key.name) private keyModel: Model<KeyDocument>,
    private jwtService: JwtService
  ) { }

  async login(loginDto: LoginDto) {
    console.log('Login attempt:', loginDto);
    const user = await this.userModel.findOne({
      $or: [{ usr_email: loginDto.username }, { usr_phone: loginDto.username }],
    }).exec();

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

    return Response.success(
      {
        accessToken,
        refreshToken,
        expiresIn: 7 * 24 * 60 * 60, // 7 days in seconds
        user: Utils.unprefix(userData, 'usr_'),
      },
      'Đăng nhập thành công'
    );
  }

  async register(registerDto: RegisterDto) {
    if (registerDto.type === 'email' && !Utils.isEmail(registerDto.email || '')) {
      return Response.error('Email không hợp lệ', 400, 'Bad Request');
    }

    if (registerDto.type === 'phone' && !Utils.isPhone(registerDto.phone || '')) {
      return Response.error('Số điện thoại không hợp lệ', 400, 'Bad Request');
    }

    const existingUser = await this.userModel.findOne({
      [registerDto.type === 'email' ? 'usr_email' : 'usr_phone']: registerDto.type === 'email' ? registerDto.email : registerDto.phone,
    }).exec();

    if (existingUser) {
      return Response.error(
        registerDto.type === 'email' ? 'Email đã được sử dụng' : 'Số điện thoại đã được sử dụng',
        400
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
      const userData = Utils.omit(newUser.toObject(), ['usr_salt', '__v']);
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
        'Đăng ký thành công'
      );
    } catch (error) {
      console.error('Auth register error:', error);
      return Response.error('Đăng ký thất bại', 400);
    }
  }

  async logout(userId: string) {
    // Xóa hết key của user khi logout
    this.keyModel.deleteMany({ tkn_userId: new Types.ObjectId(userId) }).exec(); 
    return Response.success(null, 'Đăng xuất thành công');
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
}