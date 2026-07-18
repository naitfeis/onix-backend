-- Root admin role: only SUPER_ADMIN may grant/revoke ADMIN.
ALTER TYPE "PlatformStatus" ADD VALUE IF NOT EXISTS 'SUPER_ADMIN';
