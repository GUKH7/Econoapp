import { Injectable, NestMiddleware } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { NextFunction, Response } from 'express';
import { env } from '@/config/env';
import { UnauthorizedException } from '@/common/errors/app.exception';
import { AuthenticatedRequest } from '@/common/types';

@Injectable()
export class WebhookVerifyMiddleware implements NestMiddleware {
  use(req: AuthenticatedRequest, _: Response, next: NextFunction): void {
    if (req.method !== 'POST') {
      return next();
    }

    const signatureHeader = req.header('x-hub-signature-256');
    if (!signatureHeader) {
      throw new UnauthorizedException('Assinatura do webhook ausente');
    }

    if (!req.rawBody) {
      throw new UnauthorizedException('Raw body ausente para validação da assinatura');
    }

    // Meta signs webhook payloads with the app secret (not the access token).
    const webhookSecret = env.WHATSAPP_APP_SECRET ?? env.WHATSAPP_TOKEN;
    const expected = `sha256=${createHmac('sha256', webhookSecret).update(req.rawBody).digest('hex')}`;
    const expectedBuffer = Buffer.from(expected);
    const receivedBuffer = Buffer.from(signatureHeader);

    if (expectedBuffer.length !== receivedBuffer.length) {
      throw new UnauthorizedException('Assinatura inválida');
    }

    if (!timingSafeEqual(expectedBuffer, receivedBuffer)) {
      throw new UnauthorizedException('Assinatura inválida');
    }

    next();
  }
}
