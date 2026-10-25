import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '@/config/database';
import { HealthController } from '@/modules/health/health.controller';

describe('HealthController', () => {
  it('mantem liveness sem executar consulta no banco', () => {
    const query = vi.fn();
    const controller = new HealthController({ $queryRaw: query } as unknown as PrismaService);

    expect(controller.check()).toMatchObject({ status: 'ok' });
    expect(query).not.toHaveBeenCalled();
  });

  it('confirma prontidao apenas quando PostgreSQL responde', async () => {
    const query = vi.fn().mockResolvedValue([{ ok: 1 }]);
    const controller = new HealthController({ $queryRaw: query } as unknown as PrismaService);

    await expect(controller.ready()).resolves.toEqual({ status: 'ok' });
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('retorna 503 sem detalhes do banco quando a consulta falha', async () => {
    const query = vi.fn().mockRejectedValue(new Error('Sensitive database internals'));
    const controller = new HealthController({ $queryRaw: query } as unknown as PrismaService);

    await expect(controller.ready()).rejects.toMatchObject({
      status: 503,
      response: { status: 'unavailable' },
    });
    expect(ServiceUnavailableException).toBeDefined();
  });
});
