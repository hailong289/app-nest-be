// MongoDB exports
//
// GUARDRAIL (Sprint 0): Do NOT import model types from this barrel in apps or shared libs
// (libs/dto, libs/types) that are OUTSIDE the model's owner service.
// Import shared domain types from libs/types instead.
// Violation is caught by: npm run check:db-ownership
export * from './mongo/model';
export { MongoConnectionModule } from './mongo/mongo-connection.module';
/**
 * @deprecated Use the correct *DatabaseModule for your service instead.
 * MongodbModule will be removed after all apps migrate.
 */
export { MongodbModule } from './mongo/mongodb.module';
export {
  AiDatabaseModule,
  AuthDatabaseModule,
  ChatDatabaseModule,
  FilesystemDatabaseModule,
  LearningDatabaseModule,
  NotificationDatabaseModule,
} from './mongo/service-database.modules';

// Redis exports
export { RedisModule } from './redis/redis.module';
export { RedisService } from './redis/redis.service';
export * from './config';
export { SharedBullModule } from './bull/bull.module';
