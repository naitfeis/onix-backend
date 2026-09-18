/**
 * Shared SLA config for ban/sell-ban appeal turnaround. A single source so the
 * user-facing lock message, the appeal ticket response, and the paging job
 * (workers/jobs/appeal-sla.job.ts) can never drift out of sync.
 */
export function appealSlaHours(): number {
  const n = Number(process.env.APPEAL_SLA_HOURS ?? '24');
  return Number.isFinite(n) && n > 0 ? n : 24;
}

export function appealSlaMessage(): string {
  return `Обычно рассматриваем апелляции в течение ${appealSlaHours()} ч.`;
}
