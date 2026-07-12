import { IsIn, IsOptional, IsString, MinLength } from 'class-validator';

export class DeleteAccountDto {
  @IsString()
  @IsIn(['EXCLUIR'])
  confirmation!: 'EXCLUIR';

  @IsOptional()
  @IsString()
  @MinLength(8)
  password?: string;
}
