import { Module } from '@nestjs/common';
import { SigningKeyService } from './signing-key.service';
import { SECRETS_PROVIDER, EnvSecretsProvider } from './secrets.provider';
import { TokenService } from './token.service';

/**
 * Website auth v2 foundation (Phase 2).
 * Controllers are added in later Phase 2 increments.
 * USE_NEW_AUTH defaults to false — registering this module does not change legacy behaviour.
 */
@Module({
  providers: [
    { provide: SECRETS_PROVIDER, useClass: EnvSecretsProvider },
    SigningKeyService,
    TokenService,
  ],
  exports: [TokenService, SigningKeyService, SECRETS_PROVIDER],
})
export class AuthV2Module {}
