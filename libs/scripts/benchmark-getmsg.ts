import axios from 'axios';

type BenchResult = {
  ok: boolean;
  status?: number;
  latencyMs: number;
  error?: string;
};

function getEnvNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function toFixed(n: number, digits = 2): number {
  return Number(n.toFixed(digits));
}

async function runOne(url: string, headers: Record<string, string>, timeoutMs: number): Promise<BenchResult> {
  const startedAt = Date.now();
  try {
    const res = await axios.get(url, {
      headers,
      timeout: timeoutMs,
      validateStatus: () => true,
    });
    const latencyMs = Date.now() - startedAt;
    const ok = res.status >= 200 && res.status < 300;
    return {
      ok,
      status: res.status,
      latencyMs,
      error: ok ? undefined : `HTTP_${res.status}`,
    };
  } catch (err: any) {
    const latencyMs = Date.now() - startedAt;
    return {
      ok: false,
      latencyMs,
      error: err?.message ?? 'REQUEST_FAILED',
    };
  }
}

async function main() {
  const baseUrl = process.env.BENCH_BASE_URL || 'http://localhost:5000';
  const roomId = process.env.BENCH_ROOM_ID;
  if (!roomId) {
    console.error('Missing BENCH_ROOM_ID');
    console.error('Example: BENCH_ROOM_ID=abc BENCH_TOKEN=... yarn bench:getmsg');
    process.exit(1);
  }

  const limit = getEnvNumber('BENCH_LIMIT', 50);
  const warmupRequests = getEnvNumber('BENCH_WARMUP', 40);
  const measureRequests = getEnvNumber('BENCH_REQUESTS', 300);
  const concurrency = getEnvNumber('BENCH_CONCURRENCY', 10);
  const timeoutMs = getEnvNumber('BENCH_TIMEOUT_MS', 15000);
  const token = process.env.BENCH_TOKEN || '';
  const cookie = process.env.BENCH_COOKIE || '';

  const url = `${baseUrl.replace(/\/$/, '')}/chat/messages/${roomId}?limit=${limit}`;
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (cookie) headers.Cookie = cookie;

  console.log('=== getMsg benchmark config ===');
  console.log(
    JSON.stringify(
      {
        url,
        limit,
        warmupRequests,
        measureRequests,
        concurrency,
        timeoutMs,
        hasToken: Boolean(token),
        hasCookie: Boolean(cookie),
      },
      null,
      2,
    ),
  );

  // Warm-up
  console.log(`\nWarm-up: ${warmupRequests} requests...`);
  for (let i = 0; i < warmupRequests; i++) {
    await runOne(url, headers, timeoutMs);
  }
  console.log('Warm-up done.');

  // Measure
  console.log(`\nMeasure: ${measureRequests} requests (concurrency=${concurrency})...`);
  const startedAt = Date.now();
  const results: BenchResult[] = [];
  let launched = 0;

  async function worker() {
    while (launched < measureRequests) {
      const idx = launched++;
      if (idx >= measureRequests) return;
      const r = await runOne(url, headers, timeoutMs);
      results.push(r);
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  const elapsedMs = Date.now() - startedAt;

  const latencies = results.map((r) => r.latencyMs).sort((a, b) => a - b);
  const success = results.filter((r) => r.ok).length;
  const failed = results.length - success;
  const errorRate = results.length ? (failed / results.length) * 100 : 0;

  const p50 = percentile(latencies, 50);
  const p95 = percentile(latencies, 95);
  const p99 = percentile(latencies, 99);
  const avg = latencies.length ? latencies.reduce((s, n) => s + n, 0) / latencies.length : 0;
  const rps = elapsedMs > 0 ? (results.length * 1000) / elapsedMs : 0;

  const topErrors = Object.entries(
    results
      .filter((r) => !r.ok)
      .reduce<Record<string, number>>((acc, r) => {
        const key = r.error || 'UNKNOWN';
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      }, {}),
  )
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([error, count]) => ({ error, count }));

  console.log('\n=== getMsg benchmark summary ===');
  console.log(
    JSON.stringify(
      {
        totalRequests: results.length,
        success,
        failed,
        errorRatePercent: toFixed(errorRate),
        latencyMs: {
          min: latencies[0] ?? 0,
          p50,
          p95,
          p99,
          max: latencies[latencies.length - 1] ?? 0,
          avg: toFixed(avg),
        },
        throughputRps: toFixed(rps),
        elapsedMs,
        topErrors,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});

