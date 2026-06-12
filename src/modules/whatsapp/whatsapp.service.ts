import { BadRequestException, Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { FinancialScope, Prisma, Transaction, TransactionSource, TransactionType } from '@prisma/client';
import { env } from '@/config/env';
import { PrismaService } from '@/config/database';
import { GeminiService, WhatsappConversationMessage } from '@/services/ai/gemini.service';
import { TransactionService } from '@/modules/transactions/transaction.service';
import { SendWhatsappMessageDto } from './dto/send-whatsapp-message.dto';
import { WhatsappWebhookDto } from './dto/whatsapp-webhook.dto';

type WhatsappStatus = 'aguardando_qr' | 'conectado' | 'iniciando' | 'reconectando';

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

    const categoryHint = String(extracted.categoryHint || '').trim();
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
    const channel =
      scope === FinancialScope.BUSINESS
        ? await this.resolveChannel(userId, extracted.channelHint)
        : undefined;
    const category = await this.resolveCategory(userId, categoryHint, extracted.type);
    const description = this.buildTransactionDescription(
      extracted.description,
      category.name,
      extracted.type as TransactionType,
      isSale,
    );

    const transaction = await this.transactionService.create(userId, {
      description,
      amount: extracted.amount,
      type: extracted.type as TransactionType,
      source: TransactionSource.WHATSAPP,
      scope,
      categoryId: category.id,
      ...(channel ? { channelId: channel.id } : {}),
    });

    return this.transactionConfirmation(transaction, category.name, channel?.name, scope);
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
    const { start, end } = this.currentMonthRange();

    if (lower.includes('shopee') || lower.includes('instagram') || lower.includes('mercado livre')) {
      const channelName = lower.includes('shopee')
        ? 'Shopee'
        : lower.includes('instagram')
          ? 'Instagram'
          : 'Mercado Livre';
      const result = await this.totalByChannel(userId, channelName, start, end);
      return `Neste mes voce vendeu ${this.formatMoney(result)} em ${channelName}.`;
    }

    if (lower.includes('maior despesa')) {
      const largest = await this.prisma.transaction.findFirst({
        where: { userId, type: 'EXPENSE', date: { gte: start, lte: end }, ...(scope ? { scope } : {}) },
        orderBy: { amount: 'desc' },
        include: { category: true },
      });
      if (!largest) return 'Voce ainda nao tem despesas registradas neste mes.';
      return `Sua maior despesa do mes foi ${largest.description}: ${this.formatMoney(Number(largest.amount))} em ${largest.category.name}.`;
    }

    if (lower.includes('lucro') || lower.includes('negocio')) {
      const totals = await this.monthTotals(userId, start, end, FinancialScope.BUSINESS);
      return `Seu negocio esta com saldo de ${this.formatMoney(totals.balance)} neste mes.\nReceitas: ${this.formatMoney(totals.income)}\nGastos: ${this.formatMoney(totals.expense)}.`;
    }

    const totals = await this.monthTotals(userId, start, end, scope);
    if (lower.includes('gastei') || lower.includes('gasto') || lower.includes('despesa')) {
      const topCategory = await this.topExpenseCategory(userId, start, end, scope);
      return [
        `Neste mes voce gastou ${this.formatMoney(totals.expense)}.`,
        topCategory ? `Maior categoria: ${topCategory.name} - ${this.formatMoney(topCategory.total)}.` : '',
        `Saldo atual: ${this.formatMoney(totals.balance)}.`,
      ]
        .filter(Boolean)
        .join('\n');
    }

    return `Resumo do mes:\nReceitas: ${this.formatMoney(totals.income)}\nGastos: ${this.formatMoney(totals.expense)}\nSaldo: ${this.formatMoney(totals.balance)}.`;
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
        where: { userId, type: 'INCOME', date: { gte: start, lte: end }, ...(scope ? { scope } : {}) },
        _sum: { netAmount: true },
      }),
      this.prisma.transaction.aggregate({
        where: { userId, type: 'EXPENSE', date: { gte: start, lte: end }, ...(scope ? { scope } : {}) },
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
      where: { userId, type: 'EXPENSE', date: { gte: start, lte: end }, ...(scope ? { scope } : {}) },
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
      where: { userId, type: 'EXPENSE', date: { gte: start, lte: end } },
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
      where: { userId, channelId: channel.id, type: 'INCOME', date: { gte: start, lte: end } },
      _sum: { netAmount: true },
    });
    return Number(result._sum.netAmount ?? 0);
  }

  private transactionConfirmation(
    transaction: Transaction,
    categoryName: string,
    channelName: string | undefined,
    scope: FinancialScope,
  ): string {
    const type = transaction.type === 'EXPENSE' ? 'Despesa' : 'Receita';
    return [
      'Lancamento registrado ✅',
      '',
      `${type}: ${transaction.description}`,
      `Valor: ${this.formatMoney(Number(transaction.amount))}`,
      `Categoria: ${categoryName}`,
      channelName ? `Canal: ${channelName}` : '',
      `Modo: ${scope === 'BUSINESS' ? 'Negocio' : 'Pessoal'}`,
    ]
      .filter(Boolean)
      .join('\n');
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
      '• comparar meses e identificar maiores despesas;',
      '• analisar suas finanças pessoais ou do negócio.',
      '',
      'Exemplos: “Gastei R$ 40 no mercado” ou “Onde estou gastando mais?”.',
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
      lower.includes('quanto vendi') ||
      lower.includes('maior despesa') ||
      lower.includes('resumo do mes') ||
      lower.includes('saldo atual') ||
      lower.includes('meu negocio esta no lucro') ||
      lower.includes('como esta meu negocio')
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
