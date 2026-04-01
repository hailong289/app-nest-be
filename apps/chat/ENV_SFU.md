# Environment Variables for SFU Configuration

Add the following environment variables to your Chat service `.env` file:

```bash
# apps/chat/.env.development

# mediasoup Configuration
MEDIASOUP_LISTEN_IP=0.0.0.0
MEDIASOUP_ANNOUNCED_IP=127.0.0.1  # Change to your public IP in production
MEDIASOUP_RTC_MIN_PORT=40000
MEDIASOUP_RTC_MAX_PORT=49999
MEDIASOUP_NUM_WORKERS=4  # Number of mediasoup workers (default: CPU cores)
MEDIASOUP_LOG_LEVEL=warn  # Options: debug, warn, error
```

## Production Deployment

For production, update `MEDIASOUP_ANNOUNCED_IP` to your server's public IP address:

```bash
MEDIASOUP_ANNOUNCED_IP=your.server.public.ip
```

## Firewall Configuration

Ensure the following ports are open:

- **UDP**: 40000-49999 (RTP/RTCP media)
- **TCP**: 40000-49999 (WebRTC transport fallback)

## Docker Deployment

If using Docker, expose the RTC port range in your `docker-compose.yml`:

```yaml
services:
  chat:
    ports:
      - '40000-49999:40000-49999/udp'
      - '40000-49999:40000-49999/tcp'
    environment:
      - MEDIASOUP_ANNOUNCED_IP=${PUBLIC_IP}
```
