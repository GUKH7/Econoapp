import { IsString, MaxLength, MinLength } from 'class-validator';

export class AdminLoginDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  login!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  password!: string;
}
