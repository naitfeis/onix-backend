import { Injectable } from '@nestjs/common';
import { IdempotencyService } from '../../idempotency/idempotency.service';

@Injectable()
export class IdempotencyCleanupJob {
  constructor(private readonly idempotency: IdempotencyService) {}

  async run(batchSize = 500): Promise<number> {
    return this.idempotency.purgeExpired(batchSize);
  }
}
