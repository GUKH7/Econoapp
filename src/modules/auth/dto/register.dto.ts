import { IsEmail, IsOptional, IsString, Matches, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';

export class RegisterDto {
  @IsString()
  @MinLength(2)
  name!: string;

  @Matches(/^\d{10,11}$/, {
    message: 'Telefone deve conter DDD e número, ex: 11999999999',
  })
  phone!: string;

  @IsOptional()
  @Transform(({ value }) => value ? String(value).trim().toLowerCase() : value)
  @IsEmail()
  email?: string;

  @IsString()
  @MinLength(8)
  password!: string;
}
