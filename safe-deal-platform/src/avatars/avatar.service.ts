import { createHash } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import {
  assertSafeAvatarUrl,
  AVATAR_ALLOWED_TYPES,
  AVATAR_MAX_BYTES,
} from './avatar-url';

const FETCH_TIMEOUT_MS = 10_000;
const NEGATIVE_TTL_MS = 60_000;
const MAX_REDIRECTS = 5;

type CacheMeta = {
  sourceUrl: string;
  contentType: string;
  etag: string;
};

@Injectable()
export class AvatarService {
  private readonly logger = new Logger(AvatarService.name);
  private readonly inflight = new Map<string, Promise<CacheMeta | null>>();
  private readonly negativeUntil = new Map<string, number>();

  constructor(private readonly prisma: PrismaService) {}

  resolveCacheDir(): string {
    const fromEnv = process.env.AVATAR_CACHE_DIR?.trim();
    if (fromEnv) return fromEnv;
    return join(process.cwd(), 'data', 'avatars');
  }

  /**
   * Ensure cached file for user; returns absolute path + content-type.
   * Lazy: first marketplace view triggers Telegram fetch from the API host (not RU clients).
   */
  async openAvatar(userId: bigint): Promise<{ stream: NodeJS.ReadableStream; contentType: string; etag: string }> {
    const key = userId.toString();
    const neg = this.negativeUntil.get(key);
    if (neg && neg > Date.now()) {
      throw new NotFoundException('Avatar not found.');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, avatarUrl: true, telegramId: true, deletedAt: true },
    });
    if (!user || user.deletedAt) {
      this.negativeUntil.set(key, Date.now() + NEGATIVE_TTL_MS);
      throw new NotFoundException('Avatar not found.');
    }

    let sourceUrl = user.avatarUrl?.trim() ?? '';
    if (!sourceUrl && user.telegramId != null) {
      // Opaque marker — never persist bot file URLs (they embed BOT_TOKEN).
      sourceUrl = botProfileMarker(user.telegramId);
      await this.prisma.user.update({
        where: { id: userId },
        data: { avatarUrl: sourceUrl },
      }).catch(() => undefined);
    }
    if (!sourceUrl) {
      this.negativeUntil.set(key, Date.now() + NEGATIVE_TTL_MS);
      throw new NotFoundException('Avatar not found.');
    }

    const meta = await this.ensureCached(userId, sourceUrl);
    if (!meta) {
      this.negativeUntil.set(key, Date.now() + NEGATIVE_TTL_MS);
      throw new NotFoundException('Avatar not found.');
    }

    const filePath = this.binPath(userId);
    if (!existsSync(filePath)) {
      this.negativeUntil.set(key, Date.now() + NEGATIVE_TTL_MS);
      throw new NotFoundException('Avatar not found.');
    }

    return {
      stream: createReadStream(filePath),
      contentType: meta.contentType,
      etag: meta.etag,
    };
  }

  /** Warm cache after Telegram login (best-effort, non-blocking). */
  warmFromSource(userId: bigint, sourceUrl: string | null | undefined): void {
    if (!sourceUrl?.trim()) return;
    void this.ensureCached(userId, sourceUrl.trim()).catch((error) => {
      this.logger.warn(`avatar warm failed user=${userId}: ${error instanceof Error ? error.message : error}`);
    });
  }

  private binPath(userId: bigint): string {
    return join(this.resolveCacheDir(), `${userId.toString()}.bin`);
  }

  private metaPath(userId: bigint): string {
    return join(this.resolveCacheDir(), `${userId.toString()}.json`);
  }

  private async ensureCached(userId: bigint, sourceUrl: string): Promise<CacheMeta | null> {
    const key = userId.toString();
    const existing = this.inflight.get(key);
    if (existing) return existing;

    const run = this.ensureCachedInner(userId, sourceUrl).finally(() => {
      if (this.inflight.get(key) === run) this.inflight.delete(key);
    });
    this.inflight.set(key, run);
    return run;
  }

  private async ensureCachedInner(userId: bigint, sourceUrl: string): Promise<CacheMeta | null> {
    await mkdir(this.resolveCacheDir(), { recursive: true });
    const metaFile = this.metaPath(userId);
    const binFile = this.binPath(userId);

    if (existsSync(metaFile) && existsSync(binFile)) {
      try {
        const meta = JSON.parse(await readFile(metaFile, 'utf8')) as CacheMeta;
        if (
          meta.sourceUrl === sourceUrl
          && meta.contentType
          && meta.etag
          && AVATAR_ALLOWED_TYPES.has(meta.contentType)
        ) {
          return meta;
        }
      } catch {
        /* corrupt meta — re-fetch */
      }
    }

    const fetched = sourceUrl.startsWith('tg:profile:')
      ? await this.fetchViaBotProfileMarker(sourceUrl)
      : await this.fetchTelegramAvatar(sourceUrl);
    if (!fetched) return null;

    const etag = `"${createHash('sha256').update(fetched.buffer).digest('hex').slice(0, 32)}"`;
    const meta: CacheMeta = {
      sourceUrl,
      contentType: fetched.contentType,
      etag,
    };

    const tmp = `${binFile}.${process.pid}.tmp`;
    await writeFile(tmp, fetched.buffer);
    await rename(tmp, binFile);
    await writeFile(metaFile, JSON.stringify(meta), 'utf8');
    this.negativeUntil.delete(userId.toString());
    return meta;
  }

  private async fetchViaBotProfileMarker(
    marker: string,
  ): Promise<{ buffer: Buffer; contentType: string } | null> {
    const idRaw = marker.slice('tg:profile:'.length);
    if (!/^\d+$/.test(idRaw)) return null;
    const fileUrl = await this.resolvePhotoFileUrlViaBotApi(BigInt(idRaw));
    if (!fileUrl) return null;
    return this.fetchTelegramAvatar(fileUrl);
  }

  /**
   * Bot login often omits photo_url — pull profile photo via Bot API when BOT_TOKEN is set.
   * File URL is used only in-memory (never stored in DB / API responses).
   */
  private async resolvePhotoFileUrlViaBotApi(telegramId: bigint): Promise<string | null> {
    const token = process.env.BOT_TOKEN?.trim();
    if (!token) return null;

    try {
      const photosRes = await fetch(`https://api.telegram.org/bot${token}/getUserProfilePhotos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: Number(telegramId), limit: 1 }),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      const photosJson = await photosRes.json() as {
        ok?: boolean;
        result?: { photos?: Array<Array<{ file_id: string; file_size?: number }>> };
      };
      const sizes = photosJson.result?.photos?.[0];
      if (!photosJson.ok || !sizes?.length) return null;
      const best = sizes[sizes.length - 1]!;

      const fileRes = await fetch(`https://api.telegram.org/bot${token}/getFile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file_id: best.file_id }),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      const fileJson = await fileRes.json() as {
        ok?: boolean;
        result?: { file_path?: string };
      };
      const filePath = fileJson.result?.file_path;
      if (!fileJson.ok || !filePath) return null;
      return `https://api.telegram.org/file/bot${token}/${filePath}`;
    } catch (error) {
      this.logger.warn(`bot avatar resolve failed: ${error instanceof Error ? error.message : error}`);
      return null;
    }
  }

  /**
   * SSRF-safe fetch: each hop (including redirects) must stay on Telegram allowlist.
   * Never follows open redirects to arbitrary hosts.
   */
  private async fetchTelegramAvatar(
    sourceUrl: string,
  ): Promise<{ buffer: Buffer; contentType: string } | null> {
    let current = sourceUrl;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      const parsed = assertSafeAvatarUrl(current);
      if (!parsed) {
        this.logger.warn(`avatar fetch blocked url=${safeUrlForLog(current)}`);
        return null;
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      try {
        const response = await fetch(parsed.toString(), {
          method: 'GET',
          redirect: 'manual',
          signal: controller.signal,
          headers: {
            Accept: 'image/jpeg,image/png,image/webp,image/gif',
            'User-Agent': 'ONIX-AvatarCache/1.0',
          },
        });

        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get('location');
          if (!location) return null;
          try {
            current = new URL(location, parsed).toString();
          } catch {
            return null;
          }
          continue;
        }

        if (!response.ok) return null;

        const buffer = Buffer.from(await response.arrayBuffer());
        if (buffer.length === 0 || buffer.length > AVATAR_MAX_BYTES) return null;

        let contentType = (response.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
        if (!AVATAR_ALLOWED_TYPES.has(contentType)) {
          contentType = sniffRasterContentType(buffer) ?? '';
        }
        // SVG banned — XSS if served as document; Telegram profile photos are raster after CDN.
        if (!AVATAR_ALLOWED_TYPES.has(contentType)) return null;
        return { buffer, contentType };
      } catch (error) {
        this.logger.warn(`avatar fetch failed: ${error instanceof Error ? error.message : error}`);
        return null;
      } finally {
        clearTimeout(timer);
      }
    }
    this.logger.warn('avatar fetch exceeded redirect limit');
    return null;
  }

  /** Test helper */
  async clearCache(userId: bigint): Promise<void> {
    for (const path of [this.binPath(userId), this.metaPath(userId)]) {
      if (existsSync(path)) await unlink(path).catch(() => undefined);
    }
    this.negativeUntil.delete(userId.toString());
  }
}

function botProfileMarker(telegramId: bigint): string {
  return `tg:profile:${telegramId.toString()}`;
}

function safeUrlForLog(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}${u.pathname}`;
  } catch {
    return '[invalid-url]';
  }
}

/** Raster only — never SVG/XML. */
function sniffRasterContentType(buffer: Buffer): string | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    buffer.length >= 8
    && buffer[0] === 0x89
    && buffer[1] === 0x50
    && buffer[2] === 0x4e
    && buffer[3] === 0x47
  ) {
    return 'image/png';
  }
  if (
    buffer.length >= 12
    && buffer.toString('ascii', 0, 4) === 'RIFF'
    && buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }
  if (buffer.length >= 6) {
    const head = buffer.toString('ascii', 0, 6);
    if (head === 'GIF87a' || head === 'GIF89a') return 'image/gif';
  }
  return null;
}
