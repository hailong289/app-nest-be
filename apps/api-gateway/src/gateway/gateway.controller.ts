import {
  Controller,
  Get,
  HttpStatus,
  Query,
  HttpException,
} from '@nestjs/common';
import { GatewayService } from './gateway.service';
import * as cheerio from 'cheerio';
import axios, { AxiosError } from 'axios';
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

      // Check localhost (Basic Security)
      if (['localhost', '127.0.0.1', '::1'].includes(validUrl.hostname)) {
        throw new Error('Restricted IP');
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
    console.error('Link preview error:', error);

    // Check nếu là lỗi từ Axios
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError; // Cast về AxiosError để có gợi ý code
      if (axiosError.code === 'ECONNABORTED') {
        throw new HttpException('Request timeout', HttpStatus.REQUEST_TIMEOUT);
      }
      if (axiosError.response?.status === 404) {
        throw new HttpException('Page not found', HttpStatus.NOT_FOUND);
      }
    }

    // Check nếu là lỗi do mình throw (ví dụ URL invalid)
    if (error instanceof HttpException) {
      throw error;
    }

    // Lỗi cú pháp URL (new URL fails)
    if (error instanceof TypeError && error.message.includes('Invalid URL')) {
      throw new HttpException('URL không hợp lệ', HttpStatus.BAD_REQUEST);
    }

    throw new HttpException(
      'Internal Server Error',
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }
}
