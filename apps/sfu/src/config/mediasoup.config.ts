import { config } from 'dotenv';
import * as os from 'os';
import type { types as MediasoupTypes } from 'mediasoup';

config();

export const mediasoupConfig = {
  worker: {
    rtcMinPort: parseInt(process.env.MEDIASOUP_RTC_MIN_PORT || '40000', 10),
    rtcMaxPort: parseInt(process.env.MEDIASOUP_RTC_MAX_PORT || '49999', 10),
    logLevel: (process.env.MEDIASOUP_LOG_LEVEL ||
      'warn') as MediasoupTypes.WorkerLogLevel,
    logTags: ['info', 'ice', 'dtls', 'rtp', 'srtp', 'rtcp'],
  },
  router: {
    mediaCodecs: [
      {
        kind: 'audio' as const,
        mimeType: 'audio/opus',
        clockRate: 48000,
        channels: 2,
      },
      {
        kind: 'video' as const,
        mimeType: 'video/VP8',
        clockRate: 90000,
        parameters: {
          'x-google-start-bitrate': 1000,
        },
      },
      {
        kind: 'video' as const,
        mimeType: 'video/VP9',
        clockRate: 90000,
        parameters: {
          'profile-id': 2,
          'x-google-start-bitrate': 1000,
        },
      },
      {
        kind: 'video' as const,
        mimeType: 'video/H264',
        clockRate: 90000,
        parameters: {
          'packetization-mode': 1,
          'profile-level-id': '4d0032',
          'level-asymmetry-allowed': 1,
          'x-google-start-bitrate': 1000,
        },
      },
      {
        kind: 'video' as const,
        mimeType: 'video/H264',
        clockRate: 90000,
        parameters: {
          'packetization-mode': 1,
          'profile-level-id': '42e01f',
          'level-asymmetry-allowed': 1,
          'x-google-start-bitrate': 1000,
        },
      },
    ],
  },
  webRtcTransport: {
    listenIps: [
      {
        ip: process.env.MEDIASOUP_LISTEN_IP || '0.0.0.0',
        // announcedIp is required when behind NAT/Docker so ICE candidates are routable.
        // Falls back to 127.0.0.1 for local development when env var is not set.
        announcedIp: process.env.MEDIASOUP_ANNOUNCED_IP || '127.0.0.1',
      },
    ],
    enableUdp: true,
    enableTcp: true,
    preferUdp: true,
    maxIncomingBitrate: 1500000,
    initialAvailableOutgoingBitrate: 1000000,
  },
  // Mediasoup workers are CPU-bound; 1 worker per core maximizes parallelism
  // without oversubscription. Override via env when needed:
  //   - Shared-CPU VM (e.g. GCP e2-small): set 1 to avoid steal time
  //   - Dev machine: set lower so the IDE/other apps still get CPU
  //   - Container with --cpus=N: set N (os.cpus() reports host cores, not limit)
  numWorkers: resolveNumWorkers(),
};

function resolveNumWorkers(): number {
  const fromEnv = process.env.MEDIASOUP_NUM_WORKERS?.trim();
  if (fromEnv) {
    const parsed = parseInt(fromEnv, 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return Math.max(1, os.cpus().length);
}

/**
 * Resolve announcedIp at startup. Browser clients send UDP to this IP, so it
 * MUST be the VM's public/reachable IP — not 127.0.0.1, not a private range
 * (unless all clients are on the same LAN).
 *
 * Resolution order:
 *   1. MEDIASOUP_ANNOUNCED_IP env (explicit override — preferred for static IPs)
 *   2. HTTP probe (api.ipify.org / checkip.amazonaws.com / icanhazip.com)
 *   3. Fallback: 127.0.0.1 (local dev only — production calls won't work)
 *
 * Call this once at startup BEFORE creating mediasoup workers, so subsequent
 * createWebRtcTransport() picks up the resolved value from mediasoupConfig.
 */
export async function ensureAnnouncedIp(): Promise<{
  announcedIp: string;
  source: 'env' | 'detected' | 'fallback';
}> {
  const fromEnv = process.env.MEDIASOUP_ANNOUNCED_IP?.trim();
  if (fromEnv) {
    mediasoupConfig.webRtcTransport.listenIps[0].announcedIp = fromEnv;
    return { announcedIp: fromEnv, source: 'env' };
  }

  const detected = await detectPublicIp();
  if (detected) {
    mediasoupConfig.webRtcTransport.listenIps[0].announcedIp = detected;
    return { announcedIp: detected, source: 'detected' };
  }

  // Fallback already in config (127.0.0.1)
  return {
    announcedIp: mediasoupConfig.webRtcTransport.listenIps[0].announcedIp,
    source: 'fallback',
  };
}

async function detectPublicIp(): Promise<string | undefined> {
  const services = [
    'https://api.ipify.org',
    'https://checkip.amazonaws.com',
    'https://icanhazip.com',
  ];
  const ipv4Pattern = /^(\d{1,3}\.){3}\d{1,3}$/;

  for (const url of services) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (!res.ok) continue;
      const ip = (await res.text()).trim();
      if (ipv4Pattern.test(ip)) return ip;
    } catch {
      // try next service
    }
  }
  return undefined;
}
