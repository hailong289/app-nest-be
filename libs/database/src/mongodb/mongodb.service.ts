import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection, ClientSession } from 'mongoose';

@Injectable()
export class MongoDBService implements OnModuleInit {
  private readonly logger = new Logger(MongoDBService.name);

  constructor(@InjectConnection() private readonly connection: Connection) {}

  onModuleInit() {
    this.logger.log(`Connected to MongoDB: ${this.connection.name}`);
  }

  async isConnected(): Promise<boolean> {
    return this.connection.readyState === 1; // 1 = connected
  }

  getDbHandle(): Connection {
    return this.connection;
  }

  async startSession(): Promise<ClientSession> {
    return this.connection.startSession();
  }
}
