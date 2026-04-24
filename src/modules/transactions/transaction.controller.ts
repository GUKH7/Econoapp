import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@/common/guards/auth.guard';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { JwtPayload } from '@/common/types';
import { TransactionResponse, PaginationMeta } from '@/common/types/response.types';
import { CreateTransactionDto } from './dto/create-transaction.dto';
import { FilterTransactionDto } from './dto/filter-transaction.dto';
import { UpdateTransactionDto } from './dto/update-transaction.dto';
import { TransactionService } from './transaction.service';

@ApiTags('Transactions')
@ApiBearerAuth('access-token')
@UseGuards(AuthGuard)
@Controller('transactions')
export class TransactionController {
  constructor(
    @Inject(TransactionService) private readonly transactionService: TransactionService,
  ) {}

  @ApiOperation({ summary: 'Criar nova transação' })
  @Post()
  async create(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateTransactionDto,
  ): Promise<{ data: TransactionResponse }> {
    const data = await this.transactionService.create(user.sub, dto);
    return { data: data as unknown as TransactionResponse };
  }

  @ApiOperation({ summary: 'Listar transações do usuário autenticado' })
  @Get()
  async list(
    @CurrentUser() user: JwtPayload,
    @Query() query: FilterTransactionDto,
  ): Promise<{ data: TransactionResponse[]; meta: PaginationMeta }> {
    const result = await this.transactionService.findAllByUser(user.sub, query);
    return result as unknown as { data: TransactionResponse[]; meta: PaginationMeta };
  }

  @ApiOperation({ summary: 'Atualizar transação por ID' })
  @Patch(':id')
  async update(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdateTransactionDto,
  ): Promise<{ data: TransactionResponse }> {
    const data = await this.transactionService.update(user.sub, id, dto);
    return { data: data as unknown as TransactionResponse };
  }

  @ApiOperation({ summary: 'Remover transação por ID' })
  @Delete(':id')
  async remove(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ): Promise<{ data: { success: boolean } }> {
    await this.transactionService.delete(user.sub, id);
    return { data: { success: true } };
  }
}
