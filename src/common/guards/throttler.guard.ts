import { ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Ignora contextos não-HTTP (ex: Telegraf/Telegram bot updates)
    if (context.getType() !== 'http') return true;
    return super.canActivate(context);
  }

  protected getTracker(request: Record<string, unknown>): Promise<string> {
    return Promise.resolve(clientIpFromRequest(request));
  }
}

export function clientIpFromRequest(request: Record<string, unknown>): string {
  const headers = request.headers as Record<string, string | string[] | undefined> | undefined;
  const forwarded = headers?.['x-forwarded-for'];
  const forwardedValue = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  const clientIp = forwardedValue?.split(',')[0]?.trim();
  return clientIp || String(request.ip || 'unknown');
}
