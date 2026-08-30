import { Body, Controller, Get, Header, Post } from '@nestjs/common';
import { IsOptional, IsString, Length, MaxLength } from 'class-validator';
import { AuthUser, CurrentUser } from '../common';
import { assertRateLimit } from '../rate-limit';
import { AiConversationService } from './conversation.service';
import { FAQ_ITEMS } from './help-replies';

class AiMessageDto {
  @IsOptional() @IsString() @MaxLength(2000) text?: string;
  @IsOptional() @IsString() @Length(1, 40) faqId?: string;
}

@Controller('ai')
export class AiController {
  constructor(private readonly conversations: AiConversationService) {}

  @Get('chat')
  @Header('Cache-Control', 'private, no-store')
  ensure(@CurrentUser() user: AuthUser) {
    return this.conversations.ensureChat(user);
  }

  @Get('faqs')
  @Header('Cache-Control', 'public, max-age=120')
  faqs() {
    return FAQ_ITEMS;
  }

  @Post('messages')
  send(@CurrentUser() user: AuthUser, @Body() dto: AiMessageDto) {
    assertRateLimit(`ai-msg:${user.id}`, 30, 60_000);
    return this.conversations.reply(user, dto.text ?? '', dto.faqId);
  }
}
