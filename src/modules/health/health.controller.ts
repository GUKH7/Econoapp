import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { Public } from '@/common/decorators/public.decorator';
import { PrismaService } from '@/config/database';

@Public()
@Controller('health')
export class HealthController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  // Liveness: nao depende do banco e continua compativel com o Render.
  @Get()
  check(): { status: string; timestamp: string } {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  // Readiness: sinal minimo de acesso ao PostgreSQL, sem dados sensiveis.
  @Get('ready')
  async ready(): Promise<{ status: 'ok' }> {
    let timer: ReturnType<typeof setTimeout> | undefined;

    try {
      await Promise.race([
        this.prisma.$queryRaw`SELECT 1`,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error('Database readiness timeout')), 5_000);
        }),
      ]);
      return { status: 'ok' };
    } catch {
      throw new ServiceUnavailableException({ status: 'unavailable' });
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
