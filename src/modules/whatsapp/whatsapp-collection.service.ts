import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { BusinessEntryStatus, BusinessEntryType } from '@prisma/client';
import { PrismaService } from '@/config/database';
import { WhatsappQueueService } from './whatsapp-queue.service';

@Injectable()
export class WhatsappCollectionService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(WhatsappQueueService) private readonly queue: WhatsappQueueService,
  ) {}

  async sendReceivableReminder(userId: string, entryId: string) {
    const entry = await this.prisma.businessEntry.findFirst({
      where: { id: entryId, userId },
      include: {
        contact: { select: { name: true, phone: true } },
        user: { select: { name: true } },
      },
    });
    if (!entry) throw new NotFoundException('Conta a receber não encontrada.');
    if (entry.type !== BusinessEntryType.RECEIVABLE || entry.status !== BusinessEntryStatus.PENDING) {
      throw new BadRequestException('Somente contas a receber pendentes podem gerar cobrança.');
    }
    const phone = String(entry.contact?.phone ?? '').replace(/\D/g, '');
    if (phone.length < 10) throw new BadRequestException('Cadastre um telefone válido para esse cliente.');
    const normalizedPhone = phone.startsWith('55') ? phone : `55${phone}`;
    const message = [
      `Olá, ${entry.contact?.name ?? entry.counterparty}.`,
      `${entry.user.name} enviou um lembrete sobre ${entry.title}.`,
      `Valor pendente: ${Number(entry.amount).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}.`,
      `Vencimento: ${entry.dueDate.toLocaleDateString('pt-BR', { timeZone: 'UTC' })}.`,
      '',
      'Se você já realizou o pagamento, desconsidere esta mensagem e envie o comprovante diretamente ao responsável.',
    ].join('\n');
    const queued = await this.queue.enqueueOutbound({ phone: normalizedPhone, message });
    return { queued: true, outboxId: queued.id, phone: normalizedPhone };
  }
}
