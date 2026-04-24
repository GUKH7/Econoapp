import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@/config/database';
import { calculateNetAmount } from '@/domain/finance/calculate-fees';
import {
  buildConfirmationMessage,
  isConfidenceAcceptable,
} from '@/domain/finance/transaction-rules';
import { env } from '@/config/env';
import {
  GeminiService,
  GeminiFinancialOutput,
  GeminiAudioOutput,
} from '@/services/ai/gemini.service';
import { TransactionRepository } from '@/modules/transactions/repositories/transaction.repository';
import { WhatsAppWebhookPayload } from './schemas/webhook-payload.schema';

@Injectable()
export class WhatsAppService {
  private readonly logger = new Logger(WhatsAppService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(GeminiService) private readonly geminiService: GeminiService,
    @Inject(TransactionRepository) private readonly transactionRepository: TransactionRepository,
  ) {}

  async handleIncomingMessage(payload: WhatsAppWebhookPayload): Promise<void> {
    const message = payload.entry[0]?.changes[0]?.value.messages?.[0];
    const contact = payload.entry[0]?.changes[0]?.value.contacts?.[0];

    if (!message || !contact) {
      this.logger.debug(
        'Payload sem mensagem ou contato (provável status de entrega/leitura) — ignorado silenciosamente',
      );
      return;
    }

    const messageId = message.id;
    const waId = contact.wa_id;
    const messageType = message.type;
    const phone = `+${waId}`;

    this.logger.log(
      `Webhook recebido | status=received | messageId=${messageId} | waId=${waId} | type=${messageType}`,
    );

    // Deduplicação persistente via banco
    const alreadyProcessed = await this.transactionRepository.findByWhatsappMessageId(messageId);
    if (alreadyProcessed) {
      this.logger.warn(
        `Webhook duplicado ignorado | messageId=${messageId} | transactionId=${alreadyProcessed.id}`,
      );
      return;
    }

    // Tipos não suportados (imagem, sticker, localização, etc.) — responder ao usuário
    if (message.type !== 'text' && message.type !== 'audio') {
      this.logger.debug(`Tipo de mensagem não suportado: ${message.type} | messageId=${messageId}`);
      await this.markMessageAsRead(messageId);
      await this.sendWhatsAppMessage(
        phone,
        '⚠️ Por enquanto só processo mensagens de texto e áudio. Tente descrever a transação por escrito ou em um áudio!',
      );
      return;
    }

    // Marcar como lida imediatamente — exibe o tique azul no celular do usuário
    await this.markMessageAsRead(messageId);

    // Verificar se o usuário está cadastrado
    const user = await this.prisma.user.findUnique({ where: { phone } });
    if (!user) {
      this.logger.warn(
        `Webhook ignorado | status=ignored_user_not_found | messageId=${messageId} | waId=${waId} | phone=${phone}`,
      );
      await this.sendWhatsAppMessage(
        phone,
        '👋 Olá! Seu número ainda não está cadastrado no EconoApp.\n\nBaixe o app e crie sua conta para começar a registrar suas transações por aqui! 🚀',
      );
      return;
    }

    let description: string;
    let extracted: GeminiFinancialOutput;

    // Busca canais e categorias do usuário para dar contexto ao Gemini
    const [channels, categories] = await Promise.all([
      this.prisma.salesChannel.findMany({ where: { userId: user.id }, select: { name: true } }),
      this.prisma.category.findMany({ where: { userId: user.id }, select: { name: true } }),
    ]);
    const aiContext = {
      channelNames: channels.map((c) => c.name),
      categoryNames: categories.map((c) => c.name),
    };

    if (message.type === 'text') {
      description = (message as { type: 'text'; text: { body: string } }).text.body;
      extracted = await this.geminiService.extractFinancialData(description, aiContext);
    } else {
      // Gemini multimodal: transcreve e extrai em uma única chamada
      const audioResult: GeminiAudioOutput = await this.geminiService.extractFinancialDataFromAudio(
        (message as { type: 'audio'; audio: { id: string } }).audio.id,
        aiContext,
      );
      description = audioResult.transcription;
      extracted = audioResult;
    }

    if (!isConfidenceAcceptable(extracted.confidence)) {
      this.logger.warn(
        `Webhook processado | status=low_confidence | messageId=${messageId} | waId=${waId} | type=${messageType} | confidence=${extracted.confidence}`,
      );
      await this.sendWhatsAppMessage(
        phone,
        '🤔 Não entendi com segurança. Pode reenviar com mais detalhes?\n\nExemplo: _"vendi 150 reais no Shopee"_ ou _"paguei 30 de frete"_',
      );
      return;
    }

    let channel = null;
    if (extracted.channelHint) {
      channel = await this.resolveChannel(user.id, extracted.channelHint);
    }

    let hint = extracted.categoryHint;
    if (!hint || hint.trim() === '') hint = 'Outros';

    let category = await this.prisma.category.findFirst({
      where: {
        userId: user.id,
        name: { contains: hint, mode: 'insensitive' },
      },
    });

    if (!category) {
      const letters = '0123456789ABCDEF';
      let randomColor = '#';
      for (let i = 0; i < 6; i++) {
        randomColor += letters[Math.floor(Math.random() * 16)];
      }

      const categoryName = hint.charAt(0).toUpperCase() + hint.slice(1).toLowerCase();

      category = await this.prisma.category.create({
        data: { name: categoryName, color: randomColor, userId: user.id },
      });
    }

    const netAmount = channel
      ? calculateNetAmount(extracted.amount, Number(channel.feePercent))
      : extracted.amount;

    const transaction = await this.transactionRepository.create({
      description,
      amount: extracted.amount,
      netAmount,
      type: extracted.type,
      source: message.type === 'audio' ? 'AUDIO' : 'WHATSAPP',
      categoryId: category.id,
      ...(channel?.id ? { channelId: channel.id } : {}),
      date: new Date(),
      userId: user.id,
      whatsappMessageId: messageId,
    });

    const confirmation = buildConfirmationMessage(
      transaction.description,
      Number(transaction.amount),
      Number(transaction.netAmount),
      channel?.name ?? null,
    );

    await this.sendWhatsAppMessage(phone, confirmation);
    this.logger.log(
      `Webhook processado | status=processed | messageId=${messageId} | waId=${waId} | type=${messageType} | transactionId=${transaction.id}`,
    );
  }

