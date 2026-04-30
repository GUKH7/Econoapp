import { Inject, Injectable } from '@nestjs/common';
import { SalesChannel, Transaction, TransactionSource, User } from '@prisma/client';
import { ChartJSNodeCanvas } from 'chartjs-node-canvas';
import ChartDataLabels from 'chartjs-plugin-datalabels';
import { PrismaService } from '@/config/database';
import { env } from '@/config/env';
import { calculateNetAmount } from '@/domain/finance/calculate-fees';
import { buildConfirmationMessage, isConfidenceAcceptable } from '@/domain/finance/transaction-rules';
import { DashboardService } from '@/modules/dashboard/dashboard.service';
import { TransactionRepository } from '@/modules/transactions/repositories/transaction.repository';
import { GeminiFinancialOutput, GeminiService } from '@/services/ai/gemini.service';
import { createMainKeyboard, TelegramInlineKeyboardMarkup } from './keyboards/main.keyboard';
import { createPeriodKeyboard, ReportPeriod } from './keyboards/period.keyboard';
import { TelegramNotificationService } from './telegram-notification.service';

interface TelegramActor {
  telegramId: string;
  chatId: number;
  firstName?: string;
}

export interface TelegramTextInput extends TelegramActor {
  text: string;
}

export interface TelegramVoiceInput extends TelegramActor {
  fileId: string;
  mimeType?: string;
}

export interface TelegramCallbackInput extends TelegramActor {
  action: string;
}

export interface TelegramReplyOptions {
  replyMarkup?: TelegramReplyMarkup;
  parseMode?: 'Markdown' | 'HTML';
}

export interface TelegramPhotoOptions extends TelegramReplyOptions {
  caption?: string;
}

export interface TelegramKeyboardButton {
  text: string;
}

export interface TelegramReplyKeyboardMarkup {
  keyboard: TelegramKeyboardButton[][];
  resize_keyboard?: boolean;
  is_persistent?: boolean;
  one_time_keyboard?: boolean;
}

export type TelegramReplyMarkup = TelegramInlineKeyboardMarkup | TelegramReplyKeyboardMarkup;

export interface TelegramResponder {
  reply(text: string, options?: TelegramReplyOptions): Promise<void>;
  replyWithPhoto(photo: Buffer, options?: TelegramPhotoOptions): Promise<void>;
  editMessage(text: string, options?: TelegramReplyOptions): Promise<void>;
  answerCallback(text?: string): Promise<void>;
  enterScene?(sceneId: string): Promise<void>;
}

type DashboardSummaryData = Awaited<ReturnType<DashboardService['getSummary']>>;

interface PendingTransaction {
  userId: string;
  description: string;
  extracted: GeminiFinancialOutput;
  source: TransactionSource;
}

interface PendingChannelFeeContext {
  user: User;
  description: string;
  extracted: GeminiFinancialOutput;
  source: TransactionSource;
}

