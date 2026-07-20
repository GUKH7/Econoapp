import { HttpException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { AdminLoginAttemptsService } from '@/modules/auth/admin-login-attempts.service';

describe('AdminLoginAttemptsService', () => {
  it('não bloqueia acessos válidos ou verificações bem-sucedidas', () => {
    const service = new AdminLoginAttemptsService();
    const key = service.key('203.0.113.10', 'admin');
    for (let index = 0; index < 20; index += 1) {
      service.assertAllowed(key, 1_000 + index);
      service.clear(key);
    }
  });

  it('bloqueia somente depois de cinco falhas na mesma janela', () => {
    const service = new AdminLoginAttemptsService();
    const key = service.key('203.0.113.10', 'admin');
    for (let index = 0; index < 5; index += 1) {
      service.assertAllowed(key, 1_000 + index);
      service.recordFailure(key, 1_000 + index);
    }
    expect(() => service.assertAllowed(key, 1_010)).toThrow(HttpException);
  });

  it('isola tentativas por IP e login', () => {
    const service = new AdminLoginAttemptsService();
    const blocked = service.key('203.0.113.10', 'admin');
    const otherIp = service.key('203.0.113.11', 'admin');
    for (let index = 0; index < 5; index += 1) service.recordFailure(blocked, 1_000 + index);
    expect(() => service.assertAllowed(otherIp, 1_010)).not.toThrow();
  });
});
