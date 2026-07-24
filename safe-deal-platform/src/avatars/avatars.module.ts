import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database.module';
import { AvatarController } from './avatar.controller';
import { AvatarService } from './avatar.service';

@Module({
  imports: [DatabaseModule],
  controllers: [AvatarController],
  providers: [AvatarService],
  exports: [AvatarService],
})
export class AvatarsModule {}
