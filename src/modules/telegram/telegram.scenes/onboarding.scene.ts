import { Inject, Injectable } from '@nestjs/common';
import { hash } from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { Ctx, On, SceneEnter, Wizard, WizardStep } from 'nestjs-telegraf';
import { Scenes, Context } from 'telegraf';
import { PrismaService } from '@/config/database';
import { createMainKeyboard } from '../keyboards/main.keyboard';

interface OnboardingSessionData extends Scenes.WizardSessionData {
  name?: string;
}

type OnboardingContext = Context & Scenes.WizardContext<OnboardingSessionData>;

@Injectable()
@Wizard('telegram-onboarding')
export class OnboardingScene {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  @SceneEnter()
  async onSceneEnter(@Ctx() ctx: OnboardingContext): Promise<void> {
    await ctx.reply('👋 Vamos começar! Qual é o seu nome?');
    ctx.wizard.selectStep(1);
  }

  @WizardStep(1)
  @On('text')
  async onReceiveName(@Ctx() ctx: OnboardingContext): Promise<void> {
    if (!ctx.message || !('text' in ctx.message)) {
      await ctx.reply('Por favor, envie seu nome em texto.');
      return;
    }

    const name = ctx.message.text.trim();
    if (!name) {
      await ctx.reply('Nome inválido. Envie seu nome novamente.');
      return;
    }

    const telegramId = ctx.from ? String(ctx.from.id) : '';
    if (!telegramId) {
      await ctx.reply('Não consegui identificar seu Telegram. Tente novamente com /start.');
      await ctx.scene.leave();
      return;
    }

    const existing = await this.prisma.user.findUnique({ where: { telegramId } });
    if (!existing) {
      const passwordHash = await hash(randomUUID(), 10);
      await this.prisma.user.create({
        data: {
          name,
          telegramId,
          phone: `tg_${telegramId}`,
          passwordHash,
          email: null,
        },
      });
    }

    await ctx.reply(
      `✅ Cadastro concluído, ${name}!\nAgora você já pode registrar transações por texto ou áudio.\n\n💡 *Exemplo:* "Vendi 50 reais de camiseta na Shopee"`,
      {
        reply_markup: createMainKeyboard(),
        parse_mode: 'Markdown',
      },
    );

    await ctx.scene.leave();
  }
}
