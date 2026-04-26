import { Process, Processor } from '@nestjs/bull';
import { Inject, Logger, forwardRef } from '@nestjs/common';
import type { Job } from 'bull';
import { CallGateway } from './call.gateway';

/**
 * Queue name. Exported for use in module registration and gateway.
 */
export const CALL_AUTO_MISS_QUEUE = 'call-auto-miss';

/**
 * Job payload — minimum data needed to fire `call:end status='missed'`
 * on behalf of a callee whose FE never answered.
 */
export interface AutoMissJobData {
  calleeId: string;
  callId: string;
  roomId: string;
}

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
 */
@Processor(CALL_AUTO_MISS_QUEUE)
export class CallAutoMissProcessor {
  private readonly logger = new Logger(CallAutoMissProcessor.name);

  constructor(
    // forwardRef avoids the module-level circular dep:
    //   CallGateway uses Queue (from this module's BullModule.registerQueue)
    //   This processor uses CallGateway.
    // Bull's discovery instantiates the processor lazily, so by the time
    // `process()` runs the gateway is already resolved.
    @Inject(forwardRef(() => CallGateway))
    private readonly callGateway: CallGateway,
  ) {}

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
