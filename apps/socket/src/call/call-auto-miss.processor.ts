import { Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import type { Job } from 'bull';
import { CallGateway } from './call.gateway';
import {
  CALL_AUTO_MISS_QUEUE,
  type AutoMissJobData,
} from './call-auto-miss.constants';

/**
 * Bull processor for auto-miss jobs. Replaces the in-process setTimeout
 * approach so the timer survives pod restarts and is safe under multi-pod
 * autoscale (Bull's distributed locks ensure only one worker handles each
 * job).
 *
 * Job lifecycle:
 *   - Enqueued in handleCallRequest with `delay: 30_000`.
 *   - At 30s mark, Redis schedules execution; one worker pod claims it.
 *   - Processor delegates to `callGateway.executeAutoMiss` which checks
 *     whether the FE already accepted/rejected (via the pending-invites
 *     Redis hash) and, if not, synthesizes a missed-status call:end.
 *
 * Idempotency: if FE acted first, executeAutoMiss bails out — gRPC
 * EndCall is NOT called twice for the same (callee, callId).
 *
 * Note: `forwardRef` was previously used here to inject `CallGateway`
 * but it's NOT actually needed — the dependency graph is acyclic
 * (gateway depends on Queue, processor depends on gateway). The
 * forwardRef + same-file constants caused a real JS module-load cycle
 * (gateway.ts ↔ processor.ts) which forwardRef does NOT fix. Constants
 * are now in `call-auto-miss.constants.ts` so the cycle is broken.
 */
@Processor(CALL_AUTO_MISS_QUEUE)
export class CallAutoMissProcessor {
  private readonly logger = new Logger(CallAutoMissProcessor.name);

  constructor(private readonly callGateway: CallGateway) {}

  @Process()
  async handle(job: Job<AutoMissJobData>): Promise<void> {
    const { calleeId, callId, roomId } = job.data;
    try {
      await this.callGateway.executeAutoMiss(calleeId, callId, roomId);
    } catch (err) {
      // Don't rethrow — Bull would retry per defaultJobOptions, but
      // auto-miss is best-effort. If the FE finally fires call:end
      // before retry, the second auto-miss will see no pending invite
      // and bail anyway. Logging is enough.
      this.logger.warn(
        `[CALL] auto-miss job failed for ${callId}/${calleeId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
}
