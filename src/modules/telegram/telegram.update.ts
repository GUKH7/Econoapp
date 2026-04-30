import { Inject, Injectable } from '@nestjs/common';
import { Action, Command, Ctx, On, Start, Update } from 'nestjs-telegraf';
import { Context, Scenes } from 'telegraf';
import {
  TelegramCallbackInput,
  TelegramResponder,
  TelegramService,
  TelegramTextInput,
  TelegramVoiceInput,
} from './telegram.service';

interface OnboardingSceneState extends Scenes.WizardSessionData {
  name?: string;
}

type BotContext = Context &
  Scenes.WizardContext<OnboardingSceneState> & {
    message?: { text?: string; voice?: { file_id: string; mime_type?: string } };
    callbackQuery?: { data?: string };
  };

type ReplyOptions = Parameters<Context['reply']>[1];
type ReplyWithPhotoOptions = Parameters<Context['replyWithPhoto']>[1];
type EditMessageOptions = Parameters<Context['editMessageText']>[1];

@Update()
@Injectable()
export class TelegramUpdate {
  constructor(@Inject(TelegramService) private readonly telegramService: TelegramService) {}

  @Start()
  async onStart(@Ctx() ctx: BotContext): Promise<void> {
    const actor = this.buildActor(ctx);
    await this.telegramService.handleStart(actor, this.createResponder(ctx));
  }

  @Command('saldo')
  async onSaldo(@Ctx() ctx: BotContext): Promise<void> {
    const actor = this.buildActor(ctx);
    await this.telegramService.handleSaldo(actor, this.createResponder(ctx));
  }

  @Command('resumo')
  async onResumo(@Ctx() ctx: BotContext): Promise<void> {
    const actor = this.buildActor(ctx);
    await this.telegramService.handleResumo(actor, this.createResponder(ctx));
  }

  @Command('canais')
  async onCanais(@Ctx() ctx: BotContext): Promise<void> {
    const actor = this.buildActor(ctx);
    await this.telegramService.handleChannels(actor, this.createResponder(ctx));
  }

  @Command('ajuda')
  async onAjuda(@Ctx() ctx: BotContext): Promise<void> {
    const actor = this.buildActor(ctx);
    await this.telegramService.handleHelp(actor, this.createResponder(ctx));
  }

  @Command(['configuracoes', 'config'])
  async onConfiguracoes(@Ctx() ctx: BotContext): Promise<void> {
    const actor = this.buildActor(ctx);
    await this.telegramService.handleSettings(actor, this.createResponder(ctx));
  }

  @On('text')
  async onText(@Ctx() ctx: BotContext): Promise<void> {
    const text = this.extractText(ctx);
    if (!text || text.startsWith('/')) {
      return;
    }

    const payload: TelegramTextInput = {
      ...this.buildActor(ctx),
      text,
    };

    await this.telegramService.handleText(payload, this.createResponder(ctx));
  }

  @On('voice')
  async onVoice(@Ctx() ctx: BotContext): Promise<void> {
    const voiceMessage = this.extractVoiceMessage(ctx);
    if (!voiceMessage) {
      return;
    }

    const payload: TelegramVoiceInput = {
      ...this.buildActor(ctx),
      fileId: voiceMessage.voice.file_id,
      ...(voiceMessage.voice.mime_type ? { mimeType: voiceMessage.voice.mime_type } : {}),
    };

    await this.telegramService.handleVoice(payload, this.createResponder(ctx));
  }

  @Action(/.+/)
  async onAction(@Ctx() ctx: BotContext): Promise<void> {
    const callbackData = this.extractCallbackData(ctx);
    if (!callbackData) {
      return;
    }

    const payload: TelegramCallbackInput = {
      ...this.buildActor(ctx),
      action: callbackData,
    };

    await this.telegramService.handleCallbackQuery(payload, this.createResponder(ctx));
  }

  private createResponder(ctx: BotContext): TelegramResponder {
    return {
      reply: async (text, options) => {
        const replyOptions: ReplyOptions = {};
        if (options?.replyMarkup) {
          replyOptions.reply_markup = options.replyMarkup;
        }
        if (options?.parseMode) {
          replyOptions.parse_mode = options.parseMode;
        }
        await ctx.reply(text, replyOptions);
      },
      replyWithPhoto: async (photo, options) => {
        const replyOptions: ReplyWithPhotoOptions = {};
        if (options?.caption) {
          replyOptions.caption = options.caption;
        }
        if (options?.replyMarkup) {
          replyOptions.reply_markup = options.replyMarkup;
        }
        await ctx.replyWithPhoto({ source: photo }, replyOptions);
      },
      editMessage: async (text, options) => {
        const replyOptions: EditMessageOptions = {};
        if (options?.replyMarkup && 'inline_keyboard' in options.replyMarkup) {
          replyOptions.reply_markup = options.replyMarkup;
        }
        if (options?.parseMode) {
          replyOptions.parse_mode = options.parseMode;
        }
        await ctx.editMessageText(text, replyOptions);
      },
      answerCallback: async (text) => {
        if (ctx.callbackQuery) {
          await ctx.answerCbQuery(text);
        }
      },
      enterScene: async (sceneId) => {
        if (ctx.scene) {
          await ctx.scene.enter(sceneId);
        }
      },
    };
  }

  private buildActor(ctx: BotContext): { telegramId: string; chatId: number; firstName?: string } {
    const sender = ctx.from;
    const chat = ctx.chat;

    return {
      telegramId: sender ? String(sender.id) : '',
      chatId: chat ? chat.id : 0,
      ...(sender?.first_name ? { firstName: sender.first_name } : {}),
    };
  }

  private extractText(ctx: BotContext): string {
    const message = ctx.message;
    if (!message || !('text' in message)) {
      return '';
    }

    return message.text.trim();
  }

  private extractVoiceMessage(ctx: BotContext): { voice: { file_id: string; mime_type?: string } } | null {
    const message = ctx.message;
    if (!message || !message.voice) {
      return null;
    }

    return { voice: message.voice };
  }

  private extractCallbackData(ctx: BotContext): string {
    const callback = ctx.callbackQuery;
    if (!callback?.data) {
      return '';
    }

    return callback.data;
  }
}
