# =============================================================================
# Stage 1: deps — install Node packages.
# Mediasoup ships a C++ worker that gets compiled via node-gyp during install,
# which requires Python 3 + a C/C++ toolchain. This stage carries those tools;
# the runner stage doesn't, keeping the final image slim.
# =============================================================================
FROM node:24-alpine AS deps

WORKDIR /app

# linux-headers needed by some native modules under Alpine.
RUN apk add --no-cache python3 py3-pip make g++ gcc linux-headers \
  && ln -sf python3 /usr/bin/python

COPY package*.json ./
RUN npm install

# =============================================================================
# Stage 2: builder — compile TypeScript -> dist/.
# Reuses node_modules from `deps` (incl. the pre-built mediasoup-worker binary).
# =============================================================================
FROM node:24-alpine AS builder

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY package*.json ./
COPY tsconfig*.json nest-cli.json ./
COPY apps ./apps
COPY libs ./libs

RUN npm run build:sfu \
  && npm prune --omit=dev

# =============================================================================
# Stage 3: runner — slim runtime image.
# No Python, no compilers. Just Node + compiled artifacts + mediasoup binary
# (which lives inside node_modules/mediasoup/worker/out/Release/).
# =============================================================================
FROM node:24-alpine AS runner

WORKDIR /app

# libstdc++ / libgcc are required by the compiled mediasoup-worker.
RUN apk add --no-cache libstdc++ libgcc

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
# Proto files are loaded at runtime by gRPC server (path: libs/grpc/sfu.proto).
COPY libs ./libs

ENV NODE_ENV=production

# gRPC port (apps/sfu listens here for control plane from apps/socket).
EXPOSE 5008
# Mediasoup RTC port range (UDP). Browsers send media here directly.
# Note: Docker doesn't auto-open this many UDP ports efficiently — use
# `--network host` on the VM (see docker-compose.dev.yml) for production.
EXPOSE 40000-49999/udp

CMD ["node", "dist/apps/sfu/main.js"]
