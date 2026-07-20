import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaService } from '@/config/database';
import { SystemSettingsService } from '@/config/system-settings.service';

describe('SystemSettingsService', () => {
  let encryptedValue = '';
  let service: SystemSettingsService;
  let prisma: {
    systemSetting: {
      upsert: ReturnType<typeof vi.fn>;
      findUnique: ReturnType<typeof vi.fn>;
    };
  };

  beforeEach(() => {
    encryptedValue = '';
    prisma = {
      systemSetting: {
        upsert: vi.fn(async ({ create, update }) => {
          encryptedValue = create?.value || update.value;
          return { key: create?.key || 'whatsapp.provider.api-token', value: encryptedValue };
        }),
        findUnique: vi.fn(async ({ select }) => {
          if (!encryptedValue) return null;
          return select ? { key: 'whatsapp.provider.api-token' } : { value: encryptedValue };
        }),
      },
    };
    service = new SystemSettingsService(prisma as unknown as PrismaService);
  });

  it('criptografa a credencial antes de persistir e consegue recuperá-la', async () => {
    const token = 'token-super-seguro-com-mais-de-trinta-caracteres';

    await service.setSecret('whatsapp.provider.api-token', token);

    expect(encryptedValue).not.toContain(token);
    expect(encryptedValue).toMatch(/^v1:/);
    await expect(service.getSecret('whatsapp.provider.api-token')).resolves.toBe(token);
    await expect(service.hasSecret('whatsapp.provider.api-token')).resolves.toBe(true);
  });
});
