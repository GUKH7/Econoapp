import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { env } from './env';
import { PrismaService } from './database';

export const SYSTEM_SETTING_KEYS = {
  whatsappProviderApiToken: 'whatsapp.provider.api-token',
} as const;

const ENCRYPTION_VERSION = 'v1';

@Injectable()
export class SystemSettingsService {
  private readonly logger = new Logger(SystemSettingsService.name);
  private readonly encryptionKey = createHash('sha256').update(env.JWT_SECRET).digest();

  constructor(private readonly prisma: PrismaService) {}

  async setSecret(key: string, value: string): Promise<void> {
    const normalized = value.trim();
    if (!normalized) throw new BadRequestException('A credencial não pode ficar vazia.');

    await this.prisma.systemSetting.upsert({
      where: { key },
      create: { key, value: this.encrypt(normalized) },
      update: { value: this.encrypt(normalized) },
    });
  }

  async getSecret(key: string): Promise<string> {
    const setting = await this.prisma.systemSetting.findUnique({ where: { key } });
    if (!setting) return '';

    try {
      return this.decrypt(setting.value);
    } catch {
      this.logger.error(`Não foi possível descriptografar a configuração ${key}.`);
      return '';
    }
  }

  async hasSecret(key: string): Promise<boolean> {
    return Boolean(await this.prisma.systemSetting.findUnique({ where: { key }, select: { key: true } }));
  }

  private encrypt(value: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.encryptionKey, iv);
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [ENCRYPTION_VERSION, iv.toString('base64url'), tag.toString('base64url'), encrypted.toString('base64url')].join(':');
  }

  private decrypt(value: string): string {
    const [version, iv, tag, encrypted] = value.split(':');
    if (version !== ENCRYPTION_VERSION || !iv || !tag || !encrypted) throw new Error('Formato inválido');

    const decipher = createDecipheriv('aes-256-gcm', this.encryptionKey, Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(encrypted, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  }
}
