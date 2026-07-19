-- Provider payment id unique per provider when linked (PostgreSQL treats NULL as distinct).
CREATE UNIQUE INDEX IF NOT EXISTS "PaymentIntent_provider_providerRef_key"
ON "PaymentIntent"("provider", "providerRef");
