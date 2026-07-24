import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable, ServiceUnavailableException } from '@nestjs/common';

@Injectable()
export class R2StorageService {
  private client: S3Client | null = null;
  private bucket: string | null = null;

  isConfigured(): boolean {
    return Boolean(
      process.env.R2_ACCOUNT_ID
      && process.env.R2_ACCESS_KEY_ID
      && process.env.R2_SECRET_ACCESS_KEY
      && process.env.R2_BUCKET,
    );
  }

  private ensure(): { client: S3Client; bucket: string } {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException('Загрузка файлов временно недоступна (R2 не настроен).');
    }
    if (!this.client || !this.bucket) {
      const accountId = process.env.R2_ACCOUNT_ID!;
      const endpoint = process.env.R2_ENDPOINT
        ?? `https://${accountId}.r2.cloudflarestorage.com`;
      this.bucket = process.env.R2_BUCKET!;
      this.client = new S3Client({
        region: 'auto',
        endpoint,
        credentials: {
          accessKeyId: process.env.R2_ACCESS_KEY_ID!,
          secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
        },
        forcePathStyle: true,
      });
    }
    return { client: this.client, bucket: this.bucket };
  }

  async presignPut(storageKey: string, mimeType: string, expiresIn = 600): Promise<string> {
    const { client, bucket } = this.ensure();
    return getSignedUrl(
      client,
      new PutObjectCommand({
        Bucket: bucket,
        Key: storageKey,
        ContentType: mimeType,
      }),
      { expiresIn },
    );
  }

  async presignGet(
    storageKey: string,
    opts: { mimeType: string; originalName: string; inline: boolean; expiresIn?: number },
  ): Promise<string> {
    const { client, bucket } = this.ensure();
    const disposition = opts.inline
      ? `inline; filename="${escapeContentDisposition(opts.originalName)}"`
      : `attachment; filename="${escapeContentDisposition(opts.originalName)}"`;
    return getSignedUrl(
      client,
      new GetObjectCommand({
        Bucket: bucket,
        Key: storageKey,
        ResponseContentType: opts.mimeType,
        ResponseContentDisposition: disposition,
      }),
      { expiresIn: opts.expiresIn ?? 60 },
    );
  }

  async head(storageKey: string): Promise<{ contentLength: number; contentType?: string }> {
    const { client, bucket } = this.ensure();
    const out = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: storageKey }));
    const contentLength = Number(out.ContentLength ?? 0);
    return { contentLength, contentType: out.ContentType };
  }

  async getRange(storageKey: string, start: number, end: number): Promise<Buffer> {
    const { client, bucket } = this.ensure();
    const out = await client.send(new GetObjectCommand({
      Bucket: bucket,
      Key: storageKey,
      Range: `bytes=${start}-${end}`,
    }));
    const body = out.Body;
    if (!body) return Buffer.alloc(0);
    return Buffer.from(await body.transformToByteArray());
  }

  async delete(storageKey: string): Promise<void> {
    const { client, bucket } = this.ensure();
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: storageKey }));
  }
}

function escapeContentDisposition(name: string): string {
  return name.replace(/["\\\r\n]/g, '_').slice(0, 180);
}
