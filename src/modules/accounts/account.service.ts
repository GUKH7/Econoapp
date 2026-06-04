import { Inject, Injectable } from '@nestjs/common';
import { NotFoundException } from '@/common/errors/app.exception';
import { CreateCreditCardDto } from './dto/create-credit-card.dto';
import { CreateFinancialAccountDto } from './dto/create-financial-account.dto';
import { UpdateCreditCardDto } from './dto/update-credit-card.dto';
import { UpdateFinancialAccountDto } from './dto/update-financial-account.dto';
import { AccountRepository } from './repositories/account.repository';

@Injectable()
export class AccountService {
  constructor(@Inject(AccountRepository) private readonly accountRepository: AccountRepository) {}

  createAccount(userId: string, input: CreateFinancialAccountDto) {
    return this.accountRepository.createAccount(userId, input);
  }

  findAccountsByUser(userId: string) {
    return this.accountRepository.findAccountsByUser(userId);
  }

  async updateAccount(userId: string, id: string, input: UpdateFinancialAccountDto) {
    const existing = await this.accountRepository.findAccountById(userId, id);
    if (!existing) throw new NotFoundException('Conta nao encontrada');
    await this.accountRepository.updateAccount(userId, id, input);
    return this.accountRepository.findAccountById(userId, id);
  }

  async deleteAccount(userId: string, id: string): Promise<void> {
    const existing = await this.accountRepository.findAccountById(userId, id);
    if (!existing) throw new NotFoundException('Conta nao encontrada');
    await this.accountRepository.deleteAccount(userId, id);
  }

  createCard(userId: string, input: CreateCreditCardDto) {
    return this.accountRepository.createCard(userId, input);
  }

  findCardsByUser(userId: string) {
    return this.accountRepository.findCardsByUser(userId);
  }

  async updateCard(userId: string, id: string, input: UpdateCreditCardDto) {
    const existing = await this.accountRepository.findCardById(userId, id);
    if (!existing) throw new NotFoundException('Cartao nao encontrado');
    await this.accountRepository.updateCard(userId, id, input);
    return this.accountRepository.findCardById(userId, id);
  }

  async deleteCard(userId: string, id: string): Promise<void> {
    const existing = await this.accountRepository.findCardById(userId, id);
    if (!existing) throw new NotFoundException('Cartao nao encontrado');
    await this.accountRepository.deleteCard(userId, id);
  }

  async ensureAccountBelongsToUser(userId: string, id: string): Promise<void> {
    const existing = await this.accountRepository.findAccountById(userId, id);
    if (!existing) throw new NotFoundException('Conta nao encontrada');
  }

  async ensureCardBelongsToUser(userId: string, id: string): Promise<void> {
    const existing = await this.accountRepository.findCardById(userId, id);
    if (!existing) throw new NotFoundException('Cartao nao encontrado');
  }
}
