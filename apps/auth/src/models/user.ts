import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import Utils from 'libs/helpers/utils';

export type UserDocument = User & Document;

@Schema({ timestamps: true, collection: "Users" })
export class User {
  @Prop({
    type: String,
    default: () => Utils.randomId(), 
  })
  usr_id: string;

  @Prop({
    type: String,
    unique: true,
    required: true,
    default: () => `usr_${Utils.randomId()}`, 
  })
  usr_slug: string;

  @Prop({
    type: String,
    required: true,
  })
  usr_fullname: string;

  @Prop({
    type: String,
    sparse: true,
  })
  usr_email: string;

  @Prop({
    type: String,
    sparse: true,
  })
  usr_phone: string;

  @Prop({
    type: String,
    required: true,
  })
  usr_salt: string;

  @Prop({
    type: String,
    default: 'https://example.com/default-avatar.png',
  })
  usr_avatar: string;

  @Prop({
    type: Date,
    default: Date.now,
  })
  usr_dateOfBirth: Date;

  @Prop({
    type: String,
    default: 'Not Specified',
  })
  usr_gender: string;

  @Prop({
    type: String,
    enum: ['active', 'inactive', 'banned'],
    default: 'active',
  })
  usr_status: string;
}

export const UserSchema = SchemaFactory.createForClass(User);