import { BadRequestException, Inject, Injectable, Optional } from '@nestjs/common';
import {
  FinancialAccountType,
  FinancialScope,
  Prisma,
  Transaction,
  TransactionSource,
  TransactionType,
} from '@prisma/client';
import { PrismaService } from '@/config/database';
import { GeminiService, WhatsappConversationMessage } from '@/services/ai/gemini.service';
import { TransactionService } from '@/modules/transactions/transaction.service';
import { SendWhatsappMessageDto } from './dto/send-whatsapp-message.dto';
import { WhatsappWebhookDto } from './dto/whatsapp-webhook.dto';
import { WhatsappConversationStore } from './whatsapp-conversation.store';
import { WhatsappProviderClient } from './whatsapp-provider.client';
import {
  FinancialPeriod,
  WhatsappCategoryDraft,
  WhatsappConversationState,
  WhatsappDraftEdit,
  WhatsappMutationDraft,
  WhatsappPaymentDraft,
  WhatsappPaymentOption,
  WhatsappStatusResponse,
  WhatsappTransactionDraft,
} from './whatsapp.types';

export type { WhatsappStatusResponse } from './whatsapp.types';

const TRANSACTION_CONFIRMATION_PREFIX = '__TRANSACTION_CONFIRMATION__:';
const TRANSACTION_MUTATION_PREFIX = '__TRANSACTION_MUTATION__:';
const PAYMENT_SELECTION_PREFIX = '__PAYMENT_SELECTION__:';
const CATEGORY_SELECTION_PREFIX = '__CATEGORY_SELECTION__:';
const MEDIA_WITHOUT_DOWNLOADABLE_AUDIO = '__WHATSAPP_MEDIA_WITHOUT_DOWNLOADABLE_AUDIO__';
export interface ProactiveBudgetAlertResult {
  checked: number;
  sent: number;
  skipped: number;
  failed: number;
}

type WhatsappAudioInput = {
  base64?: string;
  url?: string;
  mimeType: string;
};

