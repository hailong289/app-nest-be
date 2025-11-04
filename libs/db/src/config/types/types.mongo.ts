// libs/shared-db/src/mongo.options.ts
export interface MongoRegisterOptions {
  uri?: string;
  dbName?: string;
  connectionName?: string; // nếu muốn đặt tên connection
  directConnection?: boolean;
}
