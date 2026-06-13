import { BadRequestException, Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { FinancialScope, Prisma, Transaction, TransactionSource, TransactionType } from '@prisma/client';
import { env } from '@/config/env';
import { PrismaService } from '@/config/database';
import { GeminiService, WhatsappConversationMessage } from '@/services/ai/gemini.service';
import { TransactionService } from '@/modules/transactions/transaction.service';
import { SendWhatsappMessageDto } from './dto/send-whatsapp-message.dto';
import { WhatsappWebhookDto } from './dto/whatsapp-webhook.dto';

type WhatsappStatus = 'aguardando_qr' | 'conectado' | 'iniciando' | 'reconectando';
type FinancialPeriod = {
  start: Date;
  end: Date;
  label: string;
};
type WhatsappTransactionDraft = {
  description: string;
  amount: number;
  type: TransactionType;
  scope: FinancialScope;
  categoryHint: string;
  channelHint?: string;
  accountId?: string;
  creditCardId?: string;
  paymentLabel?: string;
  possibleDuplicate?: {
    description: string;
    amount: number;
    date: string;
  };
};
type WhatsappPaymentOption = {
  id: string;
  kind: 'ACCOUNT' | 'CARD';
  name: string;
  label: string;
  accountType?: 'BANK' | 'WALLET';
};
type WhatsappPaymentDraft = {
  transaction: WhatsappTransactionDraft;
  options: WhatsappPaymentOption[];
};
type WhatsappMutationDraft =
  | {
      action: 'UPDATE_AMOUNT';
      transactionId: string;
      description: string;
      previousAmount: number;
      newAmount: number;
      type: TransactionType;
    }
  | {
      action: 'DELETE';
      transactionId: string;
      description: string;
      amount: number;
      type: TransactionType;
    };

const TRANSACTION_CONFIRMATION_PREFIX = '__TRANSACTION_CONFIRMATION__:';
const TRANSACTION_MUTATION_PREFIX = '__TRANSACTION_MUTATION__:';
const PAYMENT_SELECTION_PREFIX = '__PAYMENT_SELECTION__:';

export interface WhatsappStatusResponse {
  status: WhatsappStatus;
  qrcode?: string;
}

@Injectable()
export class WhatsappService {
  private readonly baseUrl = env.WHATSAPP_BOT_API_URL.replace(/\/+$/, '');
  private readonly sendMessagePath = this.normalizePath(env.WHATSAPP_BOT_SEND_MESSAGE_PATH);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(GeminiService) private readonly geminiService: GeminiService,
    @Inject(TransactionService) private readonly transactionService: TransactionService,
  ) {}

  async getStatus(): Promise<WhatsappStatusResponse> {
    const response = await this.request<unknown>('/status');
    return this.normalizeStatusResponse(response);
  }

  async restart(): Promise<WhatsappStatusResponse> {
    const response = await this.request<unknown>('/restart');
    return this.normalizeStatusResponse(response);
  }

  async sendMessage(dto: SendWhatsappMessageDto): Promise<unknown> {
    const phone = String(dto.phone || dto.number || dto.to || '').replace(/\D/g, '');
    const message = String(dto.message || dto.text || '').trim();

    if (!phone) throw new BadRequestException('Informe o telefone com DDI, exemplo: 5511999999999.');
    if (!message) throw new BadRequestException('Informe a mensagem para envio.');
    if (!phone.startsWith('55') || phone.length < 12) {
      throw new BadRequestException('O telefone deve incluir DDI do Brasil, exemplo: 5511999999999.');
    }

    const status = await this.getStatus();
    if (status.status !== 'conectado') {
      throw new ServiceUnavailableException('WhatsApp nao esta pronto.');
    }

    return this.request(this.sendMessagePath, {
      method: 'POST',
      body: JSON.stringify({ phone, message }),
    });
  }

  async handleWebhook(dto: WhatsappWebhookDto): Promise<{ phone: string; reply: string }> {
    const phone = this.extractPhone(dto);
    const message = this.extractMessage(dto);

    if (!phone || !message) {
      throw new BadRequestException('Webhook WhatsApp precisa informar telefone e mensagem.');
    }

    const user = await this.findUserByPhone(phone);
    if (!user) {
      const reply =
        'Nao encontrei seu cadastro no EconoApp. Entre no app e cadastre este telefone para usar o chatbot.';
      await this.safeReply(phone, reply);
      return { phone, reply };
    }

    const conversation = await this.getConversation(user.id, phone);
    const recentMessages = this.parseRecentMessages(conversation.recentMessages);
    const paymentDraft = this.parsePaymentDraft(conversation.pendingText);
    if (paymentDraft) {
      const reply = await this.handlePaymentSelection(user.id, phone, message, paymentDraft);
      await this.appendConversation(user.id, phone, recentMessages, message, reply);
      await this.safeReply(phone, reply);
      return { phone, reply };
    }

    const mutationDraft = this.parseMutationDraft(conversation.pendingText);
    if (mutationDraft) {
      const reply = await this.handleMutationConfirmation(user.id, message, mutationDraft);
      await this.appendConversation(user.id, phone, recentMessages, message, reply);
      await this.safeReply(phone, reply);
      return { phone, reply };
    }

    const transactionDraft = this.parseTransactionDraft(conversation.pendingText);
    if (transactionDraft) {
      const reply = await this.handleTransactionConfirmation(
        user.id,
        message,
        transactionDraft,
      );
      await this.appendConversation(user.id, phone, recentMessages, message, reply);
      await this.safeReply(phone, reply);
      return { phone, reply };
    }

    const textToProcess = conversation.pendingText ? `${conversation.pendingText}. ${message}` : message;
    if (conversation.pendingText) {
      await this.prisma.whatsappConversation.update({
        where: { userId: user.id },
        data: { pendingText: null },
      });
    }

    const reply = await this.processUserMessage(
      user.id,
      user.name,
      phone,
      textToProcess,
      recentMessages,
    );
    await this.appendConversation(user.id, phone, recentMessages, message, reply);
    await this.safeReply(phone, reply);
    return { phone, reply };
  }

  private async processUserMessage(
    userId: string,
    userName: string,
    phone: string,
    message: string,
    recentMessages: WhatsappConversationMessage[],
  ): Promise<string> {
    const mutationReply = await this.tryCreateMutationDraft(userId, phone, message);
    if (mutationReply) {
      return mutationReply;
    }

    if (this.isHelpRequest(message)) {
      return this.helpReply();
    }
    if (this.isKnownFinancialQuestion(message)) {
      return this.answerQuestion(userId, message);
    }

    if (this.isTransactionWithoutAmount(message)) {
      await this.setPendingMessage(userId, phone, message);
      return this.missingAmountQuestion(message);
    }

    if (this.needsMoreDescription(message)) {
      await this.setPendingMessage(userId, phone, message);
      return this.missingDescriptionQuestion(message);
    }

    if (this.looksLikeTransaction(message)) {
      return this.createTransactionFromMessage(userId, phone, message);
    }

    try {
      const classification = await this.geminiService.classifyWhatsappMessage(message, recentMessages);

      if (classification.confidence < 0.6) {
        return 'Não entendi com segurança. Você quer registrar um lançamento ou consultar suas finanças?';
      }
      if (classification.intent === 'TRANSACTION') {
        return this.createTransactionFromMessage(userId, phone, message);
      }
      if (classification.intent === 'HELP') {
        return this.helpReply();
      }
      if (classification.intent === 'FINANCIAL_QUERY' || classification.intent === 'GENERAL_CONVERSATION') {
        const financialContext =
          classification.intent === 'FINANCIAL_QUERY'
            ? await this.buildFinancialContext(userId)
            : 'Nenhuma consulta financeira foi solicitada nesta mensagem.';
        return this.geminiService.generateWhatsappReply({
          message,
          userName,
          financialContext,
          recentMessages,
        });
      }
    } catch {
      if (this.isGreeting(message)) {
        return `Olá, ${userName.split(/\s+/)[0]}. Como posso ajudar com suas finanças hoje?`;
      }
      return 'Não consegui analisar essa pergunta agora. Você ainda pode consultar saldo, gastos, receitas ou registrar um lançamento.';
    }

    return 'Posso registrar receitas e gastos ou responder perguntas sobre suas finanças. O que você quer consultar?';
  }

  private async createTransactionFromMessage(
    userId: string,
    phone: string,
    message: string,
  ): Promise<string> {
    const [channels, categories] = await Promise.all([
      this.prisma.salesChannel.findMany({ where: { userId }, select: { name: true } }),
      this.prisma.category.findMany({ where: { userId }, select: { name: true } }),
    ]);

    const extracted = await this.geminiService.extractFinancialData(message, {
      channelNames: channels.map((item) => item.name),
      categoryNames: categories.map((item) => item.name),
    });

    if (extracted.confidence <= 0 || extracted.amount <= 0) {
      return 'Nao entendi se isso e uma receita, gasto, venda ou pergunta. Pode mandar com valor e descricao?';
    }

    const extractedCategoryHint = String(extracted.categoryHint || '').trim();
    const categoryHint =
      extracted.type === 'INCOME' &&
      (!extractedCategoryHint ||
        this.normalizeText(extractedCategoryHint) === 'nao_especificado')
        ? this.inferIncomeCategory(message) ?? extractedCategoryHint
        : extractedCategoryHint;
    if (!categoryHint || this.normalizeText(categoryHint) === 'nao_especificado') {
      await this.setPendingMessage(userId, phone, message);
      return extracted.type === 'INCOME'
        ? 'De onde veio esse dinheiro? Por exemplo: salário, venda, serviço ou transferência.'
        : 'Com o que foi esse gasto? Por exemplo: mercado, restaurante, transporte ou conta.';
    }

    const explicitScope = this.inferExplicitScope(message);
    const isSale = extracted.type === 'INCOME' && this.isSaleMessage(message);

    if (isSale && !explicitScope) {
      await this.setPendingMessage(userId, phone, message);
      return 'Essa venda foi uma renda pessoal ou pertence ao seu negócio? Responda: Pessoal ou Negócio.';
    }

    if (isSale && explicitScope === FinancialScope.BUSINESS && !extracted.channelHint) {
      await this.setPendingMessage(userId, phone, message);
      return 'Por qual canal você fez essa venda? Por exemplo: Shopee, Instagram, loja física ou venda direta.';
    }

    const scope =
      explicitScope ?? this.inferScope(message, Boolean(extracted.channelHint));
    const description = this.buildTransactionDescription(
      extracted.description,
      categoryHint,
      extracted.type as TransactionType,
      isSale,
    );
    const draft: WhatsappTransactionDraft = {
      description,
      amount: extracted.amount,
      type: extracted.type as TransactionType,
      scope,
      categoryHint,
      ...(scope === FinancialScope.BUSINESS && extracted.channelHint
        ? { channelHint: extracted.channelHint }
        : {}),
    };
    const possibleDuplicate = await this.findPossibleDuplicate(userId, draft);
    if (possibleDuplicate) {
      draft.possibleDuplicate = possibleDuplicate;
    }

    const paymentOptions = await this.findPaymentOptions(userId, scope, draft.type);
    if (paymentOptions.length) {
      await this.setPendingPaymentDraft(userId, phone, {
        transaction: draft,
        options: paymentOptions,
      });
      return this.paymentSelectionQuestion(draft.type, paymentOptions);
    }

    await this.setPendingTransactionDraft(userId, phone, draft);
    return this.transactionDraftConfirmation(draft);
  }

  private async buildFinancialContext(userId: string): Promise<string> {
    const current = this.currentMonthRange();
    const previous = this.previousMonthRange();
    const [
      currentTotals,
      previousTotals,
      personalTotals,
      businessTotals,
      topCategories,
      recentTransactions,
      accounts,
      creditCards,
    ] = await Promise.all([
        this.monthTotals(userId, current.start, current.end),
        this.monthTotals(userId, previous.start, previous.end),
        this.monthTotals(userId, current.start, current.end, FinancialScope.PERSONAL),
        this.monthTotals(userId, current.start, current.end, FinancialScope.BUSINESS),
        this.topExpenseCategories(userId, current.start, current.end),
        this.prisma.transaction.findMany({
          where: { userId },
          orderBy: { date: 'desc' },
          take: 8,
          include: { category: true, channel: true },
        }),
        this.prisma.financialAccount.findMany({
          where: { userId, isActive: true },
          select: { name: true, balance: true, scope: true },
        }),
        this.prisma.creditCard.findMany({
          where: { userId, isActive: true },
          select: { name: true, limit: true, scope: true },
        }),
      ]);

    const expenseChange = this.percentageChange(previousTotals.expense, currentTotals.expense);
    const incomeChange = this.percentageChange(previousTotals.income, currentTotals.income);
    const lines = [
      `Mês atual: receitas ${this.formatMoney(currentTotals.income)}, gastos ${this.formatMoney(currentTotals.expense)}, saldo ${this.formatMoney(currentTotals.balance)}.`,
      `Mês anterior: receitas ${this.formatMoney(previousTotals.income)}, gastos ${this.formatMoney(previousTotals.expense)}, saldo ${this.formatMoney(previousTotals.balance)}.`,
      `Comparação: receitas ${incomeChange}; gastos ${expenseChange}.`,
      `Pessoal no mês atual: receitas ${this.formatMoney(personalTotals.income)}, gastos ${this.formatMoney(personalTotals.expense)}, saldo ${this.formatMoney(personalTotals.balance)}.`,
      `Negócio no mês atual: receitas ${this.formatMoney(businessTotals.income)}, gastos ${this.formatMoney(businessTotals.expense)}, saldo ${this.formatMoney(businessTotals.balance)}.`,
      topCategories.length
        ? `Maiores categorias de gasto: ${topCategories.map((item) => `${item.name} (${this.formatMoney(item.total)})`).join(', ')}.`
        : 'Não há categorias de gasto no mês atual.',
      accounts.length
        ? `Contas e carteiras: ${accounts.map((item) => `${item.name} ${this.formatMoney(Number(item.balance))} [${item.scope}]`).join(', ')}.`
        : 'Não há contas ou carteiras cadastradas.',
      creditCards.length
        ? `Cartões: ${creditCards.map((item) => `${item.name}, limite ${this.formatMoney(Number(item.limit))} [${item.scope}]`).join(', ')}.`
        : 'Não há cartões cadastrados.',
      recentTransactions.length
        ? `Transações recentes: ${recentTransactions
            .map(
              (item) =>
                `${item.type === 'INCOME' ? 'receita' : 'gasto'} ${this.formatMoney(Number(item.amount))} - ${item.description} - ${item.category.name} [${item.scope}]${item.channel ? ` - ${item.channel.name}` : ''}`,
            )
            .join('; ')}.`
        : 'Não há transações recentes.',
    ];
    return lines.join('\n');
  }

  private async answerQuestion(userId: string, message: string): Promise<string> {
    const lower = this.normalizeText(message);
    const scope = lower.includes('negocio') || lower.includes('loja') ? FinancialScope.BUSINESS : undefined;
    const period = this.resolveFinancialPeriod(lower);
    const { start, end } = period;

    if (this.isMonthComparisonQuestion(lower)) {
      return this.answerMonthComparison(userId, scope);
    }

    if (lower.includes('shopee') || lower.includes('instagram') || lower.includes('mercado livre')) {
      const channelName = lower.includes('shopee')
        ? 'Shopee'
        : lower.includes('instagram')
          ? 'Instagram'
          : 'Mercado Livre';
      const result = await this.totalByChannel(userId, channelName, start, end);
      return `${this.periodAt(period.label)}, você vendeu ${this.formatMoney(result)} em ${channelName}.`;
    }

    if (lower.includes('maior despesa')) {
      const largest = await this.prisma.transaction.findFirst({
        where: { userId, type: 'EXPENSE', date: { gte: start, lt: end }, ...(scope ? { scope } : {}) },
        orderBy: { amount: 'desc' },
        include: { category: true },
      });
      if (!largest) return `Você ainda não tem despesas registradas ${this.periodAt(period.label).toLocaleLowerCase('pt-BR')}.`;
      return `Sua maior despesa ${this.periodAt(period.label).toLocaleLowerCase('pt-BR')} foi ${largest.description}: ${this.formatMoney(Number(largest.amount))} em ${largest.category.name}.`;
    }

    if (this.isExpenseListQuestion(lower)) {
      const expenses = await this.prisma.transaction.findMany({
        where: {
          userId,
          type: 'EXPENSE',
          date: { gte: start, lt: end },
          ...(scope ? { scope } : {}),
        },
        orderBy: { date: 'desc' },
        take: 15,
        include: { category: true },
      });

      if (!expenses.length) {
        return `Você ainda não tem gastos registrados ${this.periodAt(period.label).toLocaleLowerCase('pt-BR')}.`;
      }

      const total = expenses.reduce((sum, item) => sum + Number(item.netAmount ?? item.amount), 0);
      const lines = expenses.map(
        (item, index) =>
          `${index + 1}. ${item.description} — ${item.category.name}: ${this.formatMoney(Number(item.netAmount ?? item.amount))}`,
      );
      return [
        `Seus gastos ${this.periodOf(period.label)}:`,
        ...lines,
        '',
        `Total: ${this.formatMoney(total)}`,
        expenses.length === 15 ? 'Mostrando os 15 gastos mais recentes.' : '',
      ]
        .filter(Boolean)
        .join('\n');
    }

    if (lower.includes('lucro') || lower.includes('negocio')) {
      const totals = await this.monthTotals(userId, start, end, FinancialScope.BUSINESS);
      return `Seu negócio está com saldo de ${this.formatMoney(totals.balance)} ${this.periodAt(period.label).toLocaleLowerCase('pt-BR')}.\nReceitas: ${this.formatMoney(totals.income)}\nGastos: ${this.formatMoney(totals.expense)}.`;
    }

    const totals = await this.monthTotals(userId, start, end, scope);
    if (lower.includes('gastei') || lower.includes('gasto') || lower.includes('despesa')) {
      const topCategory = await this.topExpenseCategory(userId, start, end, scope);
      return [
        `${this.periodAt(period.label)}, você gastou ${this.formatMoney(totals.expense)}.`,
        topCategory ? `Maior categoria: ${topCategory.name} - ${this.formatMoney(topCategory.total)}.` : '',
        `Resultado do período: ${this.formatMoney(totals.balance)}.`,
      ]
        .filter(Boolean)
        .join('\n');
    }

    return `Resumo ${this.periodOf(period.label)}:\nReceitas: ${this.formatMoney(totals.income)}\nGastos: ${this.formatMoney(totals.expense)}\nSaldo: ${this.formatMoney(totals.balance)}.`;
  }

  private async answerMonthComparison(
    userId: string,
    scope?: FinancialScope,
  ): Promise<string> {
    const current = this.currentMonthRange();
    const previous = this.previousMonthRange();
    const [currentTotals, previousTotals] = await Promise.all([
      this.monthTotals(userId, current.start, current.end, scope),
      this.monthTotals(userId, previous.start, previous.end, scope),
    ]);
    const currentLabel = this.monthLabel(current.start);
    const previousLabel = this.monthLabel(previous.start);
    return [
      `Comparação: ${currentLabel} x ${previousLabel}`,
      '',
      `Receitas: ${this.formatMoney(currentTotals.income)} (${this.percentageChange(previousTotals.income, currentTotals.income)})`,
      `Gastos: ${this.formatMoney(currentTotals.expense)} (${this.percentageChange(previousTotals.expense, currentTotals.expense)})`,
      `Saldo: ${this.formatMoney(currentTotals.balance)} (antes ${this.formatMoney(previousTotals.balance)})`,
    ].join('\n');
  }

  private async findUserByPhone(phone: string) {
    const normalized = phone.replace(/\D/g, '');
    const withoutBrazilCode = normalized.startsWith('55') ? normalized.slice(2) : normalized;
    const candidates = [...new Set([normalized, withoutBrazilCode, `55${withoutBrazilCode}`])];
    return this.prisma.user.findFirst({
      where: { OR: candidates.map((candidate) => ({ phone: candidate })) },
    });
  }

  private async resolveCategory(userId: string, hint: string, type: string) {
    const normalizedHint = this.normalizeText(hint);
    const existing = await this.prisma.category.findFirst({ where: { userId, name: { equals: hint, mode: 'insensitive' } } });
    if (existing) return existing;

    const fallbackName =
      type === 'EXPENSE' && normalizedHint.includes('mercado') ? 'Alimentacao' : this.titleCase(hint);
    return this.prisma.category.create({
      data: { userId, name: fallbackName, color: type === 'INCOME' ? '#22C55E' : '#EF4444' },
    });
  }

  private async resolveChannel(userId: string, hint?: string | null) {
    if (!hint) return null;
    const existing = await this.prisma.salesChannel.findFirst({
      where: { userId, name: { equals: hint, mode: 'insensitive' } },
    });
    if (existing) return existing;
    return this.prisma.salesChannel.create({ data: { userId, name: this.titleCase(hint), feePercent: 0 } });
  }

  private async monthTotals(userId: string, start: Date, end: Date, scope?: FinancialScope) {
    const [income, expense] = await Promise.all([
      this.prisma.transaction.aggregate({
        where: { userId, type: 'INCOME', date: { gte: start, lt: end }, ...(scope ? { scope } : {}) },
        _sum: { netAmount: true },
      }),
      this.prisma.transaction.aggregate({
        where: { userId, type: 'EXPENSE', date: { gte: start, lt: end }, ...(scope ? { scope } : {}) },
        _sum: { netAmount: true },
      }),
    ]);
    const totalIncome = Number(income._sum.netAmount ?? 0);
    const totalExpense = Number(expense._sum.netAmount ?? 0);
    return { income: totalIncome, expense: totalExpense, balance: totalIncome - totalExpense };
  }

  private async topExpenseCategory(userId: string, start: Date, end: Date, scope?: FinancialScope) {
    const groups = await this.prisma.transaction.groupBy({
      by: ['categoryId'],
      where: { userId, type: 'EXPENSE', date: { gte: start, lt: end }, ...(scope ? { scope } : {}) },
      _sum: { amount: true },
      orderBy: { _sum: { amount: 'desc' } },
      take: 1,
    });
    const top = groups[0];
    if (!top) return null;
    const category = await this.prisma.category.findUnique({ where: { id: top.categoryId } });
    return { name: category?.name ?? 'Sem categoria', total: Number(top._sum.amount ?? 0) };
  }

  private async topExpenseCategories(userId: string, start: Date, end: Date) {
    const groups = await this.prisma.transaction.groupBy({
      by: ['categoryId'],
      where: { userId, type: 'EXPENSE', date: { gte: start, lt: end } },
      _sum: { amount: true },
      orderBy: { _sum: { amount: 'desc' } },
      take: 3,
    });
    if (!groups.length) return [];

    const categories = await this.prisma.category.findMany({
      where: { id: { in: groups.map((item) => item.categoryId) }, userId },
      select: { id: true, name: true },
    });
    const namesById = new Map(categories.map((item) => [item.id, item.name]));
    return groups.map((item) => ({
      name: namesById.get(item.categoryId) ?? 'Sem categoria',
      total: Number(item._sum.amount ?? 0),
    }));
  }

  private async totalByChannel(userId: string, channelName: string, start: Date, end: Date): Promise<number> {
    const channel = await this.prisma.salesChannel.findFirst({
      where: { userId, name: { equals: channelName, mode: 'insensitive' } },
    });
    if (!channel) return 0;
    const result = await this.prisma.transaction.aggregate({
      where: { userId, channelId: channel.id, type: 'INCOME', date: { gte: start, lt: end } },
      _sum: { netAmount: true },
    });
    return Number(result._sum.netAmount ?? 0);
  }

  private transactionConfirmation(
    transaction: Transaction,
    categoryName: string,
    channelName: string | undefined,
    scope: FinancialScope,
    paymentLabel?: string,
  ): string {
    const type = transaction.type === 'EXPENSE' ? 'Despesa' : 'Receita';
    return [
      'Lancamento registrado ✅',
      '',
      `${type}: ${transaction.description}`,
      `Valor: ${this.formatMoney(Number(transaction.amount))}`,
      `Categoria: ${categoryName}`,
      channelName ? `Canal: ${channelName}` : '',
      paymentLabel
        ? `${transaction.type === TransactionType.INCOME ? 'Recebido em' : 'Pagamento'}: ${paymentLabel}`
        : '',
      `Modo: ${scope === 'BUSINESS' ? 'Negocio' : 'Pessoal'}`,
    ]
      .filter(Boolean)
      .join('\n');
  }

  private transactionDraftConfirmation(draft: WhatsappTransactionDraft): string {
    const type = draft.type === TransactionType.EXPENSE ? 'Despesa' : 'Receita';
    return [
      draft.possibleDuplicate ? '⚠️ Possível lançamento duplicado' : '',
      draft.possibleDuplicate
        ? `Já existe: ${draft.possibleDuplicate.description} — ${this.formatMoney(draft.possibleDuplicate.amount)} em ${this.formatDateTime(draft.possibleDuplicate.date)}.`
        : '',
      'Confirme o lançamento:',
      '',
      `Tipo: ${type}`,
      `Título: ${draft.description}`,
      `Valor: ${this.formatMoney(draft.amount)}`,
      `Categoria: ${draft.categoryHint}`,
      draft.channelHint ? `Canal: ${draft.channelHint}` : '',
      draft.paymentLabel
        ? `${draft.type === TransactionType.INCOME ? 'Receber em' : 'Forma de pagamento'}: ${draft.paymentLabel}`
        : 'Conta/forma de pagamento: não informada',
      `Modo: ${draft.scope === FinancialScope.BUSINESS ? 'Negócio' : 'Pessoal'}`,
      '',
      draft.possibleDuplicate
        ? 'Para criar mesmo assim, responda: Salvar novamente. Ou responda: Cancelar.'
        : 'Responda: Confirmar, Editar ou Cancelar.',
    ]
      .filter(Boolean)
      .join('\n');
  }

  private async handleTransactionConfirmation(
    userId: string,
    message: string,
    draft: WhatsappTransactionDraft,
  ): Promise<string> {
    const command = this.normalizeText(message);
    const confirmsDuplicate = /^(salvar novamente|criar novamente)$/.test(command);

    if (/^(cancelar|cancela|nao|não)$/.test(command)) {
      await this.clearPendingMessage(userId);
      return 'Lançamento cancelado. Nenhuma informação foi salva.';
    }

    if (/^(editar|edita|corrigir|corrija)$/.test(command)) {
      await this.clearPendingMessage(userId);
      return 'Certo. Envie novamente o lançamento com as informações corrigidas, incluindo valor e descrição.';
    }

    if (draft.possibleDuplicate && !confirmsDuplicate) {
      return `${this.transactionDraftConfirmation(draft)}\n\nPara evitar duplicidade, preciso que você escreva “Salvar novamente”.`;
    }

    const confirmsTransaction =
      /^(confirmar|confirmo|sim|salvar|pode salvar)$/.test(command) || confirmsDuplicate;
    if (!confirmsTransaction) {
      return `${this.transactionDraftConfirmation(draft)}\n\nNão reconheci sua escolha.`;
    }

    const category = await this.resolveCategory(userId, draft.categoryHint, draft.type);
    const channel =
      draft.scope === FinancialScope.BUSINESS
        ? await this.resolveChannel(userId, draft.channelHint)
        : undefined;
    const transaction = await this.transactionService.create(userId, {
      description: draft.description,
      amount: draft.amount,
      type: draft.type,
      source: TransactionSource.WHATSAPP,
      scope: draft.scope,
      categoryId: category.id,
      ...(channel ? { channelId: channel.id } : {}),
      ...(draft.accountId ? { accountId: draft.accountId } : {}),
      ...(draft.creditCardId ? { creditCardId: draft.creditCardId } : {}),
    });
    await this.clearPendingMessage(userId);
    return this.transactionConfirmation(
      transaction,
      category.name,
      channel?.name,
      draft.scope,
      draft.paymentLabel,
    );
  }

  private async findPossibleDuplicate(
    userId: string,
    draft: WhatsappTransactionDraft,
  ): Promise<WhatsappTransactionDraft['possibleDuplicate'] | null> {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const candidates =
      (await this.prisma.transaction.findMany({
        where: {
          userId,
          type: draft.type,
          scope: draft.scope,
          amount: draft.amount,
          date: { gte: since },
        },
        orderBy: { date: 'desc' },
        take: 10,
        include: { category: true },
      })) ?? [];
    const normalizedDescription = this.normalizeText(draft.description);
    const normalizedCategory = this.normalizeText(draft.categoryHint);
    const duplicate = candidates.find((candidate) => {
      const candidateDescription = this.normalizeText(candidate.description);
      const candidateCategory = this.normalizeText(candidate.category?.name ?? '');
      return (
        candidateDescription === normalizedDescription ||
        (candidateCategory && candidateCategory === normalizedCategory)
      );
    });
    if (!duplicate) return null;
    return {
      description: duplicate.description,
      amount: Number(duplicate.amount),
      date: duplicate.date.toISOString(),
    };
  }

  private formatDateTime(value: string): string {
    return new Intl.DateTimeFormat('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'America/Sao_Paulo',
    }).format(new Date(value));
  }

  private async findPaymentOptions(
    userId: string,
    scope: FinancialScope,
    type: TransactionType,
  ): Promise<WhatsappPaymentOption[]> {
    const [accounts, cards] = await Promise.all([
      this.prisma.financialAccount.findMany({
        where: { userId, scope, isActive: true },
        orderBy: { createdAt: 'desc' },
        select: { id: true, name: true, type: true },
      }),
      type === TransactionType.EXPENSE
        ? this.prisma.creditCard.findMany({
            where: { userId, scope, isActive: true },
            orderBy: { createdAt: 'desc' },
            select: { id: true, name: true },
          })
        : Promise.resolve([]),
    ]);
    const accountOptions = (accounts ?? []).map((account) => ({
      id: account.id,
      kind: 'ACCOUNT' as const,
      name: account.name,
      accountType: account.type,
      label: `${account.type === 'BANK' ? 'Banco/Pix' : 'Carteira'} - ${account.name}`,
    }));
    const cardOptions = (cards ?? []).map((card) => ({
      id: card.id,
      kind: 'CARD' as const,
      name: card.name,
      label: `Cartão - ${card.name}`,
    }));
    return [...accountOptions, ...cardOptions];
  }

  private paymentSelectionQuestion(
    type: TransactionType,
    options: WhatsappPaymentOption[],
  ): string {
    return [
      type === TransactionType.INCOME
        ? 'Em qual conta você recebeu esse dinheiro?'
        : 'Como você pagou esse gasto?',
      '',
      ...options.map((option, index) => `${index + 1}. ${option.label}`),
      '',
      'Responda com o número ou nome da opção.',
    ].join('\n');
  }

  private async handlePaymentSelection(
    userId: string,
    phone: string,
    message: string,
    draft: WhatsappPaymentDraft,
  ): Promise<string> {
    const normalized = this.normalizeText(message);
    const numericIndex = Number.parseInt(normalized, 10);
    let selected =
      Number.isInteger(numericIndex) && String(numericIndex) === normalized
        ? draft.options[numericIndex - 1]
        : draft.options.find((option) => {
            const name = this.normalizeText(option.name);
            const label = this.normalizeText(option.label);
            return name === normalized || label.includes(normalized) || normalized.includes(name);
          });

    if (!selected && normalized === 'pix') {
      const bankAccounts = draft.options.filter(
        (option) => option.kind === 'ACCOUNT' && option.accountType === 'BANK',
      );
      if (bankAccounts.length === 1) {
        selected = bankAccounts[0];
      }
    }
    if (!selected && normalized === 'carteira') {
      const wallets = draft.options.filter(
        (option) => option.kind === 'ACCOUNT' && option.accountType === 'WALLET',
      );
      if (wallets.length === 1) {
        selected = wallets[0];
      }
    }
    if (!selected && /^(cartao|cartao de credito)$/.test(normalized)) {
      const cards = draft.options.filter((option) => option.kind === 'CARD');
      if (cards.length === 1) {
        selected = cards[0];
      }
    }

    if (!selected) {
      return `${this.paymentSelectionQuestion(draft.transaction.type, draft.options)}\n\nNão reconheci essa opção.`;
    }

    const transaction: WhatsappTransactionDraft = {
      ...draft.transaction,
      paymentLabel: selected.label,
      ...(selected.kind === 'ACCOUNT'
        ? { accountId: selected.id }
        : { creditCardId: selected.id }),
    };
    await this.setPendingTransactionDraft(userId, phone, transaction);
    return this.transactionDraftConfirmation(transaction);
  }

  private async tryCreateMutationDraft(
    userId: string,
    phone: string,
    message: string,
  ): Promise<string | null> {
    const normalized = this.normalizeText(message);
    const updateMatch = normalized.match(
      /\b(corrija|corrigir|altere|alterar|mude|mudar)\b.*\b(ultimo|ultima)\b.*\b(gasto|despesa|receita|lancamento)\b.*\b(para|por)\b\s*(?:r\$)?\s*(\d+(?:[.,]\d{1,2})?)/,
    );

    if (updateMatch) {
      const type =
        updateMatch[3] === 'gasto' || updateMatch[3] === 'despesa'
          ? TransactionType.EXPENSE
          : updateMatch[3] === 'receita'
            ? TransactionType.INCOME
            : undefined;
      const transaction = await this.prisma.transaction.findFirst({
        where: { userId, ...(type ? { type } : {}) },
        orderBy: { date: 'desc' },
        include: { category: true },
      });
      if (!transaction) {
        return type === TransactionType.EXPENSE
          ? 'Não encontrei nenhum gasto para corrigir.'
          : 'Não encontrei nenhum lançamento para corrigir.';
      }

      const newAmount = Number(updateMatch[5]!.replace(',', '.'));
      if (!Number.isFinite(newAmount) || newAmount <= 0) {
        return 'Informe um valor válido para a correção.';
      }

      const draft: WhatsappMutationDraft = {
        action: 'UPDATE_AMOUNT',
        transactionId: transaction.id,
        description: transaction.description,
        previousAmount: Number(transaction.amount),
        newAmount,
        type: transaction.type,
      };
      await this.setPendingMutationDraft(userId, phone, draft);
      return this.mutationDraftConfirmation(draft);
    }

    if (!/\b(apague|apagar|exclua|excluir|delete|deletar|remova|remover)\b/.test(normalized)) {
      return null;
    }

    const searchTerm = normalized
      .replace(/\b(apague|apagar|exclua|excluir|delete|deletar|remova|remover)\b/g, '')
      .replace(/\b(o|a|um|uma|meu|minha|lancamento|transacao|gasto|despesa|receita|do|da|de)\b/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!searchTerm) {
      return 'Qual lançamento você quer apagar? Informe parte do título ou da categoria.';
    }

    const recentTransactions = await this.prisma.transaction.findMany({
      where: { userId },
      orderBy: { date: 'desc' },
      take: 30,
      include: { category: true },
    });
    const transaction = recentTransactions.find((item) => {
      const searchable = this.normalizeText(`${item.description} ${item.category?.name ?? ''}`);
      return searchTerm.split(' ').every((term) => searchable.includes(term));
    });
    if (!transaction) {
      return `Não encontrei um lançamento relacionado a “${searchTerm}”.`;
    }

    const draft: WhatsappMutationDraft = {
      action: 'DELETE',
      transactionId: transaction.id,
      description: transaction.description,
      amount: Number(transaction.amount),
      type: transaction.type,
    };
    await this.setPendingMutationDraft(userId, phone, draft);
    return this.mutationDraftConfirmation(draft);
  }

  private mutationDraftConfirmation(draft: WhatsappMutationDraft): string {
    const type = draft.type === TransactionType.EXPENSE ? 'Despesa' : 'Receita';
    if (draft.action === 'UPDATE_AMOUNT') {
      return [
        'Confirme a correção:',
        '',
        `${type}: ${draft.description}`,
        `Valor atual: ${this.formatMoney(draft.previousAmount)}`,
        `Novo valor: ${this.formatMoney(draft.newAmount)}`,
        '',
        'Responda: Confirmar ou Cancelar.',
      ].join('\n');
    }
    return [
      'Confirme a exclusão:',
      '',
      `${type}: ${draft.description}`,
      `Valor: ${this.formatMoney(draft.amount)}`,
      '',
      'Essa ação não poderá ser desfeita.',
      'Responda: Confirmar ou Cancelar.',
    ].join('\n');
  }

  private async handleMutationConfirmation(
    userId: string,
    message: string,
    draft: WhatsappMutationDraft,
  ): Promise<string> {
    const command = this.normalizeText(message);
    if (/^(cancelar|cancela|nao|não)$/.test(command)) {
      await this.clearPendingMessage(userId);
      return draft.action === 'DELETE'
        ? 'Exclusão cancelada. O lançamento foi mantido.'
        : 'Correção cancelada. O lançamento não foi alterado.';
    }
    if (!/^(confirmar|confirmo|sim|pode|pode fazer)$/.test(command)) {
      return `${this.mutationDraftConfirmation(draft)}\n\nNão reconheci sua escolha.`;
    }

    if (draft.action === 'UPDATE_AMOUNT') {
      await this.transactionService.update(userId, draft.transactionId, {
        amount: draft.newAmount,
      });
      await this.clearPendingMessage(userId);
      return [
        'Lançamento corrigido ✅',
        `${draft.type === TransactionType.EXPENSE ? 'Despesa' : 'Receita'}: ${draft.description}`,
        `Novo valor: ${this.formatMoney(draft.newAmount)}`,
      ].join('\n');
    }

    await this.transactionService.delete(userId, draft.transactionId);
    await this.clearPendingMessage(userId);
    return [
      'Lançamento excluído ✅',
      `${draft.type === TransactionType.EXPENSE ? 'Despesa' : 'Receita'}: ${draft.description}`,
      `Valor: ${this.formatMoney(draft.amount)}`,
    ].join('\n');
  }

  private async getConversation(userId: string, phone: string) {
    return this.prisma.whatsappConversation.upsert({
      where: { userId },
      create: { userId, phone, recentMessages: [] },
      update: { phone },
    });
  }

  private async setPendingMessage(userId: string, phone: string, pendingText: string): Promise<void> {
    await this.prisma.whatsappConversation.upsert({
      where: { userId },
      create: { userId, phone, pendingText, recentMessages: [] },
      update: { phone, pendingText },
    });
  }

  private async setPendingTransactionDraft(
    userId: string,
    phone: string,
    draft: WhatsappTransactionDraft,
  ): Promise<void> {
    await this.setPendingMessage(
      userId,
      phone,
      `${TRANSACTION_CONFIRMATION_PREFIX}${JSON.stringify(draft)}`,
    );
  }

  private async setPendingMutationDraft(
    userId: string,
    phone: string,
    draft: WhatsappMutationDraft,
  ): Promise<void> {
    await this.setPendingMessage(
      userId,
      phone,
      `${TRANSACTION_MUTATION_PREFIX}${JSON.stringify(draft)}`,
    );
  }

  private async setPendingPaymentDraft(
    userId: string,
    phone: string,
    draft: WhatsappPaymentDraft,
  ): Promise<void> {
    await this.setPendingMessage(
      userId,
      phone,
      `${PAYMENT_SELECTION_PREFIX}${JSON.stringify(draft)}`,
    );
  }

  private async clearPendingMessage(userId: string): Promise<void> {
    await this.prisma.whatsappConversation.update({
      where: { userId },
      data: { pendingText: null },
    });
  }

  private parseTransactionDraft(value: string | null | undefined): WhatsappTransactionDraft | null {
    if (!value?.startsWith(TRANSACTION_CONFIRMATION_PREFIX)) {
      return null;
    }

    try {
      const draft = JSON.parse(value.slice(TRANSACTION_CONFIRMATION_PREFIX.length)) as Partial<WhatsappTransactionDraft>;
      if (
        typeof draft.description !== 'string' ||
        typeof draft.amount !== 'number' ||
        !Object.values(TransactionType).includes(draft.type as TransactionType) ||
        !Object.values(FinancialScope).includes(draft.scope as FinancialScope) ||
        typeof draft.categoryHint !== 'string'
      ) {
        return null;
      }
      return draft as WhatsappTransactionDraft;
    } catch {
      return null;
    }
  }

  private parseMutationDraft(value: string | null | undefined): WhatsappMutationDraft | null {
    if (!value?.startsWith(TRANSACTION_MUTATION_PREFIX)) {
      return null;
    }
    try {
      const draft = JSON.parse(
        value.slice(TRANSACTION_MUTATION_PREFIX.length),
      ) as Partial<WhatsappMutationDraft>;
      if (
        (draft.action !== 'UPDATE_AMOUNT' && draft.action !== 'DELETE') ||
        typeof draft.transactionId !== 'string' ||
        typeof draft.description !== 'string' ||
        !Object.values(TransactionType).includes(draft.type as TransactionType)
      ) {
        return null;
      }
      if (
        draft.action === 'UPDATE_AMOUNT' &&
        (typeof draft.previousAmount !== 'number' || typeof draft.newAmount !== 'number')
      ) {
        return null;
      }
      if (draft.action === 'DELETE' && typeof draft.amount !== 'number') {
        return null;
      }
      return draft as WhatsappMutationDraft;
    } catch {
      return null;
    }
  }

  private parsePaymentDraft(value: string | null | undefined): WhatsappPaymentDraft | null {
    if (!value?.startsWith(PAYMENT_SELECTION_PREFIX)) {
      return null;
    }
    try {
      const draft = JSON.parse(
        value.slice(PAYMENT_SELECTION_PREFIX.length),
      ) as Partial<WhatsappPaymentDraft>;
      if (
        !draft.transaction ||
        !Array.isArray(draft.options) ||
        !draft.options.length ||
        typeof draft.transaction.description !== 'string' ||
        typeof draft.transaction.amount !== 'number'
      ) {
        return null;
      }
      return draft as WhatsappPaymentDraft;
    } catch {
      return null;
    }
  }

  private async appendConversation(
    userId: string,
    phone: string,
    current: WhatsappConversationMessage[],
    userMessage: string,
    assistantMessage: string,
  ): Promise<void> {
    const recentMessages = [
      ...current,
      { role: 'user' as const, text: userMessage },
      { role: 'assistant' as const, text: assistantMessage },
    ].slice(-10);
    const messagesJson = recentMessages as unknown as Prisma.InputJsonValue;
    await this.prisma.whatsappConversation.upsert({
      where: { userId },
      create: { userId, phone, recentMessages: messagesJson },
      update: { phone, recentMessages: messagesJson },
    });
  }

  private parseRecentMessages(value: unknown): WhatsappConversationMessage[] {
    if (!Array.isArray(value)) return [];
    return value
      .filter(
        (item): item is WhatsappConversationMessage =>
          Boolean(
            item &&
              typeof item === 'object' &&
              'role' in item &&
              (item.role === 'user' || item.role === 'assistant') &&
              'text' in item &&
              typeof item.text === 'string',
          ),
      )
      .slice(-10);
  }

  private helpReply(): string {
    return [
      'Posso ajudar você a:',
      '• registrar receitas, gastos e vendas;',
      '• consultar saldo, gastos e receitas;',
      '• consultar semanas, meses específicos e comparar períodos;',
      '• comparar meses e identificar maiores despesas;',
      '• corrigir e excluir lançamentos com confirmação;',
      '• analisar suas finanças pessoais ou do negócio.',
      '',
      'Exemplos: “Gastos da semana”, “Despesas de maio”, “Compare este mês com o anterior” ou “Gastei R$ 40 no mercado”.',
    ].join('\n');
  }

  private async safeReply(phone: string, reply: string): Promise<void> {
    try {
      await this.sendMessage({ phone, message: reply });
    } catch {
      // O webhook deve registrar/processar a entrada mesmo se o provedor estiver temporariamente indisponivel.
    }
  }

  private extractPhone(payload: WhatsappWebhookDto): string {
    const data = this.asRecord(payload.data);
    const value = payload.phone ?? payload.number ?? payload.from ?? data?.phone ?? data?.number ?? data?.from;
    return String(value || '').replace(/\D/g, '');
  }

  private extractMessage(payload: WhatsappWebhookDto): string {
    const data = this.asRecord(payload.data);
    const nestedMessage = this.asRecord(data?.message);
    const value =
      payload.message ??
      payload.text ??
      payload.body ??
      data?.text ??
      data?.body ??
      nestedMessage?.conversation ??
      nestedMessage?.text;
    return typeof value === 'string' ? value.trim() : '';
  }

  private asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
  }

  private normalizeStatusResponse(response: unknown): WhatsappStatusResponse {
    const data = this.asRecord(response) ?? {};
    const rawStatus = String(data.status || 'iniciando');
    const qrCandidate = data.qrcode ?? data.qrCode ?? data.qr ?? data.base64;
    const qrcode = typeof qrCandidate === 'string' && qrCandidate.trim() ? qrCandidate.trim() : undefined;

    return {
      status: this.isKnownStatus(rawStatus) ? rawStatus : 'iniciando',
      ...(qrcode ? { qrcode } : {}),
    };
  }

  private isKnownStatus(value: string): value is WhatsappStatus {
    return ['aguardando_qr', 'conectado', 'iniciando', 'reconectando'].includes(value);
  }

  private isQuestion(message: string): boolean {
    const lower = this.normalizeText(message);
    return (
      message.includes('?') ||
      /^(quanto|qual|como|meu|minha|resumo|saldo|lucro)/.test(lower) ||
      lower.includes('quanto posso gastar')
    );
  }

  private isKnownFinancialQuestion(message: string): boolean {
    const lower = this.normalizeText(message);
    return (
      lower.includes('quanto gastei') ||
      this.isExpenseListQuestion(lower) ||
      this.isExpensePeriodQuestion(lower) ||
      this.isMonthComparisonQuestion(lower) ||
      lower.includes('quanto vendi') ||
      lower.includes('maior despesa') ||
      lower.includes('resumo do mes') ||
      lower.includes('saldo atual') ||
      lower.includes('meu negocio esta no lucro') ||
      lower.includes('como esta meu negocio')
    );
  }

  private isExpensePeriodQuestion(message: string): boolean {
    const lower = this.normalizeText(message);
    return (
      /\b(gastos|despesas)\b.*\b(semana|mes|janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\b/.test(
        lower,
      ) ||
      /\b(semana|mes|janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\b.*\b(gastos|despesas)\b/.test(
        lower,
      )
    );
  }

  private isMonthComparisonQuestion(message: string): boolean {
    const lower = this.normalizeText(message);
    return (
      /\b(compare|comparar|comparacao|diferenca)\b/.test(lower) &&
      /\b(mes|meses|anterior|passado)\b/.test(lower)
    );
  }

  private isExpenseListQuestion(message: string): boolean {
    const lower = this.normalizeText(message);
    return (
      /\b(quais|liste|listar|mostre|mostrar|detalhe|detalhar)\b.*\b(gastos|despesas)\b/.test(lower) ||
      /\b(meus gastos|minhas despesas|gastos do mes|despesas do mes)\b/.test(lower)
    );
  }

  private isHelpRequest(message: string): boolean {
    const lower = this.normalizeText(message);
    return (
      lower.includes('o que voce consegue fazer') ||
      lower.includes('como voce pode me ajudar') ||
      lower === 'ajuda' ||
      lower === 'menu'
    );
  }

  private isGreeting(message: string): boolean {
    return /^(oi|ola|bom dia|boa tarde|boa noite|tudo bem)[!,. ]*$/.test(this.normalizeText(message));
  }

  private looksLikeTransaction(message: string): boolean {
    const lower = this.normalizeText(message);
    return this.hasAmount(lower) && this.hasTransactionVerb(lower);
  }

  private isTransactionWithoutAmount(message: string): boolean {
    const lower = this.normalizeText(message);
    return this.hasTransactionVerb(lower) && !this.hasAmount(lower);
  }

  private missingAmountQuestion(message: string): string {
    const lower = this.normalizeText(message);
    if (/\b(gastei|paguei|comprei|saiu)\b/.test(lower)) {
      return lower.includes('hoje')
        ? 'Quanto você gastou hoje?'
        : 'Qual foi o valor desse gasto?';
    }
    if (lower.includes('vendi')) {
      return lower.includes('hoje')
        ? 'Quanto você recebeu com essa venda hoje?'
        : 'Qual foi o valor dessa venda?';
    }
    return lower.includes('hoje') || /\bhj\b/.test(lower)
      ? 'Quanto você ganhou hoje?'
      : 'Qual foi o valor que você recebeu?';
  }

  private missingDescriptionQuestion(message: string): string {
    const lower = this.normalizeText(message);
    if (lower.includes('vendi')) {
      return 'O que você vendeu e por qual canal?';
    }
    if (/\b(recebi|ganhei|entrou)\b/.test(lower)) {
      return 'De onde veio esse dinheiro? Por exemplo: salário, venda, serviço ou transferência.';
    }
    return 'Com o que foi esse gasto? Por exemplo: mercado, restaurante, transporte ou conta.';
  }

  private hasAmount(message: string): boolean {
    return /(?:r\$ ?)?\d+([\.,]\d{1,2})?/.test(message);
  }

  private hasTransactionVerb(message: string): boolean {
    return /\b(gastei|paguei|comprei|recebi|vendi|ganhei|entrou|saiu)\b/.test(message);
  }

  private needsMoreDescription(message: string): boolean {
    const lower = this.normalizeText(message);
    if (!this.hasAmount(lower)) return false;
    return /^(gastei|paguei|recebi|vendi|ganhei|entrou) (?:r\$ ?)?\d+([\.,]\d{1,2})?$/.test(lower);
  }

  private inferScope(message: string, hasChannel: boolean): FinancialScope {
    const lower = this.normalizeText(message);
    const explicitScope = this.inferExplicitScope(lower);
    if (explicitScope) {
      return explicitScope;
    }
    if (hasChannel || lower.includes('loja') || lower.includes('frete')) {
      return FinancialScope.BUSINESS;
    }
    return FinancialScope.PERSONAL;
  }

  private inferExplicitScope(message: string): FinancialScope | null {
    const lower = this.normalizeText(message);
    if (/\b(negocio|empresa|empresarial|comercial)\b/.test(lower)) {
      return FinancialScope.BUSINESS;
    }
    if (/\b(pessoal|particular|renda extra)\b/.test(lower)) {
      return FinancialScope.PERSONAL;
    }
    return null;
  }

  private isSaleMessage(message: string): boolean {
    return /\b(vendi|venda|vendeu|comercializei|comercializacao)\b/.test(this.normalizeText(message));
  }

  private inferIncomeCategory(message: string): string | null {
    const lower = this.normalizeText(message);
    const categories: Array<[RegExp, string]> = [
      [/\b(servico|freelance|freela|bico)\b/, 'Serviços'],
      [/\b(salario|ordenado|pagamento da empresa)\b/, 'Salário'],
      [/\b(transferencia|pix recebido)\b/, 'Transferência'],
      [/\b(comissao|comissionamento)\b/, 'Comissão'],
      [/\b(aluguel|locacao)\b/, 'Aluguel'],
      [/\b(juros|rendimento|dividendo)\b/, 'Rendimentos'],
      [/\b(premio|bonificacao|bonus)\b/, 'Bonificação'],
      [/\b(reembolso|devolucao)\b/, 'Reembolso'],
    ];

    return categories.find(([pattern]) => pattern.test(lower))?.[1] ?? null;
  }

  private buildTransactionDescription(
    extractedDescription: string | undefined,
    categoryName: string,
    type: TransactionType,
    isSale: boolean,
  ): string {
    const description = String(extractedDescription || '')
      .replace(/\s+/g, ' ')
      .replace(/[.!?]+$/g, '')
      .trim();

    if (description) {
      return description.charAt(0).toUpperCase() + description.slice(1);
    }

    const category = categoryName.trim().toLocaleLowerCase('pt-BR');
    if (type === TransactionType.INCOME) {
      return isSale ? `Venda de ${category}` : `Receita de ${category}`;
    }
    return `Gasto com ${category}`;
  }

  private currentMonthRange(): { start: Date; end: Date } {
    const now = new Date();
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    return { start, end };
  }

  private resolveFinancialPeriod(message: string): FinancialPeriod {
    const lower = this.normalizeText(message);
    if (lower.includes('semana')) {
      const now = new Date();
      const day = now.getUTCDay();
      const daysSinceMonday = day === 0 ? 6 : day - 1;
      const start = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysSinceMonday),
      );
      const end = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1),
      );
      return { start, end, label: 'esta semana' };
    }

    const months = [
      'janeiro',
      'fevereiro',
      'marco',
      'abril',
      'maio',
      'junho',
      'julho',
      'agosto',
      'setembro',
      'outubro',
      'novembro',
      'dezembro',
    ];
    const monthIndex = months.findIndex((month) => lower.includes(month));
    if (monthIndex >= 0) {
      const now = new Date();
      const explicitYear = lower.match(/\b(20\d{2})\b/)?.[1];
      const year = explicitYear
        ? Number(explicitYear)
        : monthIndex > now.getUTCMonth()
          ? now.getUTCFullYear() - 1
          : now.getUTCFullYear();
      const start = new Date(Date.UTC(year, monthIndex, 1));
      const end = new Date(Date.UTC(year, monthIndex + 1, 1));
      return { start, end, label: this.monthLabel(start) };
    }

    const current = this.currentMonthRange();
    return { ...current, label: 'este mês' };
  }

  private monthLabel(date: Date): string {
    return new Intl.DateTimeFormat('pt-BR', {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(date);
  }

  private periodAt(label: string): string {
    if (label === 'este mês') return 'Neste mês';
    if (label === 'esta semana') return 'Nesta semana';
    return `Em ${label}`;
  }

  private periodOf(label: string): string {
    if (label === 'este mês') return 'deste mês';
    if (label === 'esta semana') return 'desta semana';
    return `de ${label}`;
  }

  private previousMonthRange(): { start: Date; end: Date } {
    const now = new Date();
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    return { start, end };
  }

  private percentageChange(previous: number, current: number): string {
    if (previous === 0) {
      return current === 0 ? 'sem alteração' : 'sem base de comparação';
    }
    const change = ((current - previous) / Math.abs(previous)) * 100;
    if (change === 0) return 'sem alteração';
    const direction = change > 0 ? 'aumento' : 'queda';
    return `${direction} de ${Math.abs(change).toFixed(1).replace('.', ',')}%`;
  }

  private normalizeText(value: string): string {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  }

  private titleCase(value: string): string {
    return value
      .trim()
      .split(/\s+/)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');
  }

  private formatMoney(value: number): string {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);

    try {
      const response = await fetch(`${this.baseUrl}${this.normalizePath(path)}`, {
        ...init,
        headers: {
          'Content-Type': 'application/json',
          ...init.headers,
        },
        signal: controller.signal,
      });
      const body = (await response.json().catch(() => null)) as unknown;
      const bodyRecord = this.asRecord(body);

      if (!response.ok) {
        const message =
          String(bodyRecord?.message || bodyRecord?.error || '') || 'Falha ao comunicar com a API WhatsApp.';
        throw new ServiceUnavailableException(message);
      }

      return this.unwrapProviderData<T>(body);
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      if (error instanceof Error && error.name === 'AbortError') {
        throw new ServiceUnavailableException('A API WhatsApp demorou para responder.');
      }
      throw new ServiceUnavailableException('Nao foi possivel comunicar com a API WhatsApp.');
    } finally {
      clearTimeout(timeout);
    }
  }

  private normalizePath(path: string): string {
    return `/${path.replace(/^\/+/, '')}`;
  }

  private unwrapProviderData<T>(body: unknown): T {
    const record = this.asRecord(body);
    if (record && 'data' in record && record.data !== undefined) {
      return record.data as T;
    }
    return body as T;
  }
}
