import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { ForbiddenException } from '@/common/errors/app.exception';
import { AuthenticatedRequest } from '@/common/types';
import { PrismaService } from '@/config/database';
import { isWhatsappAdminPhone } from '@/modules/auth/auth.service';

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const userId = request.user?.sub;
    if (!userId) throw new ForbiddenException('Acesso administrativo não autorizado.');
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { phone: true } });
    if (!user || !isWhatsappAdminPhone(user.phone)) {
      throw new ForbiddenException('Acesso administrativo não autorizado.');
    }
    return true;
  }
}
