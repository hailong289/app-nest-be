import {
  Controller,
  Get,
  HttpStatus,
  Logger,
  Query,
  HttpException,
} from '@nestjs/common';
import { GatewayService } from './gateway.service';
import * as cheerio from 'cheerio';
import axios, { AxiosError } from 'axios';
import { promises as dns } from 'node:dns';
import { isPrivateOrLocalIp } from 'libs/helpers/src';
export interface LinkPreviewMetadata {
  url: string;
  title?: string;
  description?: string;
  image?: string;
  siteName?: string;
  favicon: string;
}

export interface ApiResponse<T> {
  status: 'success' | 'error';
  data?: T;
  message?: string;
}
// Helper functions
const getMeta = (
  $: cheerio.CheerioAPI,
  selectors: string[],
): string | undefined => {
  for (const selector of selectors) {
    const content = $(selector).attr('content') || $(selector).text();
    if (content && content.trim().length > 0) return content.trim();
  }
  return undefined;
};

const resolveUrl = (
  path: string | undefined,
  origin: string,
): string | undefined => {
  if (!path) return undefined;
  try {
    return new URL(path, origin).toString();
  } catch {
    return undefined;
  }
};

@Controller('gateway')
export class GatewayController {
  private readonly logger = new Logger(GatewayController.name);

  constructor(private readonly gatewayService: GatewayService) {}

  @Get()
  getHealth() {
    return this.gatewayService.getHealth();
  }

  @Get('preview-link')
  async previewLink(
    @Query('url') url: string,
  ): Promise<ApiResponse<LinkPreviewMetadata>> {
    if (!url) {
      throw new HttpException(
        'URL là bắt buộc nha fen',
        HttpStatus.BAD_REQUEST,
      );
    }

    try {
      const validUrl = new URL(url);
      // SSRF guard: block localhost / private-IP previews by default
      // because letting any chat user trigger requests against the
      // gateway's own network is a real risk (metadata service, sibling
      // services, etc.).
      //
      // Auto-allow in non-production so dev users can paste local
      // links (http://localhost:3000/todo/...) without ops gymnastics.
      // Production must opt-in via the env var.
      const allowLocalPreview =
        process.env.LINK_PREVIEW_ALLOW_LOCALHOST === 'true' ||
        (process.env.NODE_ENV ?? 'development') !== 'production';
      const blockedHosts = (
        process.env.LINK_PREVIEW_BLOCKED_HOSTS || 'localhost,127.0.0.1,::1'
      )
        .split(',')
        .map((h) => h.trim())
        .filter(Boolean);

      if (!allowLocalPreview) {
        // Layer 1: literal hostname blocklist (fast path, no DNS roundtrip
        // for the obvious cases).
        if (blockedHosts.includes(validUrl.hostname)) {
          throw new HttpException('Restricted IP', HttpStatus.FORBIDDEN);
        }
        // Layer 2: DNS-resolve and reject if ANY A/AAAA record points
        // into a private / loopback / link-local range. Catches:
        //   - 0.0.0.0 / [::] forms not in the literal list
        //   - DNS aliases like localtest.me → 127.0.0.1
        //   - internal service names that resolve only inside the VPC
        // Defense-in-depth — does NOT close the TOCTOU gap (axios
        // re-resolves later) but raises the bar for casual SSRF.
        try {
          const records = await dns.lookup(validUrl.hostname, { all: true });
          if (records.some((r) => isPrivateOrLocalIp(r.address))) {
            throw new HttpException('Restricted IP', HttpStatus.FORBIDDEN);
          }
        } catch (err) {
          if (err instanceof HttpException) throw err;
          // DNS lookup itself failed — let axios produce the real error
          // downstream rather than masking it as a 403.
        }
      }

      // 2. Generic Type cho Axios: báo trước data trả về là string (HTML)
      const response = await axios.get<string>(validUrl.toString(), {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        timeout: 5000,
        maxContentLength: 1024 * 1024 * 2, // 2MB limit
      });

      const contentType = response.headers['content-type'] as string;
      // Check null/undefined an toàn
      if (!contentType?.includes('text/html')) {
        throw new HttpException(
          'Target is not an HTML page',
          HttpStatus.BAD_REQUEST,
        );
      }

      const html = response.data;
      const $ = cheerio.load(html);
      const origin = validUrl.origin;

      const metadata: LinkPreviewMetadata = {
        url: validUrl.toString(),
        title: getMeta($, [
          'meta[property="og:title"]',
          'meta[name="twitter:title"]',
          'title',
        ]),
        description: getMeta($, [
          'meta[property="og:description"]',
          'meta[name="twitter:description"]',
          'meta[name="description"]',
        ]),
        image: resolveUrl(
          $('meta[property="og:image"]').attr('content') ||
            $('meta[name="twitter:image"]').attr('content') ||
            $('link[rel="image_src"]').attr('href'),
          origin,
        ),
        siteName:
          getMeta($, [
            'meta[property="og:site_name"]',
            'meta[name="application-name"]',
          ]) || validUrl.hostname,
        favicon:
          resolveUrl(
            $('link[rel="icon"]').attr('href') ||
              $('link[rel="shortcut icon"]').attr('href'),
            origin,
          ) || `${origin}/favicon.ico`,
      };

      return {
        status: 'success',
        data: metadata,
      };
    } catch (error: unknown) {
      this.handlePreviewError(error);
    }
  }

  private handlePreviewError(error: unknown): never {
    // HttpException = expected response to bad client input (Restricted
    // IP / not-html / 404 from upstream). NOT a server bug — log at
    // debug level only, no stack dump. Avoids polluting the gateway log
    // every time someone shares a localhost link.
    if (error instanceof HttpException) {
      this.logger.debug(`Link preview rejected: ${error.message}`);
      throw error;
    }

    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError;
      if (axiosError.code === 'ECONNABORTED') {
        throw new HttpException('Request timeout', HttpStatus.REQUEST_TIMEOUT);
      }
      if (axiosError.response?.status === 404) {
        throw new HttpException('Page not found', HttpStatus.NOT_FOUND);
      }
    }

    if (error instanceof TypeError && error.message.includes('Invalid URL')) {
      throw new HttpException('URL không hợp lệ', HttpStatus.BAD_REQUEST);
    }

    // Genuine server-side surprise — keep error-level log + stack.
    this.logger.error('Link preview unexpected error', error as Error);
    throw new HttpException(
      'Internal Server Error',
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }
}
