import { Type } from 'class-transformer';
import {
  IsBoolean, IsInt, IsObject, IsOptional, IsString, IsUrl, Matches, MaxLength, Min, ValidateNested,
} from 'class-validator';

export class DeviceInfoDto {
  @IsOptional() @IsString() @MaxLength(120) deviceName?: string;
  @IsOptional() @IsString() @MaxLength(64) browser?: string;
  @IsOptional() @IsString() @MaxLength(64) os?: string;
  @IsOptional() @IsString() @MaxLength(64) platform?: string;
  @IsOptional() @IsString() @MaxLength(64) timezone?: string;
  @IsOptional() @IsString() @MaxLength(32) language?: string;
  @IsOptional() @IsString() @MaxLength(512) userAgent?: string;
  @IsOptional() @IsString() @MaxLength(64) fingerprintHash?: string;
  @IsOptional() @IsString() @MaxLength(32) screenResolution?: string;
  @IsOptional() @IsString() @MaxLength(64) webglHash?: string;
  @IsOptional() @IsString() @MaxLength(64) canvasHash?: string;
  @IsOptional() @IsString() @MaxLength(64) ipAddress?: string;
  @IsOptional() @IsInt() asn?: number;
  @IsOptional() @IsString() @MaxLength(2) country?: string;
  @IsOptional() @IsString() @MaxLength(120) city?: string;
}

export class TelegramLoginBodyDto {
  @IsString() @Matches(/^\d+$/) id!: string;
  @IsString() @MaxLength(120) first_name!: string;
  @IsOptional() @IsString() @MaxLength(120) last_name?: string;
  @IsOptional() @IsString() @MaxLength(64) username?: string;
  @IsOptional() @IsUrl() photo_url?: string;
  @IsInt() @Min(1) auth_date!: number;
  @IsString() @Matches(/^[a-f0-9]{64}$/i) hash!: string;
}

export class LoginDto {
  @ValidateNested()
  @Type(() => TelegramLoginBodyDto)
  @IsObject()
  telegram!: TelegramLoginBodyDto;

  @IsOptional() @IsBoolean() rememberMe?: boolean;

  @IsOptional()
  @ValidateNested()
  @Type(() => DeviceInfoDto)
  device?: DeviceInfoDto;
}

export class RefreshDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => DeviceInfoDto)
  device?: DeviceInfoDto;
}
