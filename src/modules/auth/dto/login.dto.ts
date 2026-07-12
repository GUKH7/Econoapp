import { IsEmail, IsOptional, IsString, MinLength, ValidateIf } from 'class-validator';
import { Transform } from 'class-transformer';

export class LoginDto {
  @ValidateIf((o: LoginDto) => !o.phone)
  @Transform(({ value }) => value ? String(value).trim().toLowerCase() : value)
  @IsEmail()
  @IsOptional()
  email?: string;

  @ValidateIf((o: LoginDto) => !o.email)
  @IsString()
  @IsOptional()
  phone?: string;

  @IsString()
  @MinLength(8)
  password!: string;
}
