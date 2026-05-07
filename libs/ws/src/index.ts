/**
 * libs/ws — cross-service Socket.IO bridge.
 *
 * Provides RemoteSocketEmitter so backend microservices (chat, ai, ...) can
 * emit Socket.IO events to browser clients connected to apps/socket. Works
 * via Redis pub/sub — no message queue, no consumer needed.
 *
 * Socket-server-specific code (gateways, JWT guard, RedisIoAdapter) lives
 * inside apps/socket/src/ws/.
 */
export * from './remote-emitter';
export * from './remote-emitter.module';