@Injectable()
export class WhatsappService {
  private readonly conversationStore: WhatsappConversationStore;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(GeminiService) private readonly geminiService: GeminiService,
    @Inject(TransactionService) private readonly transactionService: TransactionService,
    @Optional()
    @Inject(WhatsappProviderClient)
    private readonly providerClient: WhatsappProviderClient = new WhatsappProviderClient(),
    @Optional()
    @Inject(WhatsappConversationStore)
    conversationStore?: WhatsappConversationStore,
  ) {
    this.conversationStore = conversationStore ?? new WhatsappConversationStore(prisma);
  }

  async getStatus(): Promise<WhatsappStatusResponse> {
    return this.providerClient.getStatus();
  }

  async restart(): Promise<WhatsappStatusResponse> {
    return this.providerClient.restart();
  }

  async sendMessage(dto: SendWhatsappMessageDto): Promise<unknown> {
    return this.providerClient.sendMessage(dto);
  }

  async runProactiveBudgetAlerts(): Promise<ProactiveBudgetAlertResult> {
    const month = this.currentMonthRange().start;
    const budgets = await this.prisma.categoryBudget.findMany({
      where: { month },
      include: {
        category: true,
        user: { select: { phone: true } },
      },
    });
    const result: ProactiveBudgetAlertResult = {
      checked: budgets.length,
      sent: 0,
      skipped: 0,
      failed: 0,
    };

    for (const budget of budgets) {
      const limit = Number(budget.amount);
      const spent = await this.categoryExpenseTotal(
        budget.userId,
        budget.categoryId,
        budget.scope,
        month,
      );
      const percentage = limit > 0 ? Math.round((spent / limit) * 100) : 0;
      const targetLevel = percentage >= 100 ? 100 : percentage >= 80 ? 80 : 0;

      if (targetLevel === 0) {
        if (budget.alertLevel > 0) {
          await this.prisma.categoryBudget.update({
            where: { id: budget.id },
            data: { alertLevel: 0, lastAlertAt: null },
          });
        }
        result.skipped += 1;
        continue;
      }

      if (budget.alertLevel >= targetLevel) {
        result.skipped += 1;
        continue;
      }

      try {
        await this.sendMessage({
          phone: this.normalizeRecipientPhone(budget.user.phone),
          message: this.proactiveBudgetAlertMessage({
            categoryName: budget.category.name,
            scope: budget.scope,
            limit,
            spent,
            percentage,
          }),
        });
        await this.prisma.categoryBudget.update({
          where: { id: budget.id },
          data: { alertLevel: targetLevel, lastAlertAt: new Date() },
        });
        result.sent += 1;
      } catch {
        result.failed += 1;
      }
    }

    return result;
  }

  async handleWebhook(dto: WhatsappWebhookDto): Promise<{ phone: string; reply: string }> {
    const phone = this.extractPhone(dto);

    if (!phone) {
      throw new BadRequestException('Webhook WhatsApp precisa informar telefone e mensagem.');
    }

    const message = await this.extractMessageOrTranscribeAudio(dto, phone);
    if (message === null) {
      const reply = this.audioTranscriptionFailedReply();
      return { phone, reply };
    }
    if (message === MEDIA_WITHOUT_DOWNLOADABLE_AUDIO) {
      const reply = this.audioWithoutDownloadableFileReply();
      await this.safeReply(phone, reply);
      return { phone, reply };
    }
    if (!message) {
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
    const pendingValue = this.conversationPendingValue(conversation);

    const categoryDraft = this.parseCategoryDraft(pendingValue);
    if (categoryDraft) {
      const reply = await this.handleCategorySelection(user.id, phone, message, categoryDraft);
      await this.appendConversation(user.id, phone, recentMessages, message, reply);
      await this.safeReply(phone, reply);
      return { phone, reply };
    }

    if (this.isMenuCommand(message)) {
      await this.clearPendingMessage(user.id);
      const reply = this.helpReply();
      await this.appendConversation(user.id, phone, recentMessages, message, reply);
      await this.safeReply(phone, reply);
      return { phone, reply };
    }

    const paymentDraft = this.parsePaymentDraft(pendingValue);
    if (paymentDraft) {
      const reply = await this.handlePaymentSelection(user.id, phone, message, paymentDraft);
      await this.appendConversation(user.id, phone, recentMessages, message, reply);
      await this.safeReply(phone, reply);
      return { phone, reply };
    }

    const mutationDraft = this.parseMutationDraft(pendingValue);
    if (mutationDraft) {
      const reply = await this.handleMutationConfirmation(user.id, message, mutationDraft);
      await this.appendConversation(user.id, phone, recentMessages, message, reply);
      await this.safeReply(phone, reply);
      return { phone, reply };
    }

    const transactionDraft = this.parseTransactionDraft(pendingValue);
    if (transactionDraft) {
      const reply = await this.handleTransactionConfirmation(
        user.id,
        phone,
        message,
        transactionDraft,
      );
      await this.appendConversation(user.id, phone, recentMessages, message, reply);
      await this.safeReply(phone, reply);
      return { phone, reply };
    }

    if (this.isCancelCommand(message)) {
      await this.clearPendingMessage(user.id);
      const reply = pendingValue || this.pendingDetailsText(conversation)
        ? 'Conversa cancelada. Nenhuma informação pendente foi salva.'
        : 'Não há nenhuma conversa pendente para cancelar.';
      await this.appendConversation(user.id, phone, recentMessages, message, reply);
      await this.safeReply(phone, reply);
      return { phone, reply };
    }

    const pendingDetails = this.pendingDetailsText(conversation);
    if (
      pendingDetails &&
      conversation.pendingStep === 'WAITING_AMOUNT' &&
      this.isAudioReferenceMessage(message)
    ) {
      const reply = this.audioAmountNotCapturedReply(pendingDetails);
      await this.appendConversation(user.id, phone, recentMessages, message, reply);
      await this.safeReply(phone, reply);
      return { phone, reply };
    }

    const textToProcess = pendingDetails ? `${pendingDetails}. ${message}` : message;
    if (pendingValue || pendingDetails) {
      await this.clearPendingMessage(user.id);
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

  async handleAppMessage(userId: string, message: string): Promise<{ reply: string }> {
    const cleanMessage = message.trim();
    if (!cleanMessage) {
      throw new BadRequestException('Informe uma mensagem para o Din.');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, phone: true },
    });
    if (!user) {
      throw new BadRequestException('Usuario nao encontrado.');
    }

    const phone = user.phone ? this.normalizeRecipientPhone(user.phone) : `app-${user.id}`;
    const conversation = await this.getConversation(user.id, phone);
    const recentMessages = this.parseRecentMessages(conversation.recentMessages);
    const pendingValue = this.conversationPendingValue(conversation);

    const categoryDraft = this.parseCategoryDraft(pendingValue);
    if (categoryDraft) {
      const reply = await this.handleCategorySelection(user.id, phone, cleanMessage, categoryDraft);
      await this.appendConversation(user.id, phone, recentMessages, cleanMessage, reply);
      return { reply };
    }

    if (this.isMenuCommand(cleanMessage)) {
      await this.clearPendingMessage(user.id);
      const reply = this.helpReply();
      await this.appendConversation(user.id, phone, recentMessages, cleanMessage, reply);
      return { reply };
    }

    const paymentDraft = this.parsePaymentDraft(pendingValue);
    if (paymentDraft) {
      const reply = await this.handlePaymentSelection(user.id, phone, cleanMessage, paymentDraft);
      await this.appendConversation(user.id, phone, recentMessages, cleanMessage, reply);
      return { reply };
    }

    const mutationDraft = this.parseMutationDraft(pendingValue);
    if (mutationDraft) {
      const reply = await this.handleMutationConfirmation(user.id, cleanMessage, mutationDraft);
      await this.appendConversation(user.id, phone, recentMessages, cleanMessage, reply);
      return { reply };
    }

    const transactionDraft = this.parseTransactionDraft(pendingValue);
    if (transactionDraft) {
      const reply = await this.handleTransactionConfirmation(user.id, phone, cleanMessage, transactionDraft);
      await this.appendConversation(user.id, phone, recentMessages, cleanMessage, reply);
      return { reply };
    }

    if (this.isCancelCommand(cleanMessage)) {
      await this.clearPendingMessage(user.id);
      const reply = pendingValue || this.pendingDetailsText(conversation)
        ? 'Conversa cancelada. Nenhuma informacao pendente foi salva.'
        : 'Nao ha nenhuma conversa pendente para cancelar.';
      await this.appendConversation(user.id, phone, recentMessages, cleanMessage, reply);
      return { reply };
    }

    const pendingDetails = this.pendingDetailsText(conversation);
    if (
      pendingDetails &&
      conversation.pendingStep === 'WAITING_AMOUNT' &&
      this.isAudioReferenceMessage(cleanMessage)
    ) {
      const reply = this.audioAmountNotCapturedReply(pendingDetails);
      await this.appendConversation(user.id, phone, recentMessages, cleanMessage, reply);
      return { reply };
    }

    const textToProcess = pendingDetails ? `${pendingDetails}. ${cleanMessage}` : cleanMessage;
    if (pendingValue || pendingDetails) {
      await this.clearPendingMessage(user.id);
    }

    const reply = await this.processUserMessage(
      user.id,
      user.name,
      phone,
      textToProcess,
      recentMessages,
    );
    await this.appendConversation(user.id, phone, recentMessages, cleanMessage, reply);
    return { reply };
  }

  private async processUserMessage(
    userId: string,
    userName: string,
    phone: string,
    message: string,
    recentMessages: WhatsappConversationMessage[],
  ): Promise<string> {
    const accountReply = await this.tryCreateFinancialAccount(userId, message);
    if (accountReply) {
      return accountReply;
    }

    const budgetReply = await this.trySetCategoryBudget(userId, message);
    if (budgetReply) {
      return budgetReply;
    }

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
      await this.setPendingMessage(
        userId,
        phone,
        message,
        'TRANSACTION_DETAILS',
        'WAITING_AMOUNT',
      );
      return this.missingAmountQuestion(message);
    }

    if (this.needsMoreDescription(message)) {
      await this.setPendingMessage(
        userId,
        phone,
        message,
        'TRANSACTION_DETAILS',
        'WAITING_DESCRIPTION',
      );
      return this.missingDescriptionQuestion(message);
    }

    if (this.looksLikeTransaction(message)) {
      return this.createTransactionFromMessage(userId, phone, message);
    }

    try {
      const classification = await this.geminiService.classifyWhatsappMessage(message, recentMessages);

      if (classification.confidence < 0.6) {
        return '🤔 Não entendi com segurança. Você quer registrar um lançamento ou consultar suas finanças?';
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
        return `👋 Olá, ${userName.split(/\s+/)[0]}. Como posso ajudar com suas finanças hoje?`;
      }
      return '🤔 Não consegui analisar essa pergunta agora. Você ainda pode consultar saldo, gastos, receitas ou registrar um lançamento.';
    }

    return '💬 Posso registrar receitas e gastos ou responder perguntas sobre suas finanças. O que você quer consultar?';
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
      return '🤔 Não entendi se isso é uma receita, gasto, venda ou pergunta. Pode mandar com valor e descrição?';
    }

    const extractedCategoryHint = String(extracted.categoryHint || '').trim();
    const followUpDetailHint = this.extractFollowUpDetailHint(
      message,
      extracted.type as TransactionType,
    );
    const followUpCategoryHint = this.inferExpenseCategoryFromDetail(
      followUpDetailHint,
      categories.map((item) => item.name),
    );
    let categoryHint =
      extracted.type === 'INCOME' &&
      (!extractedCategoryHint ||
        this.normalizeText(extractedCategoryHint) === 'nao_especificado')
        ? this.inferIncomeCategory(message) ?? extractedCategoryHint
        : this.normalizeText(extractedCategoryHint) === 'nao_especificado'
          ? (followUpCategoryHint ?? extractedCategoryHint)
          : this.isGranularFollowUpCategory(extractedCategoryHint, followUpDetailHint)
            ? (followUpCategoryHint ?? extractedCategoryHint)
          : extractedCategoryHint;
    categoryHint = await this.applyLearnedCategoryPreference(
      userId,
      categoryHint,
      extracted.type as TransactionType,
      [followUpDetailHint, extractedCategoryHint, extracted.description],
    );
    categoryHint = this.formatCategoryName(categoryHint, extracted.type as TransactionType);
    if (!categoryHint || this.normalizeText(categoryHint) === 'nao_especificado') {
      await this.setPendingMessage(
        userId,
        phone,
        message,
        'TRANSACTION_DETAILS',
        extracted.type === 'INCOME' ? 'WAITING_ORIGIN' : 'WAITING_CATEGORY',
      );
      return extracted.type === 'INCOME'
        ? '💰 De onde veio esse dinheiro? Por exemplo: salário, venda, serviço ou transferência.'
        : '📝 Com o que foi esse gasto? Por exemplo: mercado, restaurante, transporte ou conta.';
    }

    const explicitScope = this.inferExplicitScope(message);
    const isSale = extracted.type === 'INCOME' && this.isSaleMessage(message);

    if (isSale && !explicitScope) {
      await this.setPendingMessage(
        userId,
        phone,
        message,
        'TRANSACTION_DETAILS',
        'WAITING_SCOPE',
      );
      return '🏷️ Essa venda foi uma renda pessoal ou pertence ao seu negócio? Responda: Pessoal ou Negócio.';
    }

    if (isSale && explicitScope === FinancialScope.BUSINESS && !extracted.channelHint) {
      await this.setPendingMessage(
        userId,
        phone,
        message,
        'TRANSACTION_DETAILS',
        'WAITING_CHANNEL',
      );
      return '🛒 Por qual canal você fez essa venda? Por exemplo: Shopee, Instagram, loja física ou venda direta.';
    }

    const scope =
      explicitScope ?? this.inferScope(message, Boolean(extracted.channelHint));
    const description = this.buildTransactionDescription(
      this.preferFollowUpDescription(
        extracted.description,
        followUpDetailHint,
        extracted.type as TransactionType,
      ),
      categoryHint,
      extracted.type as TransactionType,
      isSale,
    );
    const transactionDate = this.resolveTransactionDate(message);
    const installmentCount = this.extractInstallmentCount(message);
    const totalAmount = extracted.amount;
    const amount =
      installmentCount > 1
        ? Math.round((totalAmount / installmentCount) * 100) / 100
        : totalAmount;
    const draft: WhatsappTransactionDraft = {
      description,
      amount,
      ...(installmentCount > 1 ? { totalAmount, installmentCount } : {}),
      ...(transactionDate ? { transactionDate: transactionDate.toISOString() } : {}),
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

    if (this.shouldAskCategoryConfirmation(draft)) {
      const categoryOptions = this.categorySuggestionOptions(categories.map((item) => item.name));
      await this.setPendingCategoryDraft(userId, phone, {
        transaction: draft,
        options: categoryOptions,
      });
      return this.categorySelectionQuestion(draft, categoryOptions);
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

    if (this.isCompleteSummaryQuestion(lower)) {
      return this.answerCompleteSummary(userId, period);
    }

    if (this.isScopeComparisonQuestion(lower)) {
      return this.answerScopeComparison(userId, period);
    }

    if (this.isCategoryExpenseQuestion(lower)) {
      return this.answerExpenseCategories(userId, period, scope);
    }

    if (this.isIncomeOriginQuestion(lower)) {
      return this.answerIncomeOrigins(userId, period, scope);
    }

    if (this.isLargestIncreaseQuestion(lower)) {
      return this.answerLargestExpenseIncreases(userId, scope);
    }

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
      if (!largest) return `📭 Você ainda não tem despesas registradas ${this.periodAt(period.label).toLocaleLowerCase('pt-BR')}.`;
      return `💸 Sua maior despesa ${this.periodAt(period.label).toLocaleLowerCase('pt-BR')} foi ${largest.description}: ${this.formatMoney(Number(largest.amount))} em ${largest.category.name}.`;
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
        return `📭 Você ainda não tem gastos registrados ${this.periodAt(period.label).toLocaleLowerCase('pt-BR')}.`;
      }

      const total = expenses.reduce((sum, item) => sum + Number(item.netAmount ?? item.amount), 0);
      const lines = expenses.map(
        (item, index) =>
          `${index + 1}. ${item.description} — ${item.category.name}: ${this.formatMoney(Number(item.netAmount ?? item.amount))}`,
      );
      return [
        `📊 *Seus gastos ${this.periodOf(period.label)}:*`,
        ...lines,
        '',
        `💵 *Total: ${this.formatMoney(total)}*`,
        expenses.length === 15 ? '🔎 Mostrando os 15 gastos mais recentes.' : '',
      ]
        .filter(Boolean)
        .join('\n');
    }

    if (lower.includes('lucro') || lower.includes('negocio')) {
      const totals = await this.monthTotals(userId, start, end, FinancialScope.BUSINESS);
      return `🏪 *Resumo do negócio*\n\n💵 *Saldo: ${this.formatMoney(totals.balance)}* ${this.periodAt(period.label).toLocaleLowerCase('pt-BR')}.\n💰 *Receitas: ${this.formatMoney(totals.income)}*\n💸 *Gastos: ${this.formatMoney(totals.expense)}*.`;
    }

    const totals = await this.monthTotals(userId, start, end, scope);
    if (lower.includes('gastei') || lower.includes('gasto') || lower.includes('despesa')) {
      const topCategory = await this.topExpenseCategory(userId, start, end, scope);
      return [
        `📊 *${this.periodAt(period.label)}, você gastou ${this.formatMoney(totals.expense)}.*`,
        topCategory ? `🏷️ Maior categoria: *${topCategory.name} - ${this.formatMoney(topCategory.total)}.*` : '',
        `💵 Resultado do período: *${this.formatMoney(totals.balance)}.*`,
      ]
        .filter(Boolean)
        .join('\n');
    }

    return `📊 *Resumo ${this.periodOf(period.label)}*\n\n💰 *Receitas: ${this.formatMoney(totals.income)}*\n💸 *Gastos: ${this.formatMoney(totals.expense)}*\n💵 *Saldo: ${this.formatMoney(totals.balance)}*.`;
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
      `📊 *Comparação: ${currentLabel} x ${previousLabel}*`,
      '',
      `💰 *Receitas: ${this.formatMoney(currentTotals.income)} (${this.percentageChange(previousTotals.income, currentTotals.income)})*`,
      `💸 *Gastos: ${this.formatMoney(currentTotals.expense)} (${this.percentageChange(previousTotals.expense, currentTotals.expense)})*`,
      `💵 *Saldo: ${this.formatMoney(currentTotals.balance)} (antes ${this.formatMoney(previousTotals.balance)})*`,
    ].join('\n');
  }

  private async answerCompleteSummary(
    userId: string,
    period: FinancialPeriod,
  ): Promise<string> {
    const [totals, categories, origins, personal, business, increases] = await Promise.all([
      this.monthTotals(userId, period.start, period.end),
      this.expenseCategories(userId, period.start, period.end),
      this.incomeOrigins(userId, period.start, period.end),
      this.monthTotals(userId, period.start, period.end, FinancialScope.PERSONAL),
      this.monthTotals(userId, period.start, period.end, FinancialScope.BUSINESS),
      this.largestExpenseIncreases(userId),
    ]);
    return [
      `📊 *Resumo completo ${this.periodOf(period.label)}*`,
      '',
      `💰 *Receitas: ${this.formatMoney(totals.income)}*`,
      `💸 *Gastos: ${this.formatMoney(totals.expense)}*`,
      `💵 *Saldo: ${this.formatMoney(totals.balance)}*`,
      '',
      this.formatDistribution('Gastos por categoria', categories),
      '',
      this.formatDistribution('Receitas por origem', origins),
      '',
      `👤 *Pessoal: ${this.formatMoney(personal.balance)} de saldo*`,
      `🏪 *Negócio: ${this.formatMoney(business.balance)} de saldo*`,
      '',
      increases.length
        ? `⚠️ Maiores aumentos: ${increases
            .slice(0, 3)
            .map((item) => `${item.name} +${this.formatMoney(item.increase)}`)
            .join(', ')}.`
        : '✅ Nenhum aumento de gasto relevante contra o mês anterior.',
    ].join('\n');
  }

  private async answerExpenseCategories(
    userId: string,
    period: FinancialPeriod,
    scope?: FinancialScope,
  ): Promise<string> {
    const categories = await this.expenseCategories(userId, period.start, period.end, scope);
    return categories.length
      ? `${this.formatDistribution(`Gastos por categoria ${this.periodOf(period.label)}`, categories)}`
      : `📭 Você ainda não tem gastos registrados ${this.periodAt(period.label).toLocaleLowerCase('pt-BR')}.`;
  }

  private async answerIncomeOrigins(
    userId: string,
    period: FinancialPeriod,
    scope?: FinancialScope,
  ): Promise<string> {
    const origins = await this.incomeOrigins(userId, period.start, period.end, scope);
    return origins.length
      ? this.formatDistribution(`Receitas por origem ${this.periodOf(period.label)}`, origins)
      : `📭 Você ainda não tem receitas registradas ${this.periodAt(period.label).toLocaleLowerCase('pt-BR')}.`;
  }

  private async answerScopeComparison(
    userId: string,
    period: FinancialPeriod,
  ): Promise<string> {
    const [personal, business] = await Promise.all([
      this.monthTotals(userId, period.start, period.end, FinancialScope.PERSONAL),
      this.monthTotals(userId, period.start, period.end, FinancialScope.BUSINESS),
    ]);
    return [
      `📊 *Pessoal x Negócio ${this.periodOf(period.label)}*`,
      '',
      `👤 Pessoal — receitas ${this.formatMoney(personal.income)}, gastos ${this.formatMoney(personal.expense)}, saldo ${this.formatMoney(personal.balance)}.`,
      `🏪 Negócio — receitas ${this.formatMoney(business.income)}, gastos ${this.formatMoney(business.expense)}, saldo ${this.formatMoney(business.balance)}.`,
      '',
      personal.balance === business.balance
        ? '⚖️ Os dois modos tiveram o mesmo resultado.'
        : `🏁 ${personal.balance > business.balance ? 'Pessoal' : 'Negócio'} teve o melhor resultado, com diferença de ${this.formatMoney(Math.abs(personal.balance - business.balance))}.`,
    ].join('\n');
  }

  private async answerLargestExpenseIncreases(
    userId: string,
    scope?: FinancialScope,
  ): Promise<string> {
    const increases = await this.largestExpenseIncreases(userId, scope);
    if (!increases.length) {
      return '✅ Nenhuma categoria de gasto aumentou em relação ao mês anterior.';
    }
    return [
      '⚠️ *Maiores aumentos de gastos neste mês*',
      ...increases.slice(0, 5).map(
        (item, index) =>
          `${index + 1}. ${item.name}: +${this.formatMoney(item.increase)} (${this.formatMoney(item.previous)} → ${this.formatMoney(item.current)})`,
      ),
    ].join('\n');
  }

  private async trySetCategoryBudget(userId: string, message: string): Promise<string | null> {
    const normalized = this.normalizeText(message);
    const match = normalized.match(
      /\b(?:defina|definir|coloque|estabeleca|estabelecer|limite|orcamento)\b.*?(?:r\$)?\s*(\d+(?:[.,]\d{1,2})?)\s*(?:reais?)?\s*(?:para|em|na|no)\s+(.+)$/,
    );
    if (!match) return null;

    const amount = this.parseBrazilianAmount(match[1]!);
    if (amount <= 0) return '💵 Informe um valor de orçamento maior que zero.';

    const scope = this.inferExplicitScope(message) ?? FinancialScope.PERSONAL;
    const categoryText = match[2]!
      .replace(/\b(pessoal|negocio|empresa|empresarial)\b/g, '')
      .replace(/[.!?]+$/g, '')
      .trim();
    if (!categoryText) {
      return '🏷️ Para qual categoria devo definir esse orçamento?';
    }

    const category = await this.resolveCategory(userId, categoryText, TransactionType.EXPENSE);
    const month = this.currentMonthRange().start;
    await this.prisma.categoryBudget.upsert({
      where: {
        userId_categoryId_scope_month: {
          userId,
          categoryId: category.id,
          scope,
          month,
        },
      },
      create: { userId, categoryId: category.id, scope, month, amount },
      update: { amount, alertLevel: 0, lastAlertAt: null },
    });
    const spent = await this.categoryExpenseTotal(userId, category.id, scope, month);
    const percentage = amount > 0 ? Math.round((spent / amount) * 100) : 0;
    return [
      '✅ *Orçamento definido*',
      '',
      `🏷️ *Categoria: ${category.name}*`,
      `💵 *Limite mensal: ${this.formatMoney(amount)}*`,
      `👤 *Modo: ${scope === FinancialScope.BUSINESS ? 'Negócio' : 'Pessoal'}*`,
      `📊 *Já utilizado: ${this.formatMoney(spent)} (${percentage}%)*`,
    ].join('\n');
  }

  private async categoryBudgetAlert(
    userId: string,
    categoryId: string,
    categoryName: string,
    scope: FinancialScope,
  ): Promise<string | null> {
    const month = this.currentMonthRange().start;
    const budget = await this.prisma.categoryBudget.findUnique({
      where: {
        userId_categoryId_scope_month: { userId, categoryId, scope, month },
      },
    });
    if (!budget) return null;
    const limit = Number(budget.amount);
    const spent = await this.categoryExpenseTotal(userId, categoryId, scope, month);
    const percentage = limit > 0 ? Math.round((spent / limit) * 100) : 0;
    if (percentage < 80) return null;
    const targetLevel = percentage >= 100 ? 100 : 80;
    if (Number(budget.alertLevel || 0) < targetLevel) {
      await this.prisma.categoryBudget.update({
        where: { id: budget.id },
        data: { alertLevel: targetLevel, lastAlertAt: new Date() },
      });
    }
    if (spent > limit) {
      return `🚨 Orçamento excedido em ${categoryName}: ${this.formatMoney(spent)} de ${this.formatMoney(limit)} (${percentage}%). Excesso de ${this.formatMoney(spent - limit)}.`;
    }
    if (spent === limit) {
      return `🚨 Orçamento atingiu o limite em ${categoryName}: ${this.formatMoney(spent)} de ${this.formatMoney(limit)} (100%).`;
    }
    return `⚠️ Orçamento próximo do limite em ${categoryName}: ${this.formatMoney(spent)} de ${this.formatMoney(limit)} (${percentage}%).`;
  }

  private proactiveBudgetAlertMessage(input: {
    categoryName: string;
    scope: FinancialScope;
    limit: number;
    spent: number;
    percentage: number;
  }): string {
    const mode = input.scope === FinancialScope.BUSINESS ? 'Negócio' : 'Pessoal';
    if (input.spent > input.limit) {
      return [
        `🚨 Orçamento excedido em ${input.categoryName}`,
        `Você usou ${this.formatMoney(input.spent)} de ${this.formatMoney(input.limit)} (${input.percentage}%).`,
        `Excesso: ${this.formatMoney(input.spent - input.limit)}.`,
        `Modo: ${mode}.`,
      ].join('\n');
    }
    if (input.spent === input.limit) {
      return [
        `🚨 Orçamento atingiu o limite em ${input.categoryName}`,
        `Você usou ${this.formatMoney(input.spent)} de ${this.formatMoney(input.limit)} (100%).`,
        `Modo: ${mode}.`,
      ].join('\n');
    }
    return [
      `⚠️ Orçamento próximo do limite em ${input.categoryName}`,
      `Você usou ${this.formatMoney(input.spent)} de ${this.formatMoney(input.limit)} (${input.percentage}%).`,
      `Restam ${this.formatMoney(input.limit - input.spent)} neste mês.`,
      `Modo: ${mode}.`,
    ].join('\n');
  }

  private normalizeRecipientPhone(phone: string): string {
    const normalized = phone.replace(/\D/g, '');
    return normalized.startsWith('55') ? normalized : `55${normalized}`;
  }

  private async categoryExpenseTotal(
    userId: string,
    categoryId: string,
    scope: FinancialScope,
    monthStart: Date,
  ): Promise<number> {
    const monthEnd = new Date(
      Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 1),
    );
    const result = await this.prisma.transaction.aggregate({
      where: {
        userId,
        categoryId,
        scope,
        type: TransactionType.EXPENSE,
        date: { gte: monthStart, lt: monthEnd },
      },
      _sum: { netAmount: true },
    });
    return Number(result._sum.netAmount ?? 0);
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
    const displayHint = this.formatCategoryName(hint, type as TransactionType);
    const existing = await this.prisma.category.findFirst({
      where: {
        userId,
        OR: [
          { name: { equals: hint, mode: 'insensitive' } },
          { name: { equals: displayHint, mode: 'insensitive' } },
        ],
      },
    });
    if (existing) return existing;
    const categories = await this.prisma.category.findMany({
      where: { userId },
      select: { id: true, name: true, color: true },
    });
    const normalizedMatch = categories.find(
      (category) => this.normalizeText(category.name) === normalizedHint,
    );
    if (normalizedMatch) return normalizedMatch;

    const similarMatch = this.findSimilarCategory(categories, hint);
    if (similarMatch) return similarMatch;

    const fallbackName = this.formatCategoryName(
      type === 'EXPENSE' && normalizedHint.includes('mercado') ? 'Alimentação' : hint,
      type as TransactionType,
    );
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

  private async expenseCategories(
    userId: string,
    start: Date,
    end: Date,
    scope?: FinancialScope,
  ) {
    return this.categoryDistribution(userId, TransactionType.EXPENSE, start, end, scope);
  }

  private async incomeOrigins(
    userId: string,
    start: Date,
    end: Date,
    scope?: FinancialScope,
  ) {
    return this.categoryDistribution(userId, TransactionType.INCOME, start, end, scope);
  }

  private async categoryDistribution(
    userId: string,
    type: TransactionType,
    start: Date,
    end: Date,
    scope?: FinancialScope,
  ) {
    const groups = await this.prisma.transaction.groupBy({
      by: ['categoryId'],
      where: { userId, type, date: { gte: start, lt: end }, ...(scope ? { scope } : {}) },
      _sum: { netAmount: true },
      orderBy: { _sum: { netAmount: 'desc' } },
    });
    if (!groups.length) return [];
    const categories = await this.prisma.category.findMany({
      where: { userId, id: { in: groups.map((item) => item.categoryId) } },
      select: { id: true, name: true },
    });
    const namesById = new Map(categories.map((item) => [item.id, item.name]));
    return groups.map((item) => ({
      name: namesById.get(item.categoryId) ?? 'Sem categoria',
      total: Number(item._sum.netAmount ?? 0),
    }));
  }

  private async largestExpenseIncreases(userId: string, scope?: FinancialScope) {
    const current = this.currentMonthRange();
    const previous = this.previousMonthRange();
    const [currentGroups, previousGroups] = await Promise.all([
      this.prisma.transaction.groupBy({
        by: ['categoryId'],
        where: {
          userId,
          type: TransactionType.EXPENSE,
          date: { gte: current.start, lt: current.end },
          ...(scope ? { scope } : {}),
        },
        _sum: { netAmount: true },
      }),
      this.prisma.transaction.groupBy({
        by: ['categoryId'],
        where: {
          userId,
          type: TransactionType.EXPENSE,
          date: { gte: previous.start, lt: previous.end },
          ...(scope ? { scope } : {}),
        },
        _sum: { netAmount: true },
      }),
    ]);
    const previousByCategory = new Map(
      previousGroups.map((item) => [item.categoryId, Number(item._sum.netAmount ?? 0)]),
    );
    const increases = currentGroups
      .map((item) => {
        const currentTotal = Number(item._sum.netAmount ?? 0);
        const previousTotal = previousByCategory.get(item.categoryId) ?? 0;
        return {
          categoryId: item.categoryId,
          current: currentTotal,
          previous: previousTotal,
          increase: currentTotal - previousTotal,
        };
      })
      .filter((item) => item.increase > 0)
      .sort((a, b) => b.increase - a.increase);
    if (!increases.length) return [];
    const categories = await this.prisma.category.findMany({
      where: { userId, id: { in: increases.map((item) => item.categoryId) } },
      select: { id: true, name: true },
    });
    const namesById = new Map(categories.map((item) => [item.id, item.name]));
    return increases.map((item) => ({
      ...item,
      name: namesById.get(item.categoryId) ?? 'Sem categoria',
    }));
  }

  private formatDistribution(
    title: string,
    items: Array<{ name: string; total: number }>,
  ): string {
    const total = items.reduce((sum, item) => sum + item.total, 0);
    return [
      `📊 *${title}*`,
      ...items.map((item, index) => {
        const percentage = total > 0 ? Math.round((item.total / total) * 100) : 0;
        return `${index + 1}. *${item.name}: ${this.formatMoney(item.total)} (${percentage}%)*`;
      }),
      `💵 *Total: ${this.formatMoney(total)}*`,
    ].join('\n');
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
      '✅ *Lançamento registrado*',
      '',
      `${transaction.type === TransactionType.EXPENSE ? '💸' : '💰'} *${type}: ${transaction.description}*`,
      `💵 *Valor: ${this.formatMoney(Number(transaction.amount))}*`,
      `🏷️ *Categoria: ${categoryName}*`,
      channelName ? `🛒 *Canal: ${channelName}*` : '',
      paymentLabel
        ? `🏦 *${transaction.type === TransactionType.INCOME ? 'Recebido em' : 'Pagamento'}: ${paymentLabel}*`
        : '',
      `👤 *Modo: ${scope === 'BUSINESS' ? 'Negocio' : 'Pessoal'}*`,
    ]
      .filter(Boolean)
      .join('\n');
  }

  private async transactionPostSaveSummary(
    userId: string,
    transaction: Transaction,
    categoryId: string,
    categoryName: string,
    scope: FinancialScope,
    accountId?: string,
  ): Promise<string> {
    const lines: string[] = [];
    if (accountId) {
      const account = await this.prisma.financialAccount.findUnique({
        where: { id: accountId },
        select: { name: true, balance: true },
      });
      if (account) {
        lines.push(`💵 *Saldo agora em ${account.name}: ${this.formatMoney(Number(account.balance))}*`);
      }
    }

    if (transaction.type === TransactionType.EXPENSE && this.isDateInCurrentMonth(transaction.date)) {
      const month = this.currentMonthRange().start;
      const spent = await this.categoryExpenseTotal(userId, categoryId, scope, month);
      lines.push(`📊 *Você já gastou ${this.formatMoney(spent)} em ${categoryName} este mês.*`);

      const budget = await this.prisma.categoryBudget.findUnique({
        where: {
          userId_categoryId_scope_month: { userId, categoryId, scope, month },
        },
      });
      if (budget) {
        const limit = Number(budget.amount);
        const percentage = limit > 0 ? Math.round((spent / limit) * 100) : 0;
        lines.push(`🎯 *Isso representa ${percentage}% do seu limite de ${this.formatMoney(limit)}.*`);
      }
    }

    return lines.join('\n');
  }

  private transactionDraftConfirmation(draft: WhatsappTransactionDraft): string {
    const type = draft.type === TransactionType.EXPENSE ? 'Despesa' : 'Receita';
    const headline =
      draft.type === TransactionType.EXPENSE
        ? '🧾 *Despesa pronta para salvar*'
        : '🧾 *Receita pronta para salvar*';
    return [
      draft.possibleDuplicate ? '⚠️ Possível lançamento duplicado' : '',
      draft.possibleDuplicate
        ? `Já existe: ${draft.possibleDuplicate.description} — ${this.formatMoney(draft.possibleDuplicate.amount)} em ${this.formatDateTime(draft.possibleDuplicate.date)}.`
        : '',
      headline,
      '',
      `${draft.type === TransactionType.EXPENSE ? '💸' : '💰'} *Tipo: ${type}*`,
      `📝 *Título: ${draft.description}*`,
      draft.installmentCount && draft.totalAmount
        ? `💵 *Valor: ${this.formatMoney(draft.totalAmount)} em ${draft.installmentCount}x de ${this.formatMoney(draft.amount)}*`
        : `💵 *Valor: ${this.formatMoney(draft.amount)}*`,
      draft.transactionDate
        ? `📅 *Data: ${this.formatDateOnly(draft.transactionDate)}*`
        : '',
      `🏷️ *Categoria: ${draft.categoryHint}*`,
      draft.channelHint ? `🛒 *Canal: ${draft.channelHint}*` : '',
      draft.paymentLabel
        ? `🏦 *Pagamento: ${draft.paymentLabel}*`
        : '🏦 *Pagamento: não informado*',
      `👤 *Modo: ${draft.scope === FinancialScope.BUSINESS ? 'Negócio' : 'Pessoal'}*`,
      '',
      draft.possibleDuplicate
        ? '✅ Para criar mesmo assim, responda: Salvar novamente. Ou responda: Cancelar.'
        : '✅ Responda: Confirmar, Editar ou Cancelar. Você também pode pedir: "altere o valor", "mude o título", "troque o pagamento" ou "coloque como negócio".',
    ]
      .filter(Boolean)
      .join('\n');
  }

  private async handleTransactionConfirmation(
    userId: string,
    phone: string,
    message: string,
    draft: WhatsappTransactionDraft,
  ): Promise<string> {
    const command = this.normalizeText(message);
    const confirmsDuplicate = /^(salvar novamente|criar novamente)$/.test(command);

    if (/^(cancelar|cancela|nao|não)$/.test(command)) {
      await this.clearPendingMessage(userId);
      return '🗑️ Lançamento cancelado. Nenhuma informação foi salva.';
    }

    if (/^(editar|edita|corrigir|corrija)$/.test(command)) {
      await this.clearPendingMessage(userId);
      return '✏️ Certo. Envie novamente o lançamento com as informações corrigidas, incluindo valor e descrição.';
    }

    const draftEdit = this.parseDraftEdit(message);
    if (draftEdit) {
      if (draftEdit.kind === 'payment') {
        const paymentOptions = await this.findPaymentOptions(userId, draft.scope, draft.type);
        if (!paymentOptions.length) {
          return `${this.transactionDraftConfirmation(draft)}\n\n🏦 Você ainda não tem contas, carteiras ou cartões cadastrados para trocar o pagamento.`;
        }
        const selectedPayment = this.selectPaymentOption(
          draftEdit.query ?? message,
          paymentOptions,
        );
        if (selectedPayment) {
          const draftWithoutPayment = this.clearDraftPayment(draft);
          const updatedDraft: WhatsappTransactionDraft = {
            ...draftWithoutPayment,
            paymentLabel: selectedPayment.label,
            ...(selectedPayment.kind === 'ACCOUNT'
              ? { accountId: selectedPayment.id }
              : { creditCardId: selectedPayment.id }),
          };
          await this.setPendingTransactionDraft(userId, phone, updatedDraft);
          return `${this.transactionDraftConfirmation(updatedDraft)}\n\n🏦 Pagamento atualizado.`;
        }
        await this.setPendingPaymentDraft(userId, phone, {
          transaction: this.clearDraftPayment(draft),
          options: paymentOptions,
        });
        return `${this.paymentSelectionQuestion(draft.type, paymentOptions)}\n\n🏦 Escolha a nova forma de pagamento para esse lançamento.`;
      }

      if (draftEdit.kind === 'category') {
        await this.rememberCategoryPreference(userId, draft, draftEdit.category);
      }
      const updatedDraft = this.applyDraftEdit(draft, draftEdit);
      await this.setPendingTransactionDraft(userId, phone, updatedDraft);
      return `${this.transactionDraftConfirmation(updatedDraft)}\n\n✨ ${this.draftEditUpdatedMessage(draftEdit)}.`;
    }

    if (draft.possibleDuplicate && !confirmsDuplicate) {
      return `${this.transactionDraftConfirmation(draft)}\n\n⚠️ Para evitar duplicidade, preciso que você escreva “Salvar novamente”.`;
    }

    const confirmsTransaction = this.isConfirmationCommand(command) || confirmsDuplicate;
    if (!confirmsTransaction) {
      return `${this.transactionDraftConfirmation(draft)}\n\n🤔 Não reconheci sua escolha.`;
    }

    const category = await this.resolveCategory(userId, draft.categoryHint, draft.type);
    const channel =
      draft.scope === FinancialScope.BUSINESS
        ? await this.resolveChannel(userId, draft.channelHint)
        : undefined;
    const installmentCount = draft.installmentCount ?? 1;
    const firstDate = draft.transactionDate ? new Date(draft.transactionDate) : new Date();
    const transactions: Transaction[] = [];
    for (let index = 0; index < installmentCount; index += 1) {
      const installmentDate = this.addMonthsKeepingDay(firstDate, index);
      const installmentAmount =
        installmentCount > 1 &&
        draft.totalAmount &&
        index === installmentCount - 1
          ? Math.round(
              (draft.totalAmount - draft.amount * (installmentCount - 1)) * 100,
            ) / 100
          : draft.amount;
      const transaction = await this.transactionService.create(userId, {
        description:
          installmentCount > 1
            ? `${draft.description} (${index + 1}/${installmentCount})`
            : draft.description,
        amount: installmentAmount,
        type: draft.type,
        source: TransactionSource.WHATSAPP,
        scope: draft.scope,
        categoryId: category.id,
        ...(draft.transactionDate || installmentCount > 1
          ? { date: installmentDate.toISOString() }
          : {}),
        ...(channel ? { channelId: channel.id } : {}),
        ...(draft.accountId ? { accountId: draft.accountId } : {}),
        ...(draft.creditCardId ? { creditCardId: draft.creditCardId } : {}),
      });
      transactions.push(transaction);
    }
    await this.clearPendingMessage(userId);
    const confirmation = this.transactionConfirmation(
      transactions[0]!,
      category.name,
      channel?.name,
      draft.scope,
      draft.paymentLabel,
    );
    const installmentMessage =
      installmentCount > 1
        ? `\nParcelas: ${installmentCount}x, a partir de ${this.formatMoney(draft.amount)}, de ${this.formatDateOnly(firstDate.toISOString())} até ${this.formatDateOnly(this.addMonthsKeepingDay(firstDate, installmentCount - 1).toISOString())}.`
        : '';
    const budgetAlert =
      draft.type === TransactionType.EXPENSE &&
      this.isDateInCurrentMonth(firstDate)
        ? await this.categoryBudgetAlert(userId, category.id, category.name, draft.scope)
        : null;
    const postSummary = await this.transactionPostSaveSummary(
      userId,
      transactions[0]!,
      category.id,
      category.name,
      draft.scope,
      draft.accountId,
    );
    return [confirmation, postSummary ? `\n\n${postSummary}` : '', installmentMessage, budgetAlert ? `\n${budgetAlert}` : '']
      .filter(Boolean)
      .join('');
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

  private shouldAskCategoryConfirmation(draft: WhatsappTransactionDraft): boolean {
    return (
      draft.type === TransactionType.EXPENSE &&
      this.normalizeText(draft.categoryHint) === 'outros'
    );
  }

  private categorySuggestionOptions(categoryNames: string[]): string[] {
    const preferred = ['Cuidados pessoais', 'Casa', 'Outros'];
    const existing = categoryNames
      .map((name) => this.formatCategoryName(name, TransactionType.EXPENSE))
      .filter((name) => ['Itens de higiene', 'Casa', 'Outros'].includes(name));
    return [...new Set([...existing, ...preferred])].slice(0, 3);
  }

  private categorySelectionQuestion(
    draft: WhatsappTransactionDraft,
    options: string[],
  ): string {
    return [
      '🏷️ *Não tenho certeza da categoria desse gasto.*',
      '',
      `📝 *Título: ${draft.description}*`,
      `💵 *Valor: ${this.formatMoney(draft.amount)}*`,
      '',
      'Quer salvar em qual categoria?',
      ...options.map((option, index) => `${index + 1}. ${option}`),
      '',
      '✅ Responda com o número ou nome da categoria.',
    ].join('\n');
  }

  private selectCategoryOption(message: string, options: string[]): string | null {
    const normalized = this.normalizeText(message);
    const numericIndex = Number.parseInt(normalized, 10);
    if (Number.isInteger(numericIndex) && String(numericIndex) === normalized) {
      return options[numericIndex - 1] ?? null;
    }
    return (
      options.find((option) => {
        const normalizedOption = this.normalizeText(option);
        return normalizedOption === normalized || normalized.includes(normalizedOption);
      }) ?? null
    );
  }

  private async handleCategorySelection(
    userId: string,
    phone: string,
    message: string,
    draft: WhatsappCategoryDraft,
  ): Promise<string> {
    const normalized = this.normalizeText(message);
    if (/^(cancelar|cancela|nao|não)$/.test(normalized)) {
      await this.clearPendingMessage(userId);
      return '🗑️ Lançamento cancelado. Nenhuma informação foi salva.';
    }
    if (this.isMenuCommand(message)) {
      await this.clearPendingMessage(userId);
      return this.helpReply();
    }

    const paymentOptions = await this.findPaymentOptions(
      userId,
      draft.transaction.scope,
      draft.transaction.type,
    );
    if (this.isPaymentPhrase(message) && paymentOptions.length) {
      const selectedPayment = this.selectPaymentOption(message, paymentOptions);
      if (selectedPayment) {
        const transaction = {
          ...this.clearDraftPayment(draft.transaction),
          paymentLabel: selectedPayment.label,
          ...(selectedPayment.kind === 'ACCOUNT'
            ? { accountId: selectedPayment.id }
            : { creditCardId: selectedPayment.id }),
        };
        const updatedDraft = { ...draft, transaction };
        await this.setPendingCategoryDraft(userId, phone, updatedDraft);
        return `${this.categorySelectionQuestion(transaction, draft.options)}\n\n🏦 Pagamento anotado: ${selectedPayment.label}.`;
      }
    }

    const selectedCategory = this.selectCategoryOption(message, draft.options);
    if (!selectedCategory) {
      return `${this.categorySelectionQuestion(draft.transaction, draft.options)}\n\n🤔 Não reconheci essa categoria.`;
    }

    const transaction = {
      ...draft.transaction,
      categoryHint: this.formatCategoryName(selectedCategory, draft.transaction.type),
    };
    await this.rememberCategoryPreference(userId, draft.transaction, selectedCategory);

    if (paymentOptions.length && !transaction.paymentLabel) {
      await this.setPendingPaymentDraft(userId, phone, {
        transaction,
        options: paymentOptions,
      });
      return `${this.paymentSelectionQuestion(transaction.type, paymentOptions)}\n\n🏷️ Categoria escolhida: ${transaction.categoryHint}.`;
    }

    await this.setPendingTransactionDraft(userId, phone, transaction);
    return this.transactionDraftConfirmation(transaction);
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
        ? '🏦 *Em qual conta você recebeu esse dinheiro?*'
        : '🏦 *Como você pagou esse gasto?*',
      '',
      ...options.map((option, index) => `${index + 1}. ${option.label}`),
      '',
      '✅ *Responda com o número ou nome da opção.*',
    ].join('\n');
  }

  private async handlePaymentSelection(
    userId: string,
    phone: string,
    message: string,
    draft: WhatsappPaymentDraft,
  ): Promise<string> {
    const normalized = this.normalizeText(message);
    if (draft.createPayment?.waitingForName) {
      if (/^(cancelar|cancela|nao|não)$/.test(normalized)) {
        await this.clearPendingMessage(userId);
        return '🗑️ Lançamento cancelado. Nenhuma informação foi salva.';
      }

      const name = this.extractAccountName(message, draft.createPayment.type) ?? message.trim();
      if (!name || this.isGenericPaymentName(name, draft.createPayment.type)) {
        return this.newPaymentNameQuestion(draft.createPayment.type);
      }

      const createdPayment = await this.createPaymentOptionFromAccount(
        userId,
        name,
        draft.createPayment.type,
        draft.transaction.scope,
      );
      const transaction: WhatsappTransactionDraft = {
        ...draft.transaction,
        paymentLabel: createdPayment.label,
        accountId: createdPayment.id,
      };
      await this.setPendingTransactionDraft(userId, phone, transaction);
      return this.transactionDraftConfirmation(transaction);
    }
    if (/^(cancelar|cancela|nao|não)$/.test(normalized)) {
      await this.clearPendingMessage(userId);
      return '🗑️ Lançamento cancelado. Nenhuma informação foi salva.';
    }

    if (this.isGreeting(message)) {
      return this.pendingPaymentReminder(draft);
    }

    if (this.isKnownFinancialQuestion(message)) {
      const answer = await this.answerQuestion(userId, message);
      return `${answer}\n\n🏦 Você ainda tem um lançamento aguardando forma de pagamento. Responda com o número/nome da opção ou envie “Cancelar”.`;
    }

    if (this.isTransactionWithoutAmount(message)) {
      await this.clearPendingMessage(userId);
      await this.setPendingMessage(
        userId,
        phone,
        message,
        'TRANSACTION_DETAILS',
        'WAITING_AMOUNT',
      );
      return `${this.missingAmountQuestion(message)}\n\n🧾 Comecei um novo lançamento e descartei o anterior que estava pendente.`;
    }

    if (this.needsMoreDescription(message)) {
      await this.clearPendingMessage(userId);
      await this.setPendingMessage(
        userId,
        phone,
        message,
        'TRANSACTION_DETAILS',
        'WAITING_DESCRIPTION',
      );
      return `${this.missingDescriptionQuestion(message)}\n\n🧾 Comecei um novo lançamento e descartei o anterior que estava pendente.`;
    }

    if (this.looksLikeTransaction(message)) {
      await this.clearPendingMessage(userId);
      return this.createTransactionFromMessage(userId, phone, message);
    }

    let selected = this.selectPaymentOption(message, draft.options);

    if (!selected) {
      const requestedPaymentType = this.requestedPaymentAccountType(message);
      const paymentName = requestedPaymentType
        ? this.extractAccountName(message, requestedPaymentType)
        : null;

      if (requestedPaymentType && !paymentName) {
        await this.setPendingPaymentDraft(userId, phone, {
          ...draft,
          createPayment: {
            type: requestedPaymentType,
            waitingForName: true,
          },
        });
        return this.newPaymentNameQuestion(requestedPaymentType);
      }

      const createdPayment = await this.tryCreatePaymentAccount(
        userId,
        message,
        draft.transaction.scope,
      );
      if (createdPayment) {
        selected = createdPayment;
      }
    }

    if (!selected) {
      return `${this.paymentSelectionQuestion(draft.transaction.type, draft.options)}\n\n🤔 Não reconheci essa opção. Você pode responder com o número/nome da opção, criar uma nova carteira ou enviar “Cancelar”.`;
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

  private pendingPaymentReminder(draft: WhatsappPaymentDraft): string {
    return [
      '🧾 *Tenho um lançamento em andamento aguardando a forma de pagamento.*',
      this.paymentSelectionQuestion(draft.transaction.type, draft.options),
      '🗑️ Se quiser abandonar esse lançamento, envie “Cancelar”. Para ver opções do Din, envie “Menu”.',
    ].join('\n\n');
  }

  private selectPaymentOption(
    message: string,
    options: WhatsappPaymentOption[],
  ): WhatsappPaymentOption | undefined {
    const normalized = this.normalizeText(message);
    const numericIndex = Number.parseInt(normalized, 10);
    const selected =
      Number.isInteger(numericIndex) && String(numericIndex) === normalized
        ? options[numericIndex - 1]
        : options.find((option) => {
            const name = this.normalizeText(option.name);
            const label = this.normalizeText(option.label);
            return name === normalized || label.includes(normalized) || normalized.includes(name);
          });
    if (selected) return selected;

    if (normalized.includes('pix') || normalized.includes('banco') || normalized.includes('nubank')) {
      const bankAccounts = options.filter(
        (option) => option.kind === 'ACCOUNT' && option.accountType === 'BANK',
      );
      if (bankAccounts.length === 1) return bankAccounts[0];
    }

    if (normalized.includes('carteira') || normalized.includes('dinheiro')) {
      const wallets = options.filter(
        (option) => option.kind === 'ACCOUNT' && option.accountType === 'WALLET',
      );
      if (wallets.length === 1) return wallets[0];
    }

    if (/\b(cartao|cartao de credito|crédito|credito)\b/.test(normalized)) {
      const cards = options.filter((option) => option.kind === 'CARD');
      if (cards.length === 1) return cards[0];
    }

    return undefined;
  }

  private isPaymentPhrase(message: string): boolean {
    const normalized = this.normalizeText(message);
    return (
      /\b(paguei|pagamento|usei|foi|debito|credito|cartao|pix|dinheiro|carteira|banco|conta)\b/.test(
        normalized,
      ) &&
      /\b(no|na|pelo|pela|com|em|pix|dinheiro|credito|debito|cartao|carteira|banco|conta)\b/.test(
        normalized,
      )
    );
  }

  private async tryCreateFinancialAccount(userId: string, message: string): Promise<string | null> {
    const normalized = this.normalizeText(message);
    const isCreateIntent = /\b(criar|crie|nova|novo|cadastrar|cadastre|adicionar|adicione)\b/.test(
      normalized,
    );
    const mentionsAccount = /\b(carteira|banco|conta)\b/.test(normalized);
    if (!isCreateIntent || !mentionsAccount) {
      return null;
    }

    const scope = this.inferExplicitScope(message) ?? FinancialScope.PERSONAL;
    const type =
      /\b(banco|conta)\b/.test(normalized) && !normalized.includes('carteira')
        ? FinancialAccountType.BANK
        : FinancialAccountType.WALLET;
    const name = this.extractAccountName(message, type);

    if (!name) {
      return type === FinancialAccountType.BANK
        ? 'Qual nome você quer dar para esse banco ou conta? Ex: Nubank, Inter ou Conta principal.'
        : 'Qual nome você quer dar para essa carteira? Ex: Dinheiro, Caixa ou Carteira pessoal.';
    }

    const account = await this.createFinancialAccount(userId, name, type, scope);
    return [
      type === FinancialAccountType.BANK ? 'Conta criada.' : 'Carteira criada.',
      `${type === FinancialAccountType.BANK ? 'Banco/conta' : 'Carteira'}: ${account.name}`,
      `Modo: ${account.scope === FinancialScope.BUSINESS ? 'Negócio' : 'Pessoal'}`,
      'Saldo inicial: R$ 0,00',
    ].join('\n');
  }

  private async tryCreatePaymentAccount(
    userId: string,
    message: string,
    scope: FinancialScope,
  ): Promise<WhatsappPaymentOption | null> {
    const type = this.requestedPaymentAccountType(message);
    if (!type) {
      return null;
    }

    const name = this.extractAccountName(message, type);
    if (!name) {
      return null;
    }

    return this.createPaymentOptionFromAccount(userId, name, type, scope);
  }

  private async createPaymentOptionFromAccount(
    userId: string,
    name: string,
    type: FinancialAccountType,
    scope: FinancialScope,
  ): Promise<WhatsappPaymentOption> {
    const account = await this.createFinancialAccount(userId, name, type, scope);
    return {
      accountType: account.type,
      id: account.id,
      kind: 'ACCOUNT',
      label: `${account.type === FinancialAccountType.BANK ? 'Banco/Pix' : 'Carteira'} - ${account.name}`,
      name: account.name,
    };
  }

  private requestedPaymentAccountType(message: string): FinancialAccountType | null {
    const normalized = this.normalizeText(message);
    const wantsBank = /\b(banco|conta|pix)\b/.test(normalized);
    if (wantsBank && !normalized.includes('carteira')) {
      return FinancialAccountType.BANK;
    }

    const wantsWallet =
      /\b(carteira|dinheiro|caixa)\b/.test(normalized) ||
      /\b(outra|outro|nova|novo|criar|crie|cadastrar|cadastre|adicionar|adicione|nenhuma|nenhum)\b/.test(
        normalized,
      );
    return wantsWallet ? FinancialAccountType.WALLET : null;
  }

  private newPaymentNameQuestion(type: FinancialAccountType): string {
    return type === FinancialAccountType.BANK
      ? 'Qual banco, conta ou forma Pix você quer usar? Ex: Nubank, Inter ou Conta principal.'
      : 'Qual é o nome dessa forma de pagamento? Ex: Dinheiro, Caixa, Carteira pessoal ou outra carteira.';
  }

  private async createFinancialAccount(
    userId: string,
    name: string,
    type: FinancialAccountType,
    scope: FinancialScope,
  ): Promise<{ id: string; name: string; type: FinancialAccountType; scope: FinancialScope }> {
    return this.prisma.financialAccount.create({
      data: {
        balance: 0,
        name: this.titleCase(name).slice(0, 60),
        scope,
        type,
        userId,
      },
      select: { id: true, name: true, scope: true, type: true },
    });
  }

  private extractAccountName(message: string, type: FinancialAccountType): string | null {
    const raw = message
      .replace(/\b(criar|crie|nova|novo|cadastrar|cadastre|adicionar|adicione|uma|um|minha|meu|foi|usar|use|nenhuma|nenhum|delas|deles)\b/gi, ' ')
      .replace(/\b(carteira|banco|conta|forma|pagamento|opcao|opção|para|pelo|pela|com|no|na|de|do|da)\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (!raw) {
      return null;
    }

    const normalized = this.normalizeText(raw);
    const generic =
      type === FinancialAccountType.BANK
        ? ['banco', 'conta', 'pix']
        : ['carteira', 'outra carteira', 'outra', 'outro'];
    if (generic.includes(normalized) || this.isGenericPaymentName(raw, type)) {
      return null;
    }

    return raw;
  }

  private isGenericPaymentName(name: string, type: FinancialAccountType): boolean {
    const normalized = this.normalizeText(name);
    const generic =
      type === FinancialAccountType.BANK
        ? ['banco', 'conta', 'pix', 'outra conta', 'outro banco']
        : [
            'carteira',
            'outra carteira',
            'outra',
            'outro',
            'outra forma',
            'outra forma de pagamento',
            'nenhuma',
            'nenhuma delas',
          ];
    return generic.includes(normalized);
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
          ? '🔎 Não encontrei nenhum gasto para corrigir.'
          : '🔎 Não encontrei nenhum lançamento para corrigir.';
      }

      const newAmount = Number(updateMatch[5]!.replace(',', '.'));
      if (!Number.isFinite(newAmount) || newAmount <= 0) {
        return '💵 Informe um valor válido para a correção.';
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
      return '🔎 Qual lançamento você quer apagar? Informe parte do título ou da categoria.';
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
        '✏️ *Confirme a correção*',
        '',
        `${draft.type === TransactionType.EXPENSE ? '💸' : '💰'} *${type}: ${draft.description}*`,
        `💵 *Valor atual: ${this.formatMoney(draft.previousAmount)}*`,
        `✅ *Novo valor: ${this.formatMoney(draft.newAmount)}*`,
        '',
        '✅ *Responda:* Confirmar ou Cancelar.',
      ].join('\n');
    }
    return [
      '🗑️ *Confirme a exclusão*',
      '',
      `${draft.type === TransactionType.EXPENSE ? '💸' : '💰'} *${type}: ${draft.description}*`,
      `💵 *Valor: ${this.formatMoney(draft.amount)}*`,
      '',
      '⚠️ Essa ação não poderá ser desfeita.',
      '✅ *Responda:* Confirmar ou Cancelar.',
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
        ? '✅ Exclusão cancelada. O lançamento foi mantido.'
        : '✅ Correção cancelada. O lançamento não foi alterado.';
    }
    if (!this.isConfirmationCommand(command)) {
      return `${this.mutationDraftConfirmation(draft)}\n\n🤔 Não reconheci sua escolha.`;
    }

    if (draft.action === 'UPDATE_AMOUNT') {
      await this.transactionService.update(userId, draft.transactionId, {
        amount: draft.newAmount,
      });
      await this.clearPendingMessage(userId);
      return [
        '✅ *Lançamento corrigido*',
        `${draft.type === TransactionType.EXPENSE ? '💸 *Despesa:' : '💰 *Receita:'} ${draft.description}*`,
        `💵 *Novo valor: ${this.formatMoney(draft.newAmount)}*`,
      ].join('\n');
    }

    await this.transactionService.delete(userId, draft.transactionId);
    await this.clearPendingMessage(userId);
    return [
      '✅ *Lançamento excluído*',
      `${draft.type === TransactionType.EXPENSE ? '💸 *Despesa:' : '💰 *Receita:'} ${draft.description}*`,
      `💵 *Valor: ${this.formatMoney(draft.amount)}*`,
    ].join('\n');
  }

  private async getConversation(userId: string, phone: string) {
    return this.conversationStore.get(userId, phone);
  }

  private async setPendingMessage(
    userId: string,
    phone: string,
    pendingText: string,
    pendingType = 'DETAILS',
    pendingStep = 'WAITING_INPUT',
    pendingData: Prisma.InputJsonValue = { text: pendingText },
  ): Promise<void> {
    await this.conversationStore.setPending({
      userId,
      phone,
      pendingText,
      pendingType,
      pendingStep,
      pendingData,
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
      'TRANSACTION',
      'WAITING_CONFIRMATION',
      draft as unknown as Prisma.InputJsonValue,
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
      'MUTATION',
      'WAITING_CONFIRMATION',
      draft as unknown as Prisma.InputJsonValue,
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
      'PAYMENT',
      'WAITING_SELECTION',
      draft as unknown as Prisma.InputJsonValue,
    );
  }

  private async setPendingCategoryDraft(
    userId: string,
    phone: string,
    draft: WhatsappCategoryDraft,
  ): Promise<void> {
    await this.setPendingMessage(
      userId,
      phone,
      `${CATEGORY_SELECTION_PREFIX}${JSON.stringify(draft)}`,
      'CATEGORY',
      'WAITING_SELECTION',
      draft as unknown as Prisma.InputJsonValue,
    );
  }

  private async clearPendingMessage(userId: string): Promise<void> {
    await this.conversationStore.clearPending(userId);
  }

  private conversationPendingValue(conversation: WhatsappConversationState): string | null {
    const data = conversation.pendingData;
    if (conversation.pendingType && data && typeof data === 'object') {
      const serialized = JSON.stringify(data);
      if (conversation.pendingType === 'TRANSACTION') {
        return `${TRANSACTION_CONFIRMATION_PREFIX}${serialized}`;
      }
      if (conversation.pendingType === 'MUTATION') {
        return `${TRANSACTION_MUTATION_PREFIX}${serialized}`;
      }
      if (conversation.pendingType === 'PAYMENT') {
        return `${PAYMENT_SELECTION_PREFIX}${serialized}`;
      }
      if (conversation.pendingType === 'CATEGORY') {
        return `${CATEGORY_SELECTION_PREFIX}${serialized}`;
      }
    }
    return conversation.pendingText ?? null;
  }

  private pendingDetailsText(conversation: WhatsappConversationState): string | null {
    if (
      conversation.pendingType === 'DETAILS' ||
      conversation.pendingType === 'TRANSACTION_DETAILS'
    ) {
      const data = conversation.pendingData;
      if (
        data &&
        typeof data === 'object' &&
        'text' in data &&
        typeof data.text === 'string'
      ) {
        return data.text;
      }
    }
    const pendingText = conversation.pendingText;
    return pendingText &&
      !pendingText.startsWith(TRANSACTION_CONFIRMATION_PREFIX) &&
      !pendingText.startsWith(TRANSACTION_MUTATION_PREFIX) &&
      !pendingText.startsWith(PAYMENT_SELECTION_PREFIX) &&
      !pendingText.startsWith(CATEGORY_SELECTION_PREFIX)
      ? pendingText
      : null;
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

  private parseCategoryDraft(value: string | null | undefined): WhatsappCategoryDraft | null {
    if (!value?.startsWith(CATEGORY_SELECTION_PREFIX)) {
      return null;
    }
    try {
      const draft = JSON.parse(
        value.slice(CATEGORY_SELECTION_PREFIX.length),
      ) as Partial<WhatsappCategoryDraft>;
      if (
        !draft.transaction ||
        !Array.isArray(draft.options) ||
        !draft.options.length ||
        typeof draft.transaction.description !== 'string' ||
        typeof draft.transaction.amount !== 'number'
      ) {
        return null;
      }
      return draft as WhatsappCategoryDraft;
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
    await this.conversationStore.append({
      userId,
      phone,
      current,
      userMessage,
      assistantMessage,
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
      '👋 *Posso ajudar você a:*',
      '🧾 registrar receitas, gastos e vendas;',
      '📊 consultar saldo, gastos e receitas;',
      '📅 consultar semanas, meses específicos e comparar períodos;',
      '🔎 comparar meses e identificar maiores despesas;',
      '✏️ corrigir e excluir lançamentos com confirmação;',
      '🏪 analisar suas finanças pessoais ou do negócio.',
      '',
      '💬 Exemplos: “Gastos da semana”, “Despesas de maio”, “Compare este mês com o anterior” ou “Gastei R$ 40 no mercado”.',
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

  private async extractMessageOrTranscribeAudio(
    payload: WhatsappWebhookDto,
    phone: string,
  ): Promise<string | null> {
    const message = this.extractMessage(payload);
    if (message) return message;

    const audio = this.extractAudioInput(payload);
    if (!audio) return this.hasAudioOrMediaSignal(payload) ? MEDIA_WITHOUT_DOWNLOADABLE_AUDIO : '';

    try {
      const audioBase64 = audio.base64 ?? (await this.downloadAudioBase64(audio.url));
      if (!audioBase64) return MEDIA_WITHOUT_DOWNLOADABLE_AUDIO;
      return await this.geminiService.transcribeAudioBase64(audioBase64, audio.mimeType);
    } catch {
      const reply = this.audioTranscriptionFailedReply();
      await this.safeReply(phone, reply);
      return null;
    }
  }

  private audioTranscriptionFailedReply(): string {
    return '🎙️ *Não consegui entender esse áudio agora.*\n\nPode tentar enviar novamente ou escrever a mensagem em texto?';
  }

  private audioWithoutDownloadableFileReply(): string {
    return [
      '🎙️ *Recebi seu áudio, mas ainda não consegui acessar o arquivo para transcrever.*',
      '',
      'A API do WhatsApp precisa enviar o áudio como *base64* ou uma *URL baixável* no webhook.',
      'Enquanto ajustamos isso, pode escrever a mensagem em texto?',
    ].join('\n');
  }

  private extractAudioInput(payload: WhatsappWebhookDto): WhatsappAudioInput | null {
    const data = this.asRecord(payload.data);
    const messageRecord = this.asRecord(payload.message);
    const nestedMessage = this.asRecord(data?.message);
    const audioRecord =
      this.asRecord(payload.audio) ??
      this.asRecord(payload.voice) ??
      this.asRecord(payload.media) ??
      this.asRecord(messageRecord?.audio) ??
      this.asRecord(messageRecord?.voice) ??
      this.asRecord(messageRecord?.media) ??
      this.asRecord(messageRecord?.audioMessage) ??
      this.asRecord(messageRecord?.voiceMessage) ??
      this.asRecord(data?.audio) ??
      this.asRecord(data?.voice) ??
      this.asRecord(data?.media) ??
      this.asRecord(nestedMessage?.audio) ??
      this.asRecord(nestedMessage?.voice) ??
      this.asRecord(nestedMessage?.media) ??
      this.asRecord(nestedMessage?.audioMessage) ??
      this.asRecord(nestedMessage?.voiceMessage);

    const directAudio = this.stringValue(
      payload.audio ?? payload.voice ?? messageRecord?.audio ?? messageRecord?.voice ?? data?.audio ?? data?.voice,
    );
    const directMedia = this.stringValue(payload.media ?? messageRecord?.media ?? data?.media);
    const directValue = directAudio || directMedia;
    const base64 = this.cleanAudioBase64(
      this.stringValue(
        audioRecord?.base64 ?? audioRecord?.data ?? audioRecord?.body ?? audioRecord?.buffer ?? audioRecord?.file,
      ) ??
        (directValue && !this.isHttpUrl(directValue) ? directValue : null),
    );
    const url =
      this.stringValue(
        payload.mediaUrl ??
          payload.url ??
          messageRecord?.mediaUrl ??
          messageRecord?.url ??
          data?.mediaUrl ??
          data?.url ??
          audioRecord?.mediaUrl ??
          audioRecord?.url ??
          audioRecord?.downloadUrl ??
          audioRecord?.fileUrl,
      ) ?? (directValue && this.isHttpUrl(directValue) ? directValue : undefined);
    const mimeType =
      this.stringValue(
        payload.mimeType ??
          payload.mimetype ??
          messageRecord?.mimeType ??
          messageRecord?.mimetype ??
          data?.mimeType ??
          data?.mimetype ??
          audioRecord?.mimeType ??
          audioRecord?.mimetype,
      ) ?? 'audio/ogg';

    if (!base64 && !url) return null;
    return { ...(base64 ? { base64 } : {}), ...(url ? { url } : {}), mimeType };
  }

  private hasAudioOrMediaSignal(payload: WhatsappWebhookDto): boolean {
    const values = [
      payload.type,
      payload.messageType,
      payload.audio,
      payload.voice,
      payload.media,
      payload.mediaUrl,
      payload.url,
      payload.message,
      payload.data,
    ];
    return values.some((value) => this.containsAudioOrMediaSignal(value, 0));
  }

  private containsAudioOrMediaSignal(value: unknown, depth: number): boolean {
    if (depth > 4 || value === null || value === undefined) return false;
    if (typeof value === 'string') {
      const normalized = this.normalizeText(value);
      return /\b(audio|voice|ptt|media|audio_message|audiomessage)\b/.test(normalized);
    }
    if (typeof value !== 'object') return false;

    return Object.entries(value as Record<string, unknown>).some(([key, child]) => {
      const normalizedKey = this.normalizeText(key);
      return (
        /\b(audio|voice|ptt|media|audio_message|audiomessage|mimetype|mime_type|mediakey|media_key)\b/.test(
          normalizedKey,
        ) || this.containsAudioOrMediaSignal(child, depth + 1)
      );
    });
  }

  private async downloadAudioBase64(url?: string): Promise<string | null> {
    if (!url || !this.isHttpUrl(url)) return null;

    const response = await fetch(url);
    if (!response.ok) return null;

    return Buffer.from(await response.arrayBuffer()).toString('base64');
  }

  private cleanAudioBase64(value?: string | null): string | null {
    if (!value) return null;
    return value.replace(/^data:audio\/[^;]+;base64,/i, '').trim() || null;
  }

  private stringValue(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  }

  private isHttpUrl(value: string): boolean {
    return /^https?:\/\//i.test(value.trim());
  }

  private asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
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
      this.isCompleteSummaryQuestion(lower) ||
      this.isCategoryExpenseQuestion(lower) ||
      this.isIncomeOriginQuestion(lower) ||
      this.isScopeComparisonQuestion(lower) ||
      this.isLargestIncreaseQuestion(lower) ||
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

  private isCompleteSummaryQuestion(message: string): boolean {
    const lower = this.normalizeText(message);
    return /\b(resumo|relatorio)\b.*\b(completo|detalhado|geral)\b/.test(lower);
  }

  private isCategoryExpenseQuestion(message: string): boolean {
    const lower = this.normalizeText(message);
    return (
      /\b(gastos|despesas)\b.*\b(categoria|categorias)\b/.test(lower) ||
      /\b(categoria|categorias)\b.*\b(gastos|despesas)\b/.test(lower)
    );
  }

  private isIncomeOriginQuestion(message: string): boolean {
    const lower = this.normalizeText(message);
    return (
      /\b(receitas|ganhos|entradas)\b.*\b(origem|fonte|categoria)\b/.test(lower) ||
      /\b(origem|fonte)\b.*\b(receitas|ganhos|entradas)\b/.test(lower)
    );
  }

  private isScopeComparisonQuestion(message: string): boolean {
    const lower = this.normalizeText(message);
    return (
      /\b(compare|comparar|comparacao|versus|x)\b/.test(lower) &&
      lower.includes('pessoal') &&
      lower.includes('negocio')
    );
  }

  private isLargestIncreaseQuestion(message: string): boolean {
    const lower = this.normalizeText(message);
    return (
      /\b(aumento|aumentos|cresceu|cresceram)\b/.test(lower) &&
      /\b(gasto|gastos|despesa|despesas|categoria|categorias|mes)\b/.test(lower)
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

  private isCancelCommand(message: string): boolean {
    return /^(cancelar|cancela)$/i.test(message.trim());
  }

  private isConfirmationCommand(command: string): boolean {
    return /^(confirmar|confirmo|sim|salvar|pode|pode salvar|pode fazer|ok|okay|blz|blza|beleza)$/.test(
      this.normalizeText(command),
    );
  }

  private isMenuCommand(message: string): boolean {
    return /^(menu|reiniciar|recomecar|recomeçar)$/i.test(message.trim());
  }

  private isGreeting(message: string): boolean {
    return /^(oi|ola|bom dia|boa tarde|boa noite|tudo bem)[!,. ]*$/.test(this.normalizeText(message));
  }

  private isAudioReferenceMessage(message: string): boolean {
    const lower = this.normalizeText(message);
    return (
      /\b(falei|disse|mandei|enviei|respondi)\b.*\b(audio|voz)\b/.test(lower) ||
      /\b(no audio|nesse audio|na mensagem de voz|por audio|em audio)\b/.test(lower)
    );
  }

  private audioAmountNotCapturedReply(pendingText: string): string {
    return [
      '🎙️ *Eu recebi seu áudio, mas não consegui captar o valor com segurança.*',
      '',
      `Estou registrando: *${this.compactPendingSummary(pendingText)}*`,
      '',
      'Me envie só o valor em número, por exemplo: *20* ou *R$ 20,00*.',
    ].join('\n');
  }

  private compactPendingSummary(text: string): string {
    return text.replace(/\s+/g, ' ').trim().slice(0, 120);
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
        ? '💸 Quanto você gastou hoje?'
        : '💸 Qual foi o valor desse gasto?';
    }
    if (lower.includes('vendi')) {
      return lower.includes('hoje')
        ? '💰 Quanto você recebeu com essa venda hoje?'
        : '💰 Qual foi o valor dessa venda?';
    }
    return lower.includes('hoje') || /\bhj\b/.test(lower)
      ? '💰 Quanto você ganhou hoje?'
      : '💰 Qual foi o valor que você recebeu?';
  }

  private missingDescriptionQuestion(message: string): string {
    const lower = this.normalizeText(message);
    if (lower.includes('vendi')) {
      return '🛒 O que você vendeu e por qual canal?';
    }
    if (/\b(recebi|ganhei|entrou)\b/.test(lower)) {
      return '💰 De onde veio esse dinheiro? Por exemplo: salário, venda, serviço ou transferência.';
    }
    return '📝 Com o que foi esse gasto? Por exemplo: mercado, restaurante, transporte ou conta.';
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

  private extractFollowUpDetailHint(message: string, type: TransactionType): string | null {
    if (type !== TransactionType.EXPENSE) {
      return null;
    }

    const parts = message
      .split(/[.!?]+/)
      .map((part) => part.trim())
      .filter(Boolean);
    if (parts.length < 2) {
      return null;
    }

    const detail = this.cleanFollowUpDetail(parts[parts.length - 1]!);
    return detail ? this.titleCase(detail).slice(0, 60) : null;
  }

  private cleanFollowUpDetail(value: string): string {
    return value
      .replace(/\s+/g, ' ')
      .replace(/^(foi|era|e|é)\s+/i, '')
      .replace(/^(comprando|pagando|comprei|paguei|gastando|gastei com|gasto com)\s+/i, '')
      .replace(/^(uma|um|o|a|os|as|no|na|nos|nas|em|com)\s+/i, '')
      .replace(/[.!?]+$/g, '')
      .trim();
  }

  private inferExpenseCategoryFromDetail(
    detail: string | null,
    categoryNames: string[],
  ): string | null {
    if (!detail) {
      return null;
    }

    const normalized = this.normalizeText(detail);
    const existingMatch = categoryNames.find((name) => {
      const category = this.normalizeText(name);
      return normalized.includes(category) || category.includes(normalized);
    });
    if (existingMatch) {
      return existingMatch;
    }

    const mappings: Array<[RegExp, string]> = [
      [/\b(mercado|supermercado|restaurante|lanche|almoco|jantar|cafe|comida|ifood)\b/, 'Alimentação'],
      [/\b(onibus|uber|99|taxi|metro|trem|gasolina|combustivel|estacionamento)\b/, 'Transporte'],
      [/\b(aluguel|condominio|luz|agua|internet|energia|casa|limpeza|moveis|decoracao)\b/, 'Casa'],
      [/\b(toalha|roupa|calcado|sapato|barbeiro|cabelo|sabonete|shampoo|higiene|farmacia|perfume)\b/, 'Cuidados pessoais'],
      [/\b(remedio|consulta|medico|dentista|exame|academia|saude)\b/, 'Saúde'],
      [/\b(escola|curso|livro|faculdade|educacao)\b/, 'Educação'],
      [/\b(cinema|show|viagem|bar|lazer|assinatura|netflix|spotify)\b/, 'Lazer'],
    ];

    return mappings.find(([pattern]) => pattern.test(normalized))?.[1] ?? 'Outros';
  }

  private async applyLearnedCategoryPreference(
    userId: string,
    categoryHint: string,
    type: TransactionType,
    contextValues: Array<string | null | undefined>,
  ): Promise<string> {
    const keys = this.categoryPreferenceKeys([categoryHint, ...contextValues]);
    if (!keys.length) {
      return categoryHint;
    }

    const preference = await this.prisma.categoryPreference.findFirst({
      where: { userId, type, sourceKey: { in: keys } },
      orderBy: [{ hits: 'desc' }, { updatedAt: 'desc' }],
    });

    return preference?.categoryName ?? categoryHint;
  }

  private async rememberCategoryPreference(
    userId: string,
    draft: WhatsappTransactionDraft,
    targetCategory: string,
  ): Promise<void> {
    const categoryName = this.formatCategoryName(targetCategory, draft.type);
    const sourceValues = [
      draft.categoryHint,
      draft.description,
      this.extractCategoryLearningTerm(draft.description),
    ];
    const keys = this.categoryPreferenceKeys(sourceValues).filter(
      (key) => key !== this.categoryPreferenceKey(categoryName),
    );
    if (!keys.length) {
      return;
    }

    await Promise.all(
      keys.map((sourceKey) =>
        this.prisma.categoryPreference.upsert({
          where: {
            userId_sourceKey_type: {
              userId,
              sourceKey,
              type: draft.type,
            },
          },
          create: {
            userId,
            sourceKey,
            sourceText: sourceKey,
            categoryName,
            type: draft.type,
          },
          update: {
            categoryName,
            hits: { increment: 1 },
          },
        }),
      ),
    );
  }

  private categoryPreferenceKeys(values: Array<string | null | undefined>): string[] {
    return [
      ...new Set(
        values
          .map((value) => this.categoryPreferenceKey(value))
          .filter((value): value is string => Boolean(value)),
      ),
    ];
  }

  private categoryPreferenceKey(value: string | null | undefined): string | null {
    if (!value) {
      return null;
    }
    const key = this.normalizeText(
      value
        .replace(/^(compra|compras|gasto|despesa|receita|venda|recebimento)\s+(de|do|da|com)\s+/i, '')
        .replace(/\b(nova|novo|meu|minha|um|uma|o|a|os|as|de|do|da|com|para|pra)\b/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim(),
    );
    return key.length >= 3 ? key.slice(0, 80) : null;
  }

  private extractCategoryLearningTerm(description: string): string | null {
    const match = description.match(/\b(?:compra|gasto|despesa|paguei|comprei)\s+(?:de|com)?\s*(.+)$/i);
    return match ? this.cleanFollowUpDetail(match[1]!) : null;
  }

  private findSimilarCategory<T extends { name: string }>(categories: T[], hint: string): T | null {
    const normalizedHint = this.normalizeText(hint);
    const hintKey = this.categoryPreferenceKey(hint);
    const hintGroup = this.categorySemanticGroup(hint);
    return (
      categories.find((category) => {
        const normalizedCategory = this.normalizeText(category.name);
        const categoryKey = this.categoryPreferenceKey(category.name);
        return (
          normalizedCategory === normalizedHint ||
          (hintKey && categoryKey === hintKey) ||
          (hintGroup && this.categorySemanticGroup(category.name) === hintGroup)
        );
      }) ?? null
    );
  }

  private categorySemanticGroup(value: string): string | null {
    const normalized = this.normalizeText(value);
    const groups: Array<[RegExp, string]> = [
      [/\b(alimentacao|mercado|supermercado|restaurante|comida|lanche|ifood)\b/, 'alimentacao'],
      [/\b(transporte|uber|taxi|onibus|metro|gasolina|combustivel)\b/, 'transporte'],
      [/\b(casa|moradia|aluguel|condominio|luz|agua|internet|limpeza)\b/, 'casa'],
      [/\b(cuidados pessoais|higiene|itens de higiene|toalha|roupa|calcado|sabonete|shampoo|perfume|barbeiro|cabelo)\b/, 'cuidados_pessoais'],
      [/\b(saude|remedio|farmacia|consulta|medico|dentista|exame)\b/, 'saude'],
      [/\b(educacao|curso|livro|faculdade|escola)\b/, 'educacao'],
      [/\b(lazer|cinema|show|viagem|bar|netflix|spotify|assinatura)\b/, 'lazer'],
    ];
    return groups.find(([pattern]) => pattern.test(normalized))?.[1] ?? null;
  }

  private formatCategoryName(value: string, type: TransactionType): string {
    const normalized = this.normalizeText(value);
    if (type === TransactionType.EXPENSE) {
      const semanticName = this.categorySemanticGroup(value);
      if (semanticName === 'alimentacao') return 'Alimentação';
      if (semanticName === 'transporte') return 'Transporte';
      if (semanticName === 'casa') return 'Casa';
      if (semanticName === 'cuidados_pessoais') return 'Itens de higiene';
      if (semanticName === 'saude') return 'Saúde';
      if (semanticName === 'educacao') return 'Educação';
      if (semanticName === 'lazer') return 'Lazer';
    }
    if (normalized === 'outros' || normalized === 'outras') {
      return 'Outros';
    }
    return this.titleCasePt(value);
  }

  private isGranularFollowUpCategory(categoryHint: string, detail: string | null): boolean {
    if (!detail) {
      return false;
    }
    const category = this.normalizeText(categoryHint);
    const normalizedDetail = this.normalizeText(detail);
    if (!category || !normalizedDetail) {
      return false;
    }
    return normalizedDetail.includes(category) || category.includes(normalizedDetail);
  }

  private preferFollowUpDescription(
    extractedDescription: string | undefined,
    followUpDetailHint: string | null,
    type: TransactionType,
  ): string | undefined {
    if (!followUpDetailHint || type !== TransactionType.EXPENSE) {
      return extractedDescription;
    }

    const normalizedDescription = this.normalizeText(String(extractedDescription || ''));
    if (
      !normalizedDescription ||
      /^(gastei|paguei|comprei)(?: r\$?)? ?\d+([\.,]\d{1,2})?( reais?)?$/.test(
        normalizedDescription,
      )
    ) {
      return `Compra de ${followUpDetailHint.toLocaleLowerCase('pt-BR')}`;
    }

    return extractedDescription;
  }

  private parseDraftEdit(message: string): WhatsappDraftEdit | null {
    const amountMatch = message.match(
      /\b(?:altere|alterar|mude|mudar|troque|trocar|corrija|corrigir)\s+(?:o\s+)?valor\s+(?:para|pra|por)\s*(?:r\$)?\s*(\d+(?:[.,]\d{1,2})?)/i,
    );
    if (amountMatch) {
      const amount = this.parseBrazilianAmount(amountMatch[1]!);
      return amount > 0 ? { kind: 'amount', amount, label: 'Valor' } : null;
    }

    const titleMatch = message.match(
      /\b(?:altere|alterar|mude|mudar|troque|trocar|corrija|corrigir)\s+(?:o\s+)?(?:titulo|título|nome|descricao|descrição)\s+(?:para|pra|por)\s+(.+)$/i,
    );
    if (titleMatch) {
      const title = this.cleanDraftTextValue(titleMatch[1]!);
      return title ? { kind: 'title', title: this.sentenceCase(title).slice(0, 100), label: 'Título' } : null;
    }

    const categoryMatch = message.match(
      /\b(?:altere|alterar|mude|mudar|troque|trocar|corrija|corrigir)\s+a?\s*categoria\s+(?:para|pra|por)\s+(.+)$/i,
    );
    if (categoryMatch) {
      const category = this.cleanDraftTextValue(categoryMatch[1]!);
      return category
        ? { kind: 'category', category: this.titleCasePt(category).slice(0, 60), label: 'Categoria' }
        : null;
    }

    if (/\b(?:coloque|mude|altere|troque|marque)\b.*\b(?:negocio|negócio|empresa|empresarial)\b/i.test(message)) {
      return { kind: 'scope', scope: FinancialScope.BUSINESS, label: 'Modo' };
    }
    if (/\b(?:coloque|mude|altere|troque|marque)\b.*\b(?:pessoal|particular)\b/i.test(message)) {
      return { kind: 'scope', scope: FinancialScope.PERSONAL, label: 'Modo' };
    }

    const paymentMatch = message.match(
      /\b(?:troque|trocar|altere|alterar|mude|mudar|corrija|corrigir)\b.*\b(?:pagamento|forma|conta)\b(?:\s+(?:para|pra|por)\s+(.+))?$/i,
    );
    if (paymentMatch) {
      const query = paymentMatch[1] ? this.cleanDraftTextValue(paymentMatch[1]) : null;
      return query
        ? { kind: 'payment', query, label: 'Pagamento' }
        : { kind: 'payment', label: 'Pagamento' };
    }
    const directPaymentMatch = message.match(
      /\b(?:troque|trocar|altere|alterar|mude|mudar|corrija|corrigir)\b.*\b(?:carteira|cartao|cartão|pix|banco)\b/i,
    );
    if (directPaymentMatch) {
      return { kind: 'payment', query: message, label: 'Pagamento' };
    }
    if (this.isPaymentPhrase(message)) {
      return { kind: 'payment', query: message, label: 'Pagamento' };
    }

    return null;
  }

  private applyDraftEdit(
    draft: WhatsappTransactionDraft,
    edit: Exclude<WhatsappDraftEdit, { kind: 'payment' }>,
  ): WhatsappTransactionDraft {
    if (edit.kind === 'amount') {
      if (draft.installmentCount && draft.installmentCount > 1) {
        const nextDraft: WhatsappTransactionDraft = { ...draft, amount: edit.amount };
        delete nextDraft.totalAmount;
        delete nextDraft.installmentCount;
        return nextDraft;
      }
      return {
        ...draft,
        amount: edit.amount,
      };
    }
    if (edit.kind === 'title') {
      return { ...draft, description: edit.title };
    }
    if (edit.kind === 'category') {
      return { ...draft, categoryHint: this.formatCategoryName(edit.category, draft.type) };
    }
    return { ...this.clearDraftPayment(draft), scope: edit.scope };
  }

  private clearDraftPayment(draft: WhatsappTransactionDraft): WhatsappTransactionDraft {
    const nextDraft: WhatsappTransactionDraft = { ...draft };
    delete nextDraft.accountId;
    delete nextDraft.creditCardId;
    delete nextDraft.paymentLabel;
    return nextDraft;
  }

  private draftEditUpdatedMessage(edit: Exclude<WhatsappDraftEdit, { kind: 'payment' }>): string {
    return edit.kind === 'category'
      ? 'Categoria atualizada'
      : `${edit.label} atualizado`;
  }

  private cleanDraftTextValue(value: string): string {
    return value
      .replace(/[.!?]+$/g, '')
      .replace(/\b(por favor|pfv|obrigado|obrigada)\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private sentenceCase(value: string): string {
    const clean = value.replace(/\s+/g, ' ').trim();
    return clean ? clean.charAt(0).toUpperCase() + clean.slice(1) : clean;
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

  private resolveTransactionDate(message: string): Date | null {
    const lower = this.normalizeText(message);
    const today = this.todayInSaoPaulo();

    if (/\bontem\b/.test(lower)) {
      return new Date(
        Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - 1, 12),
      );
    }
    if (/\bhoje\b/.test(lower)) {
      return today;
    }

    const explicitDate = lower.match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/);
    if (explicitDate) {
      const day = Number(explicitDate[1]);
      const month = Number(explicitDate[2]) - 1;
      let year = explicitDate[3] ? Number(explicitDate[3]) : today.getUTCFullYear();
      if (year < 100) year += 2000;
      return this.validDateAtNoon(year, month, day);
    }

    const dayOfMonth = lower.match(/\bdia\s+(\d{1,2})\b/);
    if (dayOfMonth) {
      return this.validDateAtNoon(
        today.getUTCFullYear(),
        today.getUTCMonth(),
        Number(dayOfMonth[1]),
      );
    }

    const weekdayNames = [
      ['domingo'],
      ['segunda', 'segunda-feira'],
      ['terca', 'terca-feira'],
      ['quarta', 'quarta-feira'],
      ['quinta', 'quinta-feira'],
      ['sexta', 'sexta-feira'],
      ['sabado'],
    ];
    const targetWeekday = weekdayNames.findIndex((names) =>
      names.some((name) => new RegExp(`\\b${name}\\b`).test(lower)),
    );
    if (targetWeekday >= 0) {
      const daysAgo = (today.getUTCDay() - targetWeekday + 7) % 7;
      return new Date(
        Date.UTC(
          today.getUTCFullYear(),
          today.getUTCMonth(),
          today.getUTCDate() - daysAgo,
          12,
        ),
      );
    }

    return null;
  }

  private extractInstallmentCount(message: string): number {
    const match = this.normalizeText(message).match(/\b(?:em\s*)?(\d{1,2})\s*x\b/);
    if (!match) return 1;
    return Math.min(60, Math.max(1, Number(match[1])));
  }

  private todayInSaoPaulo(): Date {
    const parts = new Intl.DateTimeFormat('en-CA', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      timeZone: 'America/Sao_Paulo',
    }).formatToParts(new Date());
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return new Date(Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day), 12));
  }

  private validDateAtNoon(year: number, month: number, day: number): Date | null {
    const date = new Date(Date.UTC(year, month, day, 12));
    if (
      date.getUTCFullYear() !== year ||
      date.getUTCMonth() !== month ||
      date.getUTCDate() !== day
    ) {
      return null;
    }
    return date;
  }

  private addMonthsKeepingDay(date: Date, months: number): Date {
    const targetYear = date.getUTCFullYear();
    const targetMonth = date.getUTCMonth() + months;
    const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
    return new Date(
      Date.UTC(targetYear, targetMonth, Math.min(date.getUTCDate(), lastDay), 12),
    );
  }

  private formatDateOnly(value: string): string {
    return new Intl.DateTimeFormat('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(new Date(value));
  }

  private isDateInCurrentMonth(date: Date): boolean {
    const current = this.currentMonthRange();
    return date >= current.start && date < current.end;
  }

  private parseBrazilianAmount(value: string): number {
    const normalized = value.includes(',')
      ? value.replace(/\./g, '').replace(',', '.')
      : value;
    return Number(normalized);
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

  private titleCasePt(value: string): string {
    const lowercaseWords = new Set(['a', 'as', 'com', 'da', 'das', 'de', 'do', 'dos', 'e', 'em', 'na', 'nas', 'no', 'nos', 'o', 'os', 'para', 'por']);
    return value
      .trim()
      .split(/\s+/)
      .map((word, index) => {
        const lower = word.toLocaleLowerCase('pt-BR');
        if (index > 0 && lowercaseWords.has(lower)) {
          return lower;
        }
        return lower.charAt(0).toLocaleUpperCase('pt-BR') + lower.slice(1);
      })
      .join(' ');
  }

  private formatMoney(value: number): string {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
  }

}
