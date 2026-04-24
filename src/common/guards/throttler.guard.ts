import { ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Ignora contextos não-HTTP (ex: Telegraf/Telegram bot updates)
    if (context.getType() !== 'http') return true;
    return super.canActivate(context);
  }
}
