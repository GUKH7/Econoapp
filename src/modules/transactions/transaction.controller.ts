import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
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
import { CreateRecurringTransactionDto } from './dto/create-recurring-transaction.dto';
import { GenerateRecurringTransactionsDto } from './dto/generate-recurring-transactions.dto';
import { ImportTransactionsDto } from './dto/import-transactions.dto';
import { FilterTransactionDto } from './dto/filter-transaction.dto';
import { UpdateTransactionDto } from './dto/update-transaction.dto';
import { RecurringTransactionService } from './recurring-transaction.service';
import { TransactionService } from './transaction.service';

@ApiTags('Transactions')
@ApiBearerAuth('access-token')
@UseGuards(AuthGuard)
@Controller('transactions')
export class TransactionController {
  constructor(
    @Inject(TransactionService) private readonly transactionService: TransactionService,
    @Inject(RecurringTransactionService) private readonly recurringTransactionService: RecurringTransactionService,
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

  @ApiOperation({ summary: 'Importar transacoes de extrato CSV' })
  @Post('import/csv')
  async importCsv(
    @CurrentUser() user: JwtPayload,
    @Body() dto: ImportTransactionsDto,
  ): Promise<{
    data: { created: number; skipped: number; totalRows: number; transactions: TransactionResponse[] };
  }> {
    const data = await this.transactionService.importCsv(user.sub, dto);
    return { data: data as unknown as { created: number; skipped: number; totalRows: number; transactions: TransactionResponse[] } };
  }

  @ApiOperation({ summary: 'Exportar transacoes para CSV' })
  @Get('export/csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="econoapp-transacoes.csv"')
  async exportCsv(
    @CurrentUser() user: JwtPayload,
    @Query() query: FilterTransactionDto,
  ): Promise<string> {
    return this.transactionService.exportCsv(user.sub, query);
  }

  @ApiOperation({ summary: 'Criar transacao recorrente' })
  @Post('recurring')
  async createRecurring(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateRecurringTransactionDto,
  ): Promise<{ data: unknown }> {
    const data = await this.recurringTransactionService.create(user.sub, dto);
    return { data };
  }

  @ApiOperation({ summary: 'Listar transacoes recorrentes' })
  @Get('recurring')
  async listRecurring(
    @CurrentUser() user: JwtPayload,
    @Query('scope') scope?: 'PERSONAL' | 'BUSINESS',
  ): Promise<{ data: unknown[] }> {
    const data = await this.recurringTransactionService.list(user.sub, scope);
    return { data };
  }

  @ApiOperation({ summary: 'Gerar transacoes recorrentes vencidas' })
  @Post('recurring/generate')
  async generateRecurring(
    @CurrentUser() user: JwtPayload,
    @Body() dto: GenerateRecurringTransactionsDto,
  ): Promise<{ data: { created: number; rulesChecked: number; transactions: TransactionResponse[] } }> {
    const data = await this.recurringTransactionService.generateDue(
      user.sub,
      dto.until ? new Date(dto.until) : new Date(),
    );
    return { data: data as unknown as { created: number; rulesChecked: number; transactions: TransactionResponse[] } };
  }

  @ApiOperation({ summary: 'Desativar transacao recorrente' })
  @Delete('recurring/:id')
  async deactivateRecurring(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ): Promise<{ data: unknown }> {
    const data = await this.recurringTransactionService.deactivate(user.sub, id);
    return { data };
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
