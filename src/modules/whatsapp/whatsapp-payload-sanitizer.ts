import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';

const SENSITIVE_KEYS = /^(authorization|token|api[_-]?key|secret|password|mediaKey)$/i;
const BINARY_KEYS = /^(base64|buffer|file|binary|bytes)$/i;
const BASE64_LIKE = /^(?:[A-Za-z0-9+/]{4}){32,}(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

export function sanitizeWhatsappPayload(value: unknown): Prisma.InputJsonValue {
  return sanitizeValue(value, 0) as Prisma.InputJsonValue;
}

export function whatsappPayloadHash(value: unknown): string {
  const canonical = JSON.stringify(sanitizeWhatsappPayload(value));
  return createHash('sha256').update(canonical).digest('hex');
}

function sanitizeValue(value: unknown, depth: number): unknown {
  if (depth > 8) return '[TRUNCATED_DEPTH]';
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.startsWith('data:audio/') || (trimmed.length > 256 && BASE64_LIKE.test(trimmed))) {
      return `[BINARY_REMOVED:${trimmed.length}]`;
    }
    return value.length > 2_000 ? `${value.slice(0, 2_000)}[TRUNCATED]` : value;
  }
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => sanitizeValue(item, depth + 1));
  if (!value || typeof value !== 'object') return String(value ?? '');

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => {
      if (SENSITIVE_KEYS.test(key)) return [key, '[REDACTED]'];
      if (BINARY_KEYS.test(key)) {
        const size = typeof item === 'string' ? item.length : 0;
        return [key, `[BINARY_REMOVED:${size}]`];
      }
      return [key, sanitizeValue(item, depth + 1)];
    }),
  );
}