  /**
   * Marca a mensagem recebida como lida.
   * Exibe o tique azul (✓✓) no WhatsApp do usuário imediatamente.
   * Nunca lança erro — falha silenciosamente com log de aviso.
   */
  private async markMessageAsRead(messageId: string): Promise<void> {
    const url = `https://graph.facebook.com/v20.0/${env.WHATSAPP_PHONE_ID}/messages`;
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.WHATSAPP_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          status: 'read',
          message_id: messageId,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        this.logger.warn(
          `Falha ao marcar como lida | messageId=${messageId} | status=${response.status} | error=${error}`,
        );
      } else {
        this.logger.debug(`Mensagem marcada como lida | messageId=${messageId}`);
      }
    } catch (err) {
      this.logger.warn(
        `Erro de rede ao marcar como lida | messageId=${messageId} | ${String(err)}`,
      );
    }
  }

  /**
   * Envia uma mensagem de texto via WhatsApp Cloud API.
   * Nunca lança erro — falha silenciosamente com log de erro detalhado.
   * Isso garante que o webhook sempre retorne 200 para a Meta,
   * mesmo que o envio da resposta falhe (ex: token expirado).
   */
  private async sendWhatsAppMessage(to: string, body: string): Promise<void> {
    const url = `https://graph.facebook.com/v20.0/${env.WHATSAPP_PHONE_ID}/messages`;
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.WHATSAPP_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to,
          type: 'text',
          text: { body },
        }),
      });

      const responseText = await response.text();

      if (!response.ok) {
        this.logger.error(
          `Falha ao enviar mensagem WhatsApp | to=${to} | status=${response.status} | body=${responseText}`,
        );
        // Se aparecer status 401: o WHATSAPP_TOKEN expirou — gere um novo token
        // no Meta Developer Portal → WhatsApp → API Setup → "Gerar token de acesso"
        // e atualize a variável WHATSAPP_TOKEN no seu .env
      } else {
        this.logger.log(`Mensagem WhatsApp enviada | to=${to} | response=${responseText}`);
      }
    } catch (err) {
      this.logger.error(`Erro de rede ao enviar mensagem WhatsApp | to=${to} | ${String(err)}`);
    }
  }

  private async resolveChannel(userId: string, hint: string) {
    // 1. Match exato (case insensitive)
    const exact = await this.prisma.salesChannel.findFirst({
      where: { userId, name: { equals: hint, mode: 'insensitive' } },
    });
    if (exact) return exact;

    // 2. Match parcial (busca nos dois sentidos)
    const partial = await this.prisma.salesChannel.findFirst({
      where: { userId, name: { contains: hint, mode: 'insensitive' } },
    });
    if (partial) return partial;

    // 2b. Match reverso — canal existente contido no hint (ex: "Shopee" dentro de "Shopee Brasil")
    const allChannels = await this.prisma.salesChannel.findMany({ where: { userId } });
    const hintLower = hint.toLowerCase();
    const reverseMatch = allChannels.find((ch) => hintLower.includes(ch.name.toLowerCase()));
    if (reverseMatch) return reverseMatch;

    // 3. Fuzzy matching — trata erros de digitação
    const normalizedHint = this.normalizeForFuzzy(hint);
    let bestMatch: (typeof allChannels)[0] | null = null;
    let bestScore = 0;

    for (const channel of allChannels) {
      const normalizedName = this.normalizeForFuzzy(channel.name);
      if (normalizedName.includes(normalizedHint) || normalizedHint.includes(normalizedName)) {
        return channel;
      }
      const score = this.similarity(normalizedHint, normalizedName);
      if (score > bestScore) {
        bestScore = score;
        bestMatch = channel;
      }
    }

    if (bestScore >= 0.6 && bestMatch) return bestMatch;

    // 4. Auto-criar canal novo com taxa 0% — o usuário ajusta depois
    return this.prisma.salesChannel.create({
      data: {
        userId,
        name: hint,
        feePercent: 0,
      },
    });
  }

  private normalizeForFuzzy(text: string): string {
    return text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]/g, '');
  }

  private similarity(a: string, b: string): number {
    if (a === b) return 1;
    const longer = a.length > b.length ? a : b;
    const shorter = a.length > b.length ? b : a;
    if (longer.length === 0) return 1;
    const costs: number[] = [];
    for (let i = 0; i <= longer.length; i++) {
      let lastValue = i;
      for (let j = 0; j <= shorter.length; j++) {
        if (i === 0) {
          costs[j] = j;
        } else if (j > 0) {
          let newValue = costs[j - 1]!;
          if (longer[i - 1] !== shorter[j - 1]) {
            newValue = Math.min(Math.min(newValue, lastValue), costs[j]!) + 1;
          }
          costs[j - 1] = lastValue;
          lastValue = newValue;
        }
      }
      if (i > 0) costs[shorter.length]! = lastValue;
    }
    return (longer.length - costs[shorter.length]!) / longer.length;
  }
}
