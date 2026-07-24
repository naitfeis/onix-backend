import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Length, Max, MaxLength, Min } from 'class-validator';
import { AuthUser, CurrentUser } from '../common';
import { assertRateLimit } from '../rate-limit';
import { ChatAttachmentsService } from './chat-attachments.service';

class UploadIntentDto {
  @IsString() @Length(3, 100) mimeType!: string;
  @Type(() => Number) @IsInt() @Min(1) @Max(100 * 1024 * 1024) sizeBytes!: number;
  @IsString() @Length(1, 255) originalName!: string;
}

class CompleteAttachmentDto {
  @IsOptional() @IsString() @MaxLength(2000) caption?: string;
}

@Controller()
export class ChatAttachmentsController {
  constructor(private readonly attachments: ChatAttachmentsService) {}

  @Post('chats/:chatId/attachments/upload-intent')
  uploadIntent(
    @CurrentUser() user: AuthUser,
    @Param('chatId') chatId: string,
    @Body() dto: UploadIntentDto,
  ) {
    assertRateLimit(`attach-http:${user.id}`, 60, 60_000);
    return this.attachments.uploadIntent(user, chatId, dto);
  }

  @Post('chats/:chatId/attachments/:id/complete')
  complete(
    @CurrentUser() user: AuthUser,
    @Param('chatId') chatId: string,
    @Param('id') id: string,
    @Body() dto: CompleteAttachmentDto,
  ) {
    return this.attachments.complete(user, chatId, id, dto.caption);
  }

  @Get('chats/attachments/:id/download')
  download(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    return this.attachments.downloadUrl(user, id);
  }
}
