/**
 * Deploy identity for health / diagnostics.
 * Render injects RENDER_GIT_COMMIT; local/dev may use GIT_COMMIT.
 */
export function buildInfo(): {
  service: string;
  version: string;
  commit: string | null;
  commitShort: string | null;
  region: string | null;
  nodeEnv: string;
} {
  const commit = (
    process.env.RENDER_GIT_COMMIT
    ?? process.env.GIT_COMMIT
    ?? process.env.COMMIT_SHA
    ?? ''
  ).trim() || null;
  return {
    service: process.env.OTEL_SERVICE_NAME ?? 'onix-api',
    version: process.env.npm_package_version ?? '1.0.0',
    commit,
    commitShort: commit ? commit.slice(0, 7) : null,
    region: process.env.RENDER_REGION
      ?? process.env.AWS_REGION
      ?? process.env.FLY_REGION
      ?? null,
    nodeEnv: process.env.NODE_ENV ?? 'development',
  };
}
