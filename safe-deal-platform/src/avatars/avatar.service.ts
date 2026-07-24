import { createHash } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { isAllowedTelegramAvatarHost } from './avatar-url';

const MAX_BYTES = 2 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 10_000;
const NEGATIVE_TTL_MS = 60_000;

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
        if (meta.sourceUrl === sourceUrl && meta.contentType && meta.etag) {
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

  private async fetchTelegramAvatar(
    sourceUrl: string,
  ): Promise<{ buffer: Buffer; contentType: string } | null> {
    let parsed: URL;
    try {
      parsed = new URL(sourceUrl);
    } catch {
      return null;
    }
    if (parsed.protocol !== 'https:') return null;
    if (!isAllowedTelegramAvatarHost(parsed.hostname)) {
      this.logger.warn(`avatar fetch blocked host=${parsed.hostname}`);
      return null;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(parsed.toString(), {
        method: 'GET',
        redirect: 'follow',
        signal: controller.signal,
        headers: {
          Accept: 'image/*,*/*;q=0.8',
          'User-Agent': 'ONIX-AvatarCache/1.0',
        },
      });
      if (!response.ok) return null;

      const contentType = (response.headers.get('content-type') ?? 'image/jpeg').split(';')[0]!.trim();
      if (!contentType.startsWith('image/')) return null;

      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length === 0 || buffer.length > MAX_BYTES) return null;
      return { buffer, contentType };
    } catch (error) {
      this.logger.warn(`avatar fetch failed: ${error instanceof Error ? error.message : error}`);
      return null;
    } finally {
      clearTimeout(timer);
    }
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
