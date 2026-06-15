import { IsOptional, IsString, Matches, MinLength } from 'class-validator';

export class GoogleLoginDto {
  @IsString()
  @MinLength(20)
  credential!: string;

  @IsOptional()
  @Matches(/^\d{10,11}$/, {
    message: 'Telefone deve conter DDD e número, ex: 11999999999',
  })
  phone?: string;
}
