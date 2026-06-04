import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@/common/guards/auth.guard';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { JwtPayload } from '@/common/types';
import { AccountService } from './account.service';
import { CreateCreditCardDto } from './dto/create-credit-card.dto';
import { CreateFinancialAccountDto } from './dto/create-financial-account.dto';
import { UpdateCreditCardDto } from './dto/update-credit-card.dto';
import { UpdateFinancialAccountDto } from './dto/update-financial-account.dto';

@ApiTags('Accounts')
@ApiBearerAuth('access-token')
@UseGuards(AuthGuard)
@Controller('accounts')
export class AccountController {
  constructor(@Inject(AccountService) private readonly accountService: AccountService) {}

  @ApiOperation({ summary: 'Criar banco ou carteira' })
  @Post()
  async createAccount(@CurrentUser() user: JwtPayload, @Body() dto: CreateFinancialAccountDto) {
    const data = await this.accountService.createAccount(user.sub, dto);
    return { data };
  }

  @ApiOperation({ summary: 'Listar bancos e carteiras' })
  @Get()
  async listAccounts(@CurrentUser() user: JwtPayload) {
    const data = await this.accountService.findAccountsByUser(user.sub);
    return { data };
  }

  @ApiOperation({ summary: 'Atualizar banco ou carteira' })
  @Patch(':id')
  async updateAccount(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdateFinancialAccountDto,
  ) {
    const data = await this.accountService.updateAccount(user.sub, id, dto);
    return { data };
  }

  @ApiOperation({ summary: 'Remover banco ou carteira' })
  @Delete(':id')
  async removeAccount(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ): Promise<{ data: { success: boolean } }> {
    await this.accountService.deleteAccount(user.sub, id);
    return { data: { success: true } };
  }

  @ApiOperation({ summary: 'Criar cartao de credito' })
  @Post('cards')
  async createCard(@CurrentUser() user: JwtPayload, @Body() dto: CreateCreditCardDto) {
    const data = await this.accountService.createCard(user.sub, dto);
    return { data };
  }

  @ApiOperation({ summary: 'Listar cartoes de credito' })
  @Get('cards')
  async listCards(@CurrentUser() user: JwtPayload) {
    const data = await this.accountService.findCardsByUser(user.sub);
    return { data };
  }

  @ApiOperation({ summary: 'Atualizar cartao de credito' })
  @Patch('cards/:id')
  async updateCard(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdateCreditCardDto,
  ) {
    const data = await this.accountService.updateCard(user.sub, id, dto);
    return { data };
  }

  @ApiOperation({ summary: 'Remover cartao de credito' })
  @Delete('cards/:id')
  async removeCard(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ): Promise<{ data: { success: boolean } }> {
    await this.accountService.deleteCard(user.sub, id);
    return { data: { success: true } };
  }
}