@Injectable()
export class TelegramService {
  private readonly chartCanvas = new ChartJSNodeCanvas({
    width: 900,
    height: 500,
    plugins: { modern: ['chartjs-plugin-datalabels'] },
  });
  private readonly pendingByTelegramId = new Map<string, PendingTransaction>();
  private readonly editingCategoryByTelegramId = new Map<string, string>();
  private readonly pendingNewChannelByTelegramId = new Map<string, PendingChannelFeeContext>();
  private readonly waitingForFeeByTelegramId = new Map<string, boolean>();
  private readonly waitingForCustomCategoryByTelegramId = new Map<string, string>();
  private readonly waitingForCustomPeriodByTelegramId = new Map<string, boolean>();

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(GeminiService) private readonly geminiService: GeminiService,
    @Inject(TransactionRepository) private readonly transactionRepository: TransactionRepository,
    @Inject(DashboardService) private readonly dashboardService: DashboardService,
    @Inject(TelegramNotificationService)
    private readonly telegramNotificationService: TelegramNotificationService,
  ) {}

  async handleStart(actor: TelegramActor, responder: TelegramResponder): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { telegramId: actor.telegramId } });

    if (!user) {
      await responder.reply(
        '👋 Bem-vindo ao EconoApp no Telegram!\n\nVamos fazer seu cadastro rápido para começar a registrar transações.',
      );
      if (responder.enterScene) {
        await responder.enterScene('telegram-onboarding');
      } else {
        await responder.reply('Envie seu nome completo para concluir o cadastro.');
      }
      return;
    }

    await responder.reply(
      `✅ Olá, ${user.name}! Seu bot está pronto para uso.\n\nPara registrar uma venda, envie uma mensagem de texto ou áudio com o valor, o produto e o canal.\n\n💡 *Exemplo:* "Vendi 50 reais de camiseta na Shopee"`,
      { replyMarkup: createMainKeyboard(), parseMode: 'Markdown' },
    );
  }

  async handleHelp(_actor: TelegramActor, responder: TelegramResponder): Promise<void> {
    await responder.reply(
      [
        '📚 *Comandos disponíveis:*',
        '/start - iniciar o bot e acessar o menu principal',
        '/saldo - saldo líquido do mês atual',
        '/resumo - entradas, saídas e top categorias',
        '/canais - listar canais e ajustar taxa',
        '/configuracoes - configurações do seu perfil',
        '/ajuda - exibir esta ajuda',
      ].join('\n'),
      { replyMarkup: createMainKeyboard(), parseMode: 'Markdown' },
    );
  }

  async handleSaldo(actor: TelegramActor, responder: TelegramResponder): Promise<void> {
    const user = await this.requireUser(actor.telegramId, responder);
    if (!user) return;

    const saldo = await this.getSaldo(user.id);
    await responder.reply(saldo, { replyMarkup: createMainKeyboard(), parseMode: 'Markdown' });
  }

  async handleResumo(
    actor: TelegramActor,
    responder: TelegramResponder,
    period: ReportPeriod = 'this_month',
  ): Promise<void> {
    const user = await this.requireUser(actor.telegramId, responder);
    if (!user) return;

    const resumo = await this.getResumo(user.id, period);
    await responder.reply(resumo, { replyMarkup: createPeriodKeyboard(), parseMode: 'Markdown' });

    const chart = await this.generateChart(user.id, 'category', period);
    await responder.replyWithPhoto(chart, { caption: '📈 Distribuição por categoria' });
  }

  async handleChannels(actor: TelegramActor, responder: TelegramResponder): Promise<void> {
    const user = await this.requireUser(actor.telegramId, responder);
    if (!user) return;
    await this.replyChannelsOverview(user.id, responder);
  }

  async handleSettings(actor: TelegramActor, responder: TelegramResponder): Promise<void> {
    const user = await this.requireUser(actor.telegramId, responder);
    if (!user) return;

    await responder.reply('⚙️ *Configurações*\n\nEscolha uma opção:', {
      replyMarkup: {
        inline_keyboard: [
          [
            { text: '👤 Meu Perfil', callback_data: 'settings:profile' },
            { text: '🏪 Canais', callback_data: 'tg:canais' },
          ],
          [
            { text: '🏷️ Categorias', callback_data: 'settings:categories' },
            { text: '🔙 Voltar', callback_data: 'settings:back' },
          ],
        ],
      },
      parseMode: 'Markdown',
    });
  }

  async handleText(input: TelegramTextInput, responder: TelegramResponder): Promise<void> {
    const user = await this.requireUser(input.telegramId, responder);
    if (!user) return;

    const text = input.text.trim();

    if (text === '📊 Ver Resumo') return this.handleResumo(input, responder);
    if (text === '💰 Ver Saldo') return this.handleSaldo(input, responder);
    if (text === '📋 Últimas 5 transações') return this.replyLatestTransactions(user.id, responder);
    if (text === '🏪 Canais') return this.handleChannels(input, responder);
    if (text === '❓ Ajuda') return this.handleHelp(input, responder);
    if (text === '⚙️ Configurações') return this.handleSettings(input, responder);

    const pendingCatTransactionId = this.waitingForCustomCategoryByTelegramId.get(input.telegramId);
    if (pendingCatTransactionId) {
      const categoryName = input.text.trim();
      this.waitingForCustomCategoryByTelegramId.delete(input.telegramId);
      this.editingCategoryByTelegramId.delete(input.telegramId);
      
      const category = await this.resolveCategory(user.id, categoryName);
      
      const tx = await this.transactionRepository.findById(pendingCatTransactionId);
      if (tx && tx.userId === user.id) {
        await this.transactionRepository.update(pendingCatTransactionId, { categoryId: category.id });
        await responder.reply(`✏️ Categoria atualizada com sucesso para *${category.name}*.`, { parseMode: 'Markdown' });
      } else {
        await responder.reply('⚠️ Transação não encontrada para atualização.');
      }
      return;
    }

    if (this.waitingForFeeByTelegramId.get(input.telegramId)) {
      const feeText = input.text.replace(',', '.').replace('%', '').trim();
      const fee = parseFloat(feeText);
      if (isNaN(fee) || fee < 0 || fee > 100) {
        await responder.reply('⚠️ Valor inválido. Digite apenas números, por exemplo: 15 ou 12.5');
        return;
      }
      this.waitingForFeeByTelegramId.delete(input.telegramId);
      await this.processNewChannelFee(input.telegramId, fee, responder, user.id);
      return;
    }

    if (this.waitingForCustomPeriodByTelegramId.get(input.telegramId)) {
      const range = this.parseCustomPeriod(input.text);
      if (!range) {
        await responder.reply(
          [
            '⚠️ Formato de período inválido.',
            'Use: 01/04/2026 a 30/04/2026 (dia/mês/ano obrigatórios).',
          ].join('\n'),
        );
        return;
      }

      this.waitingForCustomPeriodByTelegramId.delete(input.telegramId);
      const summary = await this.dashboardService.getSummary(user.id, range.startDate, range.endDate);
      const resumo = this.buildResumoText(summary, range.label);

      await responder.reply(resumo, { replyMarkup: createPeriodKeyboard(), parseMode: 'Markdown' });

      const chart = await this.generateChartForRange(user.id, 'category', range.startDate, range.endDate);
      await responder.replyWithPhoto(chart, { caption: `📈 Distribuição por categoria (${range.label})` });
      return;
    }

    await this.processFinancialMessage({
      user,
      description: input.text,
      source: 'TELEGRAM',
      telegramId: input.telegramId,
      responder,
    });
  }

  async handleVoice(input: TelegramVoiceInput, responder: TelegramResponder): Promise<void> {
    const user = await this.requireUser(input.telegramId, responder);
    if (!user) return;

    // Busca canais e categorias do usuário para dar contexto ao Gemini
    const [channels, categories] = await Promise.all([
      this.prisma.salesChannel.findMany({ where: { userId: user.id }, select: { name: true } }),
      this.prisma.category.findMany({ where: { userId: user.id }, select: { name: true } }),
    ]);
    const aiContext = {
      channelNames: channels.map((c) => c.name),
      categoryNames: categories.map((c) => c.name),
    };

    const audioBase64 = await this.downloadTelegramAudio(input.fileId);
    const extracted = await this.geminiService.extractFinancialDataFromAudioBase64(
      audioBase64,
      input.mimeType ?? 'audio/ogg',
      aiContext,
    );

    await this.processExtractedMessage({
      user,
      description: `Áudio: ${extracted.transcription}`,
      source: 'AUDIO',
      extracted,
      telegramId: input.telegramId,
      responder,
    });
  }

  async handleCallbackQuery(input: TelegramCallbackInput, responder: TelegramResponder): Promise<void> {
    if (input.action === 'auth:start') {
      await responder.answerCallback();
      await this.handleStart(input, responder);
      return;
    }

    const user = await this.requireUser(input.telegramId, responder);
    if (!user) return;

    const action = input.action;

    if (action === 'tg:saldo') {
      await responder.answerCallback('Consultando saldo...');
      await this.handleSaldo(input, responder);
      return;
    }

    if (action === 'tg:resumo') {
      await responder.answerCallback('Gerando resumo...');
      await this.handleResumo(input, responder, 'this_month');
      return;
    }

    if (action === 'tg:ultimas') {
      await responder.answerCallback('Buscando transações...');
      await this.replyLatestTransactions(user.id, responder);
      return;
    }

    if (action === 'tg:canais') {
      await responder.answerCallback('Carregando canais...');
      await this.handleChannels(input, responder);
      return;
    }

    if (action === 'tg:ajuda') {
      await responder.answerCallback('Abrindo ajuda...');
      await this.handleHelp(input, responder);
      return;
    }

    if (action === 'tg:settings') {
      await responder.answerCallback('Abrindo configurações...');
      await this.handleSettings(input, responder);
      return;
    }

    if (action === 'settings:profile') {
      await responder.answerCallback('Carregando perfil...');
      const channelCount = await this.prisma.salesChannel.count({ where: { userId: user.id } });
      const txCount = await this.prisma.transaction.count({ where: { userId: user.id } });
      await responder.reply(
        [
          '👤 *Seu Perfil*',
          '',
          `🪪 Nome: ${user.name}`,
          `📱 Telefone: ${this.formatPhoneDisplay(user.phone)}`,
          `📧 Email: ${!user.email || user.email.startsWith('tg_') ? 'não informado' : user.email}`,
          '',
          `🏪 Canais cadastrados: ${channelCount}`,
          `📋 Total de transações: ${txCount}`,
        ].join('\n'),
        {
          replyMarkup: {
            inline_keyboard: [
              [{ text: '✏️ Editar Perfil', callback_data: 'settings:edit_profile' }],
              [{ text: '🔙 Voltar para Configurações', callback_data: 'tg:settings' }],
            ],
          },
          parseMode: 'Markdown',
        },
      );
      return;
    }

    if (action === 'settings:edit_profile') {
      await responder.answerCallback('Abrindo edição de perfil...');
      if (responder.enterScene) {
        await responder.enterScene('telegram-edit-profile');
      } else {
        await responder.reply('Funcionalidade indisponível no momento.');
      }
      return;
    }

    if (action === 'settings:categories') {
      await responder.answerCallback('Carregando categorias...');
      const cats = await this.prisma.category.findMany({ where: { userId: user.id }, orderBy: { name: 'asc' } });
      if (cats.length === 0) {
        await responder.reply('🏷️ Nenhuma categoria cadastrada.', { replyMarkup: createMainKeyboard() });
        return;
      }
      const list = cats.map((c, i) => `${i + 1}. ${c.name}`).join('\n');
      await responder.reply(
        `🏷️ *Suas Categorias*\n\n${list}\n\n_As categorias são criadas automaticamente conforme você registra transações._`,
        { replyMarkup: createMainKeyboard() },
      );
      return;
    }

    if (action === 'settings:back') {
      await responder.answerCallback('');
      await responder.reply('🏠 Menu principal:', { replyMarkup: createMainKeyboard() });
      return;
    }

    if (action.startsWith('period:')) {
      await responder.answerCallback('Atualizando período...');
      const period = action.replace('period:', '') as ReportPeriod;
      if (period === 'custom') {
        this.waitingForCustomPeriodByTelegramId.set(input.telegramId, true);
        await responder.reply(
          [
            '🗓️ Envie o período desejado:',
            'Exemplo: 01/04/2026 a 30/04/2026',
          ].join('\n'),
          { replyMarkup: createPeriodKeyboard() },
        );
        return;
      }
      await responder.editMessage(await this.getResumo(user.id, period), {
        replyMarkup: createPeriodKeyboard(),
      });
      return;
    }

    if (action === 'pending:confirm') {
      await responder.answerCallback('Confirmando transação...');
      await this.confirmPending(input.telegramId, responder);
      return;
    }

    if (action === 'pending:cancel') {
      await responder.answerCallback('Transação cancelada');
      this.pendingByTelegramId.delete(input.telegramId);
      await responder.reply('❌ Registro cancelado. Pode enviar a transação novamente com mais detalhes.');
      return;
    }

    if (action.startsWith('tx:ok:')) {
      await responder.answerCallback('Perfeito!');
      const txId = action.replace('tx:ok:', '');
      const tx = await this.transactionRepository.findById(txId);
      if (tx && user.telegramId) {
        await this.telegramNotificationService.sendTransactionConfirmation(user.telegramId, tx);
      }
      await responder.reply('✅ Tudo certo! Pode enviar a próxima transação a qualquer momento.');
      return;
    }

    if (action.startsWith('tx:undo:')) {
      await responder.answerCallback('Desfazendo...');
      const transactionId = action.replace('tx:undo:', '');
      const tx = await this.transactionRepository.findById(transactionId);
      if (tx && tx.userId === user.id) {
        await this.transactionRepository.delete(tx.id);
        await responder.reply('🗑️ Transação desfeita com sucesso.');
      } else {
        await responder.reply('⚠️ Não consegui localizar essa transação para desfazer.');
      }
      return;
    }

    if (action.startsWith('newch:')) {
      const option = action.replace('newch:', '');
      if (option === 'custom') {
        this.waitingForFeeByTelegramId.set(input.telegramId, true);
        await responder.answerCallback('');
        await responder.reply('✍️ Por favor, digite apenas a taxa de comissão em % (exemplo: 12.5 ou 15):');
        return;
      }

      const fee = parseFloat(option);
      await this.processNewChannelFee(input.telegramId, fee, responder, user.id);
      return;
    }

    if (action.startsWith('tx:editcat:')) {
      await responder.answerCallback('Escolha a nova categoria...');
      const transactionId = action.replace('tx:editcat:', '');
      this.editingCategoryByTelegramId.set(input.telegramId, transactionId);
      await this.replyCategoryPicker(user.id, responder);
      return;
    }

    if (action.startsWith('cat:')) {
      const categoryId = action.replace('cat:', '');
      const transactionId = this.editingCategoryByTelegramId.get(input.telegramId);

      if (!transactionId || !categoryId) {
        await responder.answerCallback('Ação inválida ou expirada');
        return;
      }

      if (categoryId === 'custom') {
        this.waitingForCustomCategoryByTelegramId.set(input.telegramId, transactionId);
        await responder.answerCallback('');
        await responder.reply('✍️ Por favor, digite o nome da nova categoria:');
        return;
      }

      await responder.answerCallback('Atualizando categoria...');
      const tx = await this.transactionRepository.findById(transactionId);
      if (!tx || tx.userId !== user.id) {
        await responder.reply('⚠️ Transação não encontrada para atualização.');
        this.editingCategoryByTelegramId.delete(input.telegramId);
        return;
      }

      await this.transactionRepository.update(transactionId, { categoryId });
      this.editingCategoryByTelegramId.delete(input.telegramId);
      await responder.reply('✏️ Categoria da transação atualizada com sucesso.');
      return;
    }

    if (action.startsWith('channel:inc:') || action.startsWith('channel:dec:')) {
      await responder.answerCallback('Atualizando taxa...');
      await this.adjustChannelFee(action, user.id, responder);
      return;
    }

    if (action === 'report:chart') {
      await responder.answerCallback('Gerando gráfico...');
      const chart = await this.generateChart(user.id, 'category', 'this_month');
      await responder.replyWithPhoto(chart, { caption: '📊 Gráfico mensal por categoria' });
      return;
    }

    await responder.answerCallback('Ação não reconhecida');
  }

  async getSaldo(userId: string): Promise<string> {
    const { startDate, endDate, periodLabel } = this.getDateRange('this_month');
    const summary = await this.dashboardService.getSummary(userId, startDate, endDate);
    const money = this.formatMoney(summary.balance);
    return `💰 Saldo de ${periodLabel}: ${money}`;
  }

  async getResumo(userId: string, period: ReportPeriod): Promise<string> {
    const { startDate, endDate, periodLabel } = this.getDateRange(period);
    const summary = await this.dashboardService.getSummary(userId, startDate, endDate);

    return this.buildResumoText(summary, periodLabel);
  }

  private buildResumoText(summary: DashboardSummaryData, periodLabel: string): string {
    const topCategories = [...summary.byCategory]
      .sort((a, b) => b.total - a.total)
      .slice(0, 3)
      .map((item, index) => `${index + 1}. ${item.categoryName}: ${this.formatMoney(item.total)}`);

    return [
      `📊 Resumo de ${periodLabel}`,
      `⬆️ Entradas: ${this.formatMoney(summary.totalIncome)}`,
      `⬇️ Saídas: ${this.formatMoney(summary.totalExpense)}`,
      `💰 Saldo líquido: ${this.formatMoney(summary.balance)}`,
      '',
      '🏷️ Top 3 categorias:',
      ...(topCategories.length ? topCategories : ['Sem categorias no período.']),
    ].join('\n');
  }

  async generateChart(
    userId: string,
    type: 'category' | 'channel',
    period: ReportPeriod,
  ): Promise<Buffer> {
    const { startDate, endDate } = this.getDateRange(period);
    const summary = await this.dashboardService.getSummary(userId, startDate, endDate);

    return this.renderChart(type, summary);
  }

  private async generateChartForRange(
    userId: string,
    type: 'category' | 'channel',
    startDate: string,
    endDate: string,
  ): Promise<Buffer> {
    const summary = await this.dashboardService.getSummary(userId, startDate, endDate);

    return this.renderChart(type, summary);
  }

  private async renderChart(type: 'category' | 'channel', summary: DashboardSummaryData): Promise<Buffer> {
    if (type === 'channel') {
      const labels = summary.byChannel.map((item) => item.channelName);
      const values = summary.byChannel.map((item) => item.total);
      return this.chartCanvas.renderToBuffer({
        type: 'bar',
        data: {
          labels,
          datasets: [
            {
              label: 'Total por canal (R$)',
              data: values,
              backgroundColor: '#1d4ed8',
            },
          ],
        },
      });
    }

    const labels = summary.byCategory.map((item) => item.categoryName);
    const values = summary.byCategory.map((item) => item.total);
    const colors = summary.byCategory.map((item) => item.color || '#6366f1');

    const total = values.reduce((a, b) => a + b, 0);

    return this.chartCanvas.renderToBuffer({
      type: 'pie',
      data: {
        labels,
        datasets: [
          {
            data: values,
            backgroundColor: colors,
          },
        ],
      },
      plugins: [ChartDataLabels],
      options: {
        plugins: {
          legend: {
            position: 'bottom',
            labels: { font: { size: 14 }, color: '#333', padding: 16 },
          },
          datalabels: {
            color: '#fff',
            font: { weight: 'bold', size: 14 },
            formatter: (value: number) => {
              const pct = total > 0 ? ((value / total) * 100).toFixed(1) : '0';
              return `R$${value.toFixed(0)}\n${pct}%`;
            },
          },
        },
      },
    });
  }

  private async processFinancialMessage(params: {
    user: User;
    description: string;
    source: TransactionSource;
    telegramId: string;
    responder: TelegramResponder;
  }): Promise<void> {
    const [channels, categories] = await Promise.all([
      this.prisma.salesChannel.findMany({ where: { userId: params.user.id }, select: { name: true } }),
      this.prisma.category.findMany({ where: { userId: params.user.id }, select: { name: true } }),
    ]);

    const channelNames = channels.map((c) => c.name);
    const categoryNames = categories.map((c) => c.name);

    const extracted = await this.geminiService.extractFinancialData(
      params.description,
      { channelNames, categoryNames },
    );
    await this.processExtractedMessage({
      ...params,
      extracted,
    });
  }

  private async processExtractedMessage(params: {
    user: User;
    description: string;
    source: TransactionSource;
    extracted: GeminiFinancialOutput;
    telegramId: string;
    responder: TelegramResponder;
  }): Promise<void> {
    if (params.extracted.categoryHint === 'NÃO_ESPECIFICADO') {
      await params.responder.reply(
        '⚠️ Eu preciso saber *o que* você vendeu para organizar suas categorias!\n\nPor favor, envie a mensagem novamente citando o produto.\nExemplo: "Vendi 50 reais *de camiseta* na shopee".',
        { parseMode: 'Markdown' }
      );
      return;
    }
    if (params.extracted.channelHint) {
      const channel = await this.resolveChannel(params.user.id, params.extracted.channelHint);
      if (!channel) {
        this.pendingNewChannelByTelegramId.set(params.telegramId, params);
        await params.responder.reply(
          `⚠️ Detectei um canal novo: *${params.extracted.channelHint}*\n\nQual é a taxa de comissão cobrada por este canal?`,
          {
            parseMode: 'Markdown',
            replyMarkup: {
              inline_keyboard: [
                [{ text: 'Sem taxa (0%)', callback_data: 'newch:0' }],
                [{ text: 'Digitar porcentagem...', callback_data: 'newch:custom' }],
              ],
            },
          }
        );
        return;
      }
    }

    if (!isConfidenceAcceptable(params.extracted.confidence)) {
      this.pendingByTelegramId.set(params.telegramId, {
        userId: params.user.id,
        description: params.description,
        extracted: params.extracted,
        source: params.source,
      });

      await params.responder.reply(
        [
          '🤔 Entendi assim, mas com baixa confiança:',
          `• Tipo: ${params.extracted.type}`,
          `• Valor: ${this.formatMoney(params.extracted.amount)}`,
          `• Categoria: ${params.extracted.categoryHint}`,
          `• Canal: ${params.extracted.channelHint ?? 'não informado'}`,
          '',
          'Confirmar registro?',
        ].join('\n'),
        {
          replyMarkup: {
            inline_keyboard: [
              [
                { text: '✅ Confirmar', callback_data: 'pending:confirm' },
                { text: '❌ Cancelar', callback_data: 'pending:cancel' },
              ],
            ],
          },
        },
      );
      return;
    }

    const transaction = await this.persistTransaction({
      userId: params.user.id,
      description: params.description,
      extracted: params.extracted,
      source: params.source,
    });

    await this.sendTransactionSuccess(transaction, params.responder);
  }

  private async confirmPending(telegramId: string, responder: TelegramResponder): Promise<void> {
    const pending = this.pendingByTelegramId.get(telegramId);
    if (!pending) {
      await responder.reply('⚠️ Não encontrei nenhuma transação pendente para confirmar.');
      return;
    }

    const transaction = await this.persistTransaction({
      userId: pending.userId,
      description: pending.description,
      extracted: pending.extracted,
      source: pending.source,
    });

    this.pendingByTelegramId.delete(telegramId);
    await this.sendTransactionSuccess(transaction, responder);
  }

  private async persistTransaction(params: {
    userId: string;
    description: string;
    extracted: GeminiFinancialOutput;
    source: TransactionSource;
  }): Promise<Transaction> {
    const channel = await this.resolveChannel(params.userId, params.extracted.channelHint);
    const category = await this.resolveCategory(params.userId, params.extracted.categoryHint);

    const netAmount =
      channel && params.extracted.type === 'INCOME'
        ? calculateNetAmount(params.extracted.amount, Number(channel.feePercent))
        : params.extracted.amount;

    return this.transactionRepository.create({
      description: params.description,
      amount: params.extracted.amount,
      netAmount,
      type: params.extracted.type,
      source: params.source,
      categoryId: category.id,
      ...(channel ? { channelId: channel.id } : {}),
      userId: params.userId,
      date: new Date(),
    });
  }

  private async processNewChannelFee(telegramId: string, fee: number, responder: TelegramResponder, userId: string): Promise<void> {
    const pendingParams = this.pendingNewChannelByTelegramId.get(telegramId);
    if (!pendingParams) {
      await responder.reply('⚠️ Sessão expirada ou inválida. Envie a transação novamente.');
      return;
    }

    if (responder.answerCallback) {
      await responder.answerCallback('Criando canal...');
    } else {
      await responder.reply('Criando canal e registrando transação...');
    }

    const channelName = pendingParams.extracted.channelHint!;
    
    await this.prisma.salesChannel.create({
      data: { userId, name: channelName, feePercent: fee },
    });

    this.pendingNewChannelByTelegramId.delete(telegramId);

    const transaction = await this.persistTransaction({
      userId: pendingParams.user.id,
      description: pendingParams.description,
      extracted: pendingParams.extracted,
      source: pendingParams.source,
    });
    await this.sendTransactionSuccess(transaction, responder, true, channelName);
  }

  private async sendTransactionSuccess(
    transaction: Transaction,
    responder: TelegramResponder,
    isNewChannel = false,
    channelName?: string,
  ): Promise<void> {
    if (!channelName && transaction.channelId) {
      const channel = await this.prisma.salesChannel.findUnique({ where: { id: transaction.channelId } });
      channelName = channel?.name;
      isNewChannel = channel ? Number(channel.feePercent) === 0 : false;
    }

    let confirmation = buildConfirmationMessage(
      transaction.description,
      Number(transaction.amount),
      Number(transaction.netAmount),
      channelName ?? null,
    );

    if (isNewChannel && channelName) {
      confirmation += `\n\n🆕 Canal *${channelName}* criado automaticamente com taxa 0%.`;
      confirmation += '\n💡 Use /canais para configurar a taxa de comissão.';
    }

    await responder.reply(confirmation, {
      parseMode: 'Markdown',
      replyMarkup: {
        inline_keyboard: [
          [
            { text: '✅ Correto', callback_data: `tx:ok:${transaction.id}` },
            { text: '✏️ Editar categoria', callback_data: `tx:editcat:${transaction.id}` },
          ],
          [{ text: '🗑️ Desfazer', callback_data: `tx:undo:${transaction.id}` }],
          [{ text: '📊 Ver Resumo', callback_data: 'report:chart' }],
        ],
      },
    });
  }

  private async resolveChannel(userId: string, hint?: string | null) {
    if (!hint) {
      return null;
    }

    // 1. Match exato (case insensitive)
    const exact = await this.prisma.salesChannel.findFirst({
      where: { userId, name: { equals: hint, mode: 'insensitive' } },
    });
    if (exact) {
      return exact;
    }

    // 2. Match parcial (busca nos dois sentidos)
    const partial = await this.prisma.salesChannel.findFirst({
      where: { userId, name: { contains: hint, mode: 'insensitive' } },
    });
    if (partial) {
      return partial;
    }

    // 2b. Match reverso — canal existente contido no hint (ex: "Shopee" dentro de "Shopee Brasil")
    const allChannels = await this.prisma.salesChannel.findMany({ where: { userId } });
    const hintLower = hint.toLowerCase();
    const reverseMatch = allChannels.find((ch) => hintLower.includes(ch.name.toLowerCase()));
    if (reverseMatch) {
      return reverseMatch;
    }

    // 3. Fuzzy matching — trata erros de digitação como "shope" → "Shopee"
    const fuzzyMatch = this.fuzzyMatchChannel(hint, allChannels);
    if (fuzzyMatch) {
      return fuzzyMatch;
    }

    // Se não encontrou, retorna null para o chamador perguntar a taxa
    return null;
  }

  private fuzzyMatchChannel(hint: string, channels: SalesChannel[]) {
    const normalizedHint = this.normalizeForFuzzy(hint);
    let bestMatch: (typeof channels)[0] | null = null;
    let bestScore = 0;

    for (const channel of channels) {
      const normalizedName = this.normalizeForFuzzy(channel.name);

      // Verifica se um contém o outro após normalização
      if (normalizedName.includes(normalizedHint) || normalizedHint.includes(normalizedName)) {
        return channel;
      }

      // Calcula similaridade
      const score = this.similarity(normalizedHint, normalizedName);
      if (score > bestScore) {
        bestScore = score;
        bestMatch = channel;
      }
    }

    // Aceita se a similaridade for >= 60%
    return bestScore >= 0.6 ? bestMatch : null;
  }

  private normalizeForFuzzy(text: string): string {
    return text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') // remove acentos
      .replace(/[^a-z0-9]/g, '');       // remove espaços e especiais
  }

  private similarity(a: string, b: string): number {
    if (a === b) return 1;
    const longer = a.length > b.length ? a : b;
    const shorter = a.length > b.length ? b : a;
    if (longer.length === 0) return 1;

    const costs = new Array(shorter.length + 1);
    for (let i = 0; i <= longer.length; i++) {
      let lastValue = i;
      for (let j = 0; j <= shorter.length; j++) {
        if (i === 0) {
          costs[j] = j;
        } else if (j > 0) {
          let newValue = costs[j - 1] as number;
          if (longer[i - 1] !== shorter[j - 1]) {
            newValue = Math.min(Math.min(newValue, lastValue), (costs[j] as number)) + 1;
          }
          costs[j - 1] = lastValue;
          lastValue = newValue;
        }
      }
      if (i > 0) costs[shorter.length] = lastValue;
    }
    return (longer.length - (costs[shorter.length] as number)) / longer.length;
  }

  private async resolveCategory(userId: string, hint: string) {
    if (!hint || hint.trim() === '') {
      hint = 'Outros';
    }

    const byHint = await this.prisma.category.findFirst({
      where: { userId, name: { contains: hint, mode: 'insensitive' } },
    });

    if (byHint) {
      return byHint;
    }

    const letters = '0123456789ABCDEF';
    let randomColor = '#';
    for (let i = 0; i < 6; i++) {
      randomColor += letters[Math.floor(Math.random() * 16)];
    }

    const categoryName = hint.charAt(0).toUpperCase() + hint.slice(1).toLowerCase();

    return this.prisma.category.create({
      data: {
        userId,
        name: categoryName,
        color: randomColor,
      },
    });
  }

  private async replyCategoryPicker(
    userId: string,
    responder: TelegramResponder,
  ): Promise<void> {
    const categories = await this.prisma.category.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    const keyboard = categories.map((category) => [
      {
        text: category.name,
        callback_data: `cat:${category.id}`,
      },
    ]);

    keyboard.push([{ text: '➕ Digitar outra categoria', callback_data: 'cat:custom' }]);

    await responder.reply('Escolha a nova categoria:', {
      replyMarkup: {
        inline_keyboard: keyboard,
      },
    });
  }

  private async replyLatestTransactions(userId: string, responder: TelegramResponder): Promise<void> {
    const latest = await this.prisma.transaction.findMany({
      where: { userId },
      orderBy: { date: 'desc' },
      take: 5,
      include: {
        category: { select: { name: true } },
        channel: { select: { name: true } },
      },
    });

    if (!latest.length) {
      await responder.reply('📭 Você ainda não possui transações registradas.');
      return;
    }

    const text = [
      '📋 Últimas 5 transações:',
      ...latest.map((tx) => {
        const type = tx.type === 'INCOME' ? '⬆️' : '⬇️';
        const channel = tx.channel?.name ? ` | ${tx.channel.name}` : '';
        return `${type} ${this.formatMoney(Number(tx.amount))} - ${tx.category.name}${channel}`;
      }),
    ].join('\n');

    await responder.reply(text, { replyMarkup: createMainKeyboard() });
  }

  private async adjustChannelFee(
    action: string,
    userId: string,
    responder: TelegramResponder,
  ): Promise<void> {
    const [prefix, direction, channelId] = action.split(':');
    if (prefix !== 'channel' || !direction || !channelId) {
      await responder.reply('⚠️ Não consegui entender essa ação de canal.');
      return;
    }

    const channel = await this.prisma.salesChannel.findFirst({ where: { id: channelId, userId } });
    if (!channel) {
      await responder.reply('⚠️ Canal não encontrado para atualização.');
      return;
    }

    const current = Number(channel.feePercent);
    const delta = direction === 'inc' ? 0.5 : -0.5;
    const nextFee = Math.min(100, Math.max(0, Number((current + delta).toFixed(4))));

    await this.prisma.salesChannel.updateMany({
      where: { id: channelId, userId },
      data: { feePercent: nextFee },
    });

    await responder.reply(`✅ Taxa de ${channel.name} atualizada para ${nextFee.toFixed(2)}%.`);
    await this.replyChannelsOverview(userId, responder);
  }

  private buildChannelKeyboard(channels: SalesChannel[]): TelegramInlineKeyboardMarkup {
    return {
      inline_keyboard: channels.flatMap((channel) => [
        [
          { text: `➖ ${channel.name}`, callback_data: `channel:dec:${channel.id}` },
          { text: `➕ ${channel.name}`, callback_data: `channel:inc:${channel.id}` },
        ],
      ]),
    };
  }

  private async replyChannelsOverview(userId: string, responder: TelegramResponder): Promise<void> {
    const channels = await this.prisma.salesChannel.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });

    if (!channels.length) {
      await responder.reply('📭 Você ainda não cadastrou canais.', {
        replyMarkup: createMainKeyboard(),
      });
      return;
    }

    const money = new Intl.NumberFormat('pt-BR', { style: 'percent', minimumFractionDigits: 2 });
    const text = [
      '🏪 Canais cadastrados:',
      ...channels.map((channel) => `• ${channel.name}: ${money.format(Number(channel.feePercent) / 100)}`),
      '',
      'Use os botões para ajustar a taxa de cada canal em ±0,5 ponto percentual.',
    ].join('\n');

    await responder.reply(text, { replyMarkup: this.buildChannelKeyboard(channels) });
  }

  private async requireUser(telegramId: string, responder: TelegramResponder): Promise<User | null> {
    const user = await this.prisma.user.findUnique({ where: { telegramId } });
    if (user) {
      return user;
    }

    await responder.reply('👋 Você ainda não está vinculado. Clique no botão abaixo para iniciar seu cadastro:', {
      replyMarkup: {
        inline_keyboard: [[{ text: '🚀 Iniciar Cadastro', callback_data: 'auth:start' }]],
      },
    });
    return null;
  }

  private getDateRange(period: ReportPeriod): {
    startDate: string;
    endDate: string;
    periodLabel: string;
  } {
    const now = new Date();

    if (period === 'last_7_days') {
      const end = new Date(now);
      const start = new Date(now);
      start.setDate(start.getDate() - 6);
      return {
        startDate: this.toDateOnly(start),
        endDate: this.toDateOnly(end),
        periodLabel: 'últimos 7 dias',
      };
    }

    if (period === 'previous_month') {
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const end = new Date(now.getFullYear(), now.getMonth(), 0);
      return {
        startDate: this.toDateOnly(start),
        endDate: this.toDateOnly(end),
        periodLabel: this.monthLabel(start),
      };
    }

    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return {
      startDate: this.toDateOnly(start),
      endDate: this.toDateOnly(end),
      periodLabel: this.monthLabel(start),
    };
  }

  private parseCustomPeriod(text: string): { startDate: string; endDate: string; label: string } | null {
    const matches = text.match(/\d{1,2}\/\d{1,2}\/\d{4}/g);
    if (!matches || matches.length < 2) {
      return null;
    }

    const [first, second] = matches;
    if (!first || !second) {
      return null;
    }

    const start = this.parseDateToken(first);
    const end = this.parseDateToken(second);
    if (!start || !end) {
      return null;
    }

    const [startDate, endDate] = start <= end ? [start, end] : [end, start];
    const label = `${this.formatDateDisplay(startDate)} a ${this.formatDateDisplay(endDate)}`;

    return { startDate, endDate, label };
  }

  private parseDateToken(token: string): string | null {
    const parts = token.split('/');
    if (parts.length !== 3) return null;

    const [dayStr, monthStr, yearStr] = parts;
    if (!dayStr || !monthStr || !yearStr) return null;
    const year = Number(yearStr);

    return this.normalizeDateParts(year, Number(monthStr), Number(dayStr));
  }

  private normalizeDateParts(year: number, month: number, day: number): string | null {
    if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
      return null;
    }

    if (month < 1 || month > 12 || day < 1 || day > 31) {
      return null;
    }

    const date = new Date(Date.UTC(year, month - 1, day));
    if (
      date.getUTCFullYear() !== year ||
      date.getUTCMonth() !== month - 1 ||
      date.getUTCDate() !== day
    ) {
      return null;
    }

    const mm = String(month).padStart(2, '0');
    const dd = String(day).padStart(2, '0');
    return `${year}-${mm}-${dd}`;
  }

  private formatDateDisplay(isoDate: string): string {
    const [year, month, day] = isoDate.split('-');
    return `${day}/${month}/${year}`;
  }

  private async downloadTelegramAudio(fileId: string): Promise<string> {
    const metaResponse = await fetch(
      `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getFile?file_id=${encodeURIComponent(fileId)}`,
    );

    if (!metaResponse.ok) {
      throw new Error('Falha ao obter metadados do áudio no Telegram');
    }

    const meta = (await metaResponse.json()) as {
      ok: boolean;
      result?: { file_path?: string };
    };

    const filePath = meta.result?.file_path;
    if (!meta.ok || !filePath) {
      throw new Error('Telegram não retornou o caminho do arquivo de áudio');
    }

    const fileResponse = await fetch(
      `https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${filePath}`,
    );

    if (!fileResponse.ok) {
      throw new Error('Falha ao baixar áudio do Telegram');
    }

    return Buffer.from(await fileResponse.arrayBuffer()).toString('base64');
  }

  private toDateOnly(date: Date): string {
    return date.toISOString().slice(0, 10);
  }

  private monthLabel(date: Date): string {
    return date.toLocaleDateString('pt-BR', { month: 'long' });
  }

  private formatMoney(value: number): string {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
  }

  private formatPhoneDisplay(phone?: string | null): string {
    if (!phone || phone.startsWith('tg_')) {
      return 'não informado';
    }
    
    const clean = phone.replace(/\D/g, '');
    
    if (clean.length === 11) {
      return `(${clean.substring(0, 2)}) ${clean.substring(2, 7)}-${clean.substring(7)}`;
    }
    
    if (clean.length === 10) {
      return `(${clean.substring(0, 2)}) ${clean.substring(2, 6)}-${clean.substring(6)}`;
    }
    
    if (clean.length === 12 || clean.length === 13) {
      const country = clean.substring(0, 2);
      const ddd = clean.substring(2, 4);
      const number = clean.substring(4);
      if (number.length === 9) {
        return `+${country} (${ddd}) ${number.substring(0, 5)}-${number.substring(5)}`;
      }
      if (number.length === 8) {
        return `+${country} (${ddd}) ${number.substring(0, 4)}-${number.substring(4)}`;
      }
    }

    return phone;
  }
}
