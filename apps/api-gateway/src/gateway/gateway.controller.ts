import { Controller, Get, Query } from '@nestjs/common';
import { GatewayService } from './gateway.service';
import * as cheerio from 'cheerio';
import axios from 'axios';
import { Response } from '@app/helpers/response';

@Controller('gateway')
export class GatewayController {
  constructor(private readonly gatewayService: GatewayService) {}

  @Get()
  getHealth() {
    return this.gatewayService.getHealth();
  }

  @Get('preview-link')
  async previewLink(@Query('url') url: string) {
    if (!url) {
      return Response.badRequest('URL is required');
    }

    try {
      const validUrl = new URL(url);
      const response = await axios.get(validUrl.toString(), {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; LinkPreviewBot/1.0)',
        },
        timeout: 5000,
      });

      const html = response.data as string;
      const $ = cheerio.load(html);

      const metadata = {
        url: validUrl.toString(),
        title:
          $('meta[property="og:title"]').attr('content') ||
          $('meta[name="twitter:title"]').attr('content') ||
          $('title').text() ||
          undefined,
        description:
          $('meta[property="og:description"]').attr('content') ||
          $('meta[name="twitter:description"]').attr('content') ||
          $('meta[name="description"]').attr('content') ||
          undefined,
        image:
          $('meta[property="og:image"]').attr('content') ||
          $('meta[name="twitter:image"]').attr('content') ||
          undefined,
        siteName:
          $('meta[property="og:site_name"]').attr('content') ||
          validUrl.hostname ||
          undefined,
        favicon:
          $('link[rel="icon"]').attr('href') ||
          $('link[rel="shortcut icon"]').attr('href') ||
          `${validUrl.origin}/favicon.ico`,
      };

      if (metadata.image && !metadata.image.startsWith('http')) {
        metadata.image = new URL(metadata.image, validUrl.origin).toString();
      }
      if (metadata.favicon && !metadata.favicon.startsWith('http')) {
        metadata.favicon = new URL(
          metadata.favicon,
          validUrl.origin,
        ).toString();
      }

      return Response.success(metadata);
    } catch (error) {
      console.error('Link preview error:', error);
      return Response.error('Failed to fetch link preview', 500);
    }
  }
}
