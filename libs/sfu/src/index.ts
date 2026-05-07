/**
 * libs/sfu — client-safe SFU library.
 *
 * Provides:
 *   - SfuRpcClient / SfuRpcModule  → gRPC client to apps/sfu (mediasoup VM).
 *   - UnifiedSignalHandler         → routes WS signals to SFU (via RPC) or P2P.
 *
 * Does NOT depend on the mediasoup native binary, so it bundles cleanly into
 * apps/socket (Cloud Run). The mediasoup engine itself lives in apps/sfu.
 */
export * from './rpc/sfu-rpc.client';
export * from './rpc/sfu-rpc.module';
export * from './unified-signal.handler';
