import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AccountAccessStatus } from '@prisma/client';
import { ALLOW_INACTIVE_KEY } from '@/common/decorators/allow-inactive.decorator';
import { IS_PUBLIC_KEY } from '@/common/decorators/public.decorator';
import { ForbiddenException, UnauthorizedException } from '@/common/errors/app.exception';
import { AuthenticatedRequest } from '@/common/types';
import { PrismaService } from '@/config/database';
import { isAdminIdentity } from '@/modules/auth/auth.service';

@Injectable()
export class AccountAccessGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.user?.sub) throw new UnauthorizedException('Usuário não autenticado');

    const user = await this.prisma.user.findUnique({
      where: { id: request.user.sub },
      select: { phone: true, email: true, accessStatus: true, paidUntil: true },
    });
    if (!user) throw new UnauthorizedException('Usuário não encontrado');
    if (isAdminIdentity(user.phone, user.email)) return true;
    if (this.reflector.getAllAndOverride<boolean>(ALLOW_INACTIVE_KEY, targets)) return true;

    if (user.accessStatus === AccountAccessStatus.PENDING) {
      throw new ForbiddenException('Seu acesso está aguardando liberação do administrador.');
    }
    if (user.accessStatus === AccountAccessStatus.SUSPENDED) {
      throw new ForbiddenException('Seu acesso está suspenso. Fale com o suporte do Din.');
    }
    if (user.paidUntil && user.paidUntil < new Date()) {
      throw new ForbiddenException('Seu período de acesso terminou. Renove o pagamento para continuar.');
    }
    return true;
  }
}
