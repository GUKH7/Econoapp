import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';

interface LoginAttempt {
  failures: number;
  firstFailureAt: number;
  blockedUntil: number;
}

@Injectable()
export class AdminLoginAttemptsService {
  private readonly attempts = new Map<string, LoginAttempt>();
  private readonly windowMs = 60_000;
  private readonly maximumFailures = 5;

  key(ip: string, login: string): string {
    return createHash('sha256')
      .update(`${ip}:${login.trim().toLowerCase()}`)
      .digest('hex');
  }

  assertAllowed(key: string, now = Date.now()): void {
    const attempt = this.attempts.get(key);
    if (!attempt) return;
    if (attempt.blockedUntil > now) {
      const retryAfter = Math.max(1, Math.ceil((attempt.blockedUntil - now) / 1_000));
      throw new HttpException(
        { message: `Muitas tentativas inválidas. Aguarde ${retryAfter} segundos.` },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    if (now - attempt.firstFailureAt >= this.windowMs) this.attempts.delete(key);
  }

  recordFailure(key: string, now = Date.now()): void {
    const current = this.attempts.get(key);
    const active = current && now - current.firstFailureAt < this.windowMs
      ? current
      : { failures: 0, firstFailureAt: now, blockedUntil: 0 };
    active.failures += 1;
    if (active.failures >= this.maximumFailures) active.blockedUntil = now + this.windowMs;
    this.attempts.set(key, active);
  }

  clear(key: string): void {
    this.attempts.delete(key);
  }
}
