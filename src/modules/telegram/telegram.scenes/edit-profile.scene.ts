import { Inject, Injectable } from '@nestjs/common';
import { Ctx, On, SceneEnter, Wizard, WizardStep } from 'nestjs-telegraf';
import { Scenes, Context } from 'telegraf';
import { PrismaService } from '@/config/database';
import { createMainKeyboard } from '../keyboards/main.keyboard';

interface EditProfileSessionData extends Scenes.WizardSessionData {
  phone?: string;
}

type EditProfileContext = Context & Scenes.WizardContext<EditProfileSessionData>;

@Injectable()
@Wizard('telegram-edit-profile')
export class EditProfileScene {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  @SceneEnter()
  async onSceneEnter(@Ctx() ctx: EditProfileContext): Promise<void> {
    await ctx.reply('📱 Digite seu número de telefone (com DDD), ou envie "-" para pular:');
    ctx.wizard.selectStep(1);
  }

  @WizardStep(1)
  @On('text')
  async onReceivePhone(@Ctx() ctx: EditProfileContext): Promise<void> {
    if (!ctx.message || !('text' in ctx.message)) return;
    
    const text = ctx.message.text.trim();
    if (text !== '-') {
      // Remove tudo que não for número (ex: (11) 99999-9999 -> 11999999999)
      const cleanPhone = text.replace(/\D/g, '');
      ctx.scene.session.phone = cleanPhone;
    }

    await ctx.reply('📧 Agora digite seu endereço de email, ou envie "-" para pular:');
    ctx.wizard.next();
  }

  @WizardStep(2)
  @On('text')
  async onReceiveEmail(@Ctx() ctx: EditProfileContext): Promise<void> {
    if (!ctx.message || !('text' in ctx.message)) return;

    const telegramId = ctx.from ? String(ctx.from.id) : '';
    if (!telegramId) {
      await ctx.scene.leave();
      return;
    }

    const text = ctx.message.text.trim();
    const email = text !== '-' ? text : undefined;
    const phone = ctx.scene.session.phone;

    const updateData: { phone?: string; email?: string } = {};
    if (phone) updateData.phone = phone;
    if (email) updateData.email = email;

    if (Object.keys(updateData).length > 0) {
      await this.prisma.user.update({
        where: { telegramId },
        data: updateData,
      });
      await ctx.reply('✅ Perfil atualizado com sucesso!', { reply_markup: createMainKeyboard() });
    } else {
      await ctx.reply('Nenhuma alteração foi feita no seu perfil.', { reply_markup: createMainKeyboard() });
    }

    await ctx.scene.leave();
  }
}
