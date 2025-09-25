import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import Utils from 'libs/helpers/utils';
import { HydratedDocument } from 'mongoose';
import { Types } from 'mongoose';

export type KeyDocument = HydratedDocument<Key>;

@Schema({ timestamps: true, collection: 'Keys' })
export class Key {
    @Prop({ type: Types.ObjectId, ref: 'User', required: true })
    tkn_userId: Types.ObjectId;

    @Prop({
        type: String,
        default: () => Utils.randomId(),
        unique: true,
        index: true,
    })
    tkn_clientId: string;

    @Prop({ type: String, default: null })
    tkn_fcmToken: string | null;

    @Prop({ type: [String], default: [] })
    tkn_jit: string[];
}

export const KeySchema = SchemaFactory.createForClass(Key);