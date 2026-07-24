import {
  Controller, Get, Header, Param, Req, Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../common';
import { assertRateLimit } from '../rate-limit';
import { AvatarService } from './avatar.service';

@Controller('avatars')
export class AvatarController {
  constructor(private readonly avatars: AvatarService) {}

  /**
   * Public avatar bytes for marketplace / chats.
   * RU clients load from onixtg.shop; server pulls Telegram CDN once and caches.
   */
  @Public()
  @Get(':userId')
  @Header('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800')
  async get(
    @Param('userId') userIdRaw: string,
    @Req() req: { ip?: string; headers?: { 'if-none-match'?: string } },
    @Res() res: Response,
  ): Promise<void> {
    assertRateLimit(`avatar:${req.ip ?? 'unknown'}`, 120, 60_000);

    if (!/^\d+$/.test(userIdRaw)) {
      res.status(404).end();
      return;
    }

    const userId = BigInt(userIdRaw);
    try {
      const { stream, contentType, etag } = await this.avatars.openAvatar(userId);
      if (req.headers?.['if-none-match'] === etag) {
        res.status(304).end();
        return;
      }
      res.setHeader('Content-Type', contentType);
      res.setHeader('ETag', etag);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      stream.pipe(res);
    } catch {
      res.status(404).end();
    }
  }
}
