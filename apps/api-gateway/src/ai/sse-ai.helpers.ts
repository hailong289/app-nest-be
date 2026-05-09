import type { MessageEvent } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Observable } from 'rxjs';
import { timeout } from 'rxjs/operators';

export type SseAiEventName = 'start' | 'chunk' | 'progress' | 'done' | 'error';

export interface SseAiPayload {
  event: SseAiEventName;
  requestId: string;
  route: string;
  chunk?: string;
  progress?: number;
  metadata?: unknown;
  error?: string;
}

function messageEvent(
  event: SseAiEventName,
  payload: Omit<SseAiPayload, 'event'>,
): MessageEvent {
  const body: SseAiPayload = { event, ...payload };
  return {
    type: event,
    data: JSON.stringify(body),
  };
}

/**
 * Wraps a gRPC-backed Observable of `{ chunk: string }` into SSE MessageEvents:
 * start → chunk (per token/chunk) → done, or error (no done).
 */
export function wrapGrpcChunkStream(
  stream$: Observable<{ chunk: string }>,
  route: string,
  timeoutMs: number,
): Observable<MessageEvent> {
  return new Observable<MessageEvent>((subscriber) => {
    const requestId = randomUUID();
    subscriber.next(
      messageEvent('start', {
        requestId,
        route,
      }),
    );

    const sub = stream$.pipe(timeout(timeoutMs)).subscribe({
      next: (res) => {
        subscriber.next(
          messageEvent('chunk', {
            requestId,
            route,
            chunk: res.chunk,
          }),
        );
      },
      error: (err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        subscriber.next(
          messageEvent('error', {
            requestId,
            route,
            error: msg,
          }),
        );
        subscriber.complete();
      },
      complete: () => {
        subscriber.next(messageEvent('done', { requestId, route }));
        subscriber.complete();
      },
    });

    return () => sub.unsubscribe();
  });
}

function isGatewayErrorResult(value: unknown): value is {
  statusCode: number;
  message?: string;
  reasonStatusCode?: string;
  metadata?: unknown;
} {
  if (typeof value !== 'object' || value === null) return false;
  const sc = (value as { statusCode?: unknown }).statusCode;
  return typeof sc === 'number' && sc >= 400;
}

/**
 * Unary gRPC called via `GatewayService.dispatchGrpcRequest` → single SSE sequence:
 * start → chunk (metadata = full result) → done, or error.
 */
export function wrapUnaryGrpcAsSse(
  execute: () => Promise<unknown>,
  route: string,
): Observable<MessageEvent> {
  return new Observable<MessageEvent>((subscriber) => {
    const requestId = randomUUID();
    subscriber.next(messageEvent('start', { requestId, route }));

    void execute()
      .then((result) => {
        if (isGatewayErrorResult(result)) {
          subscriber.next(
            messageEvent('error', {
              requestId,
              route,
              error: result.message ?? 'Service error',
              metadata: result,
            }),
          );
        } else {
          subscriber.next(
            messageEvent('chunk', {
              requestId,
              route,
              metadata: result,
            }),
          );
          subscriber.next(messageEvent('done', { requestId, route }));
        }
        subscriber.complete();
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        subscriber.next(
          messageEvent('error', {
            requestId,
            route,
            error: msg,
          }),
        );
        subscriber.complete();
      });
  });
}
