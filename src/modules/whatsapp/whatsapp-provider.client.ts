import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { env } from '@/config/env';
import { SendWhatsappMessageDto } from './dto/send-whatsapp-message.dto';
import { WhatsappStatus, WhatsappStatusResponse } from './whatsapp.types';

@Injectable()
export class WhatsappProviderClient {
  private readonly baseUrl = env.WHATSAPP_BOT_API_URL.replace(/\/+$/, '');
  private readonly apiToken = env.WHATSAPP_BOT_API_TOKEN.trim();
  private readonly sendMessagePath = this.normalizePath(env.WHATSAPP_BOT_SEND_MESSAGE_PATH);

  async getStatus(): Promise<WhatsappStatusResponse> {
    const response = await this.request<unknown>('/status');
    return this.normalizeStatusResponse(response);
  }

  async restart(): Promise<WhatsappStatusResponse> {
    const response = await this.request<unknown>('/restart');
    return this.normalizeStatusResponse(response);
  }

  async sendMessage(dto: SendWhatsappMessageDto): Promise<unknown> {
    const phone = String(dto.phone || dto.number || dto.to || '').replace(/\D/g, '');
    const message = String(dto.message || dto.text || '').trim();

    if (!phone) throw new BadRequestException('Informe o telefone com DDI, exemplo: 5511999999999.');
    if (!message) throw new BadRequestException('Informe a mensagem para envio.');
    if (!phone.startsWith('55') || phone.length < 12) {
      throw new BadRequestException('O telefone deve incluir DDI do Brasil, exemplo: 5511999999999.');
    }

    const status = await this.getStatus();
    if (status.status !== 'conectado') {
      throw new ServiceUnavailableException('WhatsApp nao esta pronto.');
    }

    return this.request(this.sendMessagePath, {
      method: 'POST',
      body: JSON.stringify({ phone, message }),
    });
  }

  private normalizeStatusResponse(response: unknown): WhatsappStatusResponse {
    const data = this.asRecord(response);
    const rawStatus = String(data?.status || data?.state || 'iniciando').toLowerCase();
    const qrcode = String(data?.qrcode || data?.qrCode || data?.qr || data?.base64 || '');

    return {
      status: this.isKnownStatus(rawStatus) ? rawStatus : 'iniciando',
      ...(qrcode ? { qrcode } : {}),
    };
  }

  private isKnownStatus(value: string): value is WhatsappStatus {
    return ['aguardando_qr', 'conectado', 'iniciando', 'reconectando'].includes(value);
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);

    try {
      const response = await fetch(`${this.baseUrl}${this.normalizePath(path)}`, {
        ...init,
        headers: {
          'Content-Type': 'application/json',
          ...(this.apiToken ? { Authorization: `Bearer ${this.apiToken}` } : {}),
          ...init.headers,
        },
        signal: controller.signal,
      });
      const body = (await response.json().catch(() => null)) as unknown;
      const bodyRecord = this.asRecord(body);

      if (!response.ok) {
        const message =
          String(bodyRecord?.message || bodyRecord?.error || '') || 'Falha ao comunicar com a API WhatsApp.';
        throw new ServiceUnavailableException(message);
      }

      return this.unwrapProviderData<T>(body);
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      if (error instanceof Error && error.name === 'AbortError') {
        throw new ServiceUnavailableException('A API WhatsApp demorou para responder.');
      }
      throw new ServiceUnavailableException('Nao foi possivel comunicar com a API WhatsApp.');
    } finally {
      clearTimeout(timeout);
    }
  }

  private normalizePath(path: string): string {
    return `/${path.replace(/^\/+/, '')}`;
  }

  private unwrapProviderData<T>(body: unknown): T {
    const record = this.asRecord(body);
    if (record && 'data' in record && record.data !== undefined) {
      return record.data as T;
    }
    return body as T;
  }

  private asRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    return value as Record<string, unknown>;
  }
}
