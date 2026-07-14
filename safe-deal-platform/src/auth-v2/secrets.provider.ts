/**
 * SecretsProvider — ENV today, Vault/KMS later (ADR-023).
 * TokenService and SigningKeyService depend only on this interface.
 */

export const SECRETS_PROVIDER = Symbol('SECRETS_PROVIDER');

export interface SecretsProvider {
  get(name: string): string | undefined;
  require(name: string): string;
}

export class EnvSecretsProvider implements SecretsProvider {
  get(name: string): string | undefined {
    const value = process.env[name];
    if (value === undefined || value === '') return undefined;
    return value;
  }

  require(name: string): string {
    const value = this.get(name);
    if (!value) {
      throw new Error(`Missing required secret: ${name}`);
    }
    return value;
  }
}
