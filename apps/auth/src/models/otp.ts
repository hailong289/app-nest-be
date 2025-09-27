import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type OtpDocument = HydratedDocument<Otp>;

@Schema({ timestamps: true, collection: 'Otps' })
export class Otp {
    @Prop({
        type: String,
        required: true,
        index: true, // Index for faster queries
    })
    indicator: string;

    @Prop({
        type: String,
        required: true,
    })
    otp: string;

    @Prop({
        type: Date,
        default: Date.now,
        expires: 300, // 5 minutes in seconds (MongoDB TTL)
        index: true,
    })
    createdAt: Date;

    @Prop({
        type: String,
        enum: ['register', 'reset-password', 'change-password'],
        default: 'register',
    })
    type: string;

    @Prop({
        type: Boolean,
        default: false,
    })
    isUsed: boolean;
}

export const OtpSchema = SchemaFactory.createForClass(Otp);

// Create compound index for better performance
OtpSchema.index({ email: 1, otp: 1 });
OtpSchema.index({ email: 1, type: 1 });