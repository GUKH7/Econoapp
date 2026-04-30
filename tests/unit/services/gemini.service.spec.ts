/**
 * Testes unitários do schema Zod de output do Gemini e de isConfidenceAcceptable.
 *
 * Não chamamos a API do Gemini — testamos apenas a camada de validação de dados
 * (geminiOutputSchema) e a regra de negócio de confiança mínima.
 *
 * vi.mock é içado (hoisted) pelo Vitest antes de qualquer import, garantindo que
 * @/config/env seja substituído antes de gemini.service.ts ser carregado — o que
 * evita o process.exit(1) do validador de variáveis de ambiente em testes.
 */
import { describe, expect, it, vi } from 'vitest';

import { geminiOutputSchema } from '@/services/ai/gemini.service';
import { isConfidenceAcceptable } from '@/domain/finance/transaction-rules';

vi.mock('@/config/env', () => ({
  env: {
    DATABASE_URL: 'postgresql://test:test@localhost:5432/testdb',
    JWT_SECRET: 'super-secret-key-for-integration-tests-min32!!',
    JWT_EXPIRES_IN: '1h',
    JWT_REFRESH_EXPIRES_IN: '7d',
    GEMINI_API_KEY: 'test-gemini-api-key',
    PORT: 3001,
    NODE_ENV: 'test',
  },
}));

// ---------------------------------------------------------------------------
// Payload base reutilizado nos testes do schema
// ---------------------------------------------------------------------------
const validPayload = {
  amount: 150.5,
  type: 'INCOME',
  categoryHint: 'Alimentação',
  channelHint: 'iFood',
  confidence: 0.95,
} as const;

// ---------------------------------------------------------------------------
// geminiOutputSchema
// ---------------------------------------------------------------------------
describe('geminiOutputSchema (Zod)', () => {
  // ── payloads válidos ────────────────────────────────────────────────────

  describe('aceita payloads válidos', () => {
    it('aceita payload completo com todos os campos preenchidos', () => {
      const result = geminiOutputSchema.safeParse(validPayload);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.amount).toBe(150.5);
        expect(result.data.type).toBe('INCOME');
        expect(result.data.categoryHint).toBe('Alimentação');
        expect(result.data.channelHint).toBe('iFood');
        expect(result.data.confidence).toBe(0.95);
      }
    });

    it('aceita payload do tipo EXPENSE', () => {
      const result = geminiOutputSchema.safeParse({
        ...validPayload,
        type: 'EXPENSE',
      });

      expect(result.success).toBe(true);
    });

    it('aceita payload sem channelHint (campo opcional)', () => {
      const withoutChannel = (({ channelHint: _channelHint, ...rest }) => rest)(validPayload);

      const result = geminiOutputSchema.safeParse(withoutChannel);

      expect(result.success).toBe(true);
    });

    it('aceita payload com channelHint nulo (nullable)', () => {
      const result = geminiOutputSchema.safeParse({
        ...validPayload,
        channelHint: null,
      });

      expect(result.success).toBe(true);
    });

    it('aceita confidence igual a 0 (limite inferior inclusivo)', () => {
      const result = geminiOutputSchema.safeParse({
        ...validPayload,
        confidence: 0,
      });

      expect(result.success).toBe(true);
    });

    it('aceita confidence igual a 1 (limite superior inclusivo)', () => {
      const result = geminiOutputSchema.safeParse({
        ...validPayload,
        confidence: 1,
      });

      expect(result.success).toBe(true);
    });
  });

  // ── payloads inválidos ──────────────────────────────────────────────────

  describe('rejeita payloads inválidos', () => {
    it('rejeita payload sem amount', () => {
      const withoutAmount = (({ amount: _amount, ...rest }) => rest)(validPayload);

      const result = geminiOutputSchema.safeParse(withoutAmount);

      expect(result.success).toBe(false);
      if (!result.success) {
        const fields = Object.keys(result.error.flatten().fieldErrors);
        expect(fields).toContain('amount');
      }
    });

    it('rejeita amount igual a zero (deve ser positivo)', () => {
      const result = geminiOutputSchema.safeParse({
        ...validPayload,
        amount: 0,
      });

      expect(result.success).toBe(false);
    });

    it('rejeita amount negativo', () => {
      const result = geminiOutputSchema.safeParse({
        ...validPayload,
        amount: -50,
      });

      expect(result.success).toBe(false);
    });

    it('rejeita confidence menor que 0', () => {
      const result = geminiOutputSchema.safeParse({
        ...validPayload,
        confidence: -0.1,
      });

      expect(result.success).toBe(false);
    });

    it('rejeita confidence maior que 1', () => {
      const result = geminiOutputSchema.safeParse({
        ...validPayload,
        confidence: 1.5,
      });

      expect(result.success).toBe(false);
    });

    it('rejeita type inválido (ex: "TRANSFER")', () => {
      const result = geminiOutputSchema.safeParse({
        ...validPayload,
        type: 'TRANSFER',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        const fields = Object.keys(result.error.flatten().fieldErrors);
        expect(fields).toContain('type');
      }
    });

    it('rejeita type com valor em minúsculas', () => {
      const result = geminiOutputSchema.safeParse({
        ...validPayload,
        type: 'income',
      });

      expect(result.success).toBe(false);
    });

    it('rejeita categoryHint vazio (mínimo 1 caractere)', () => {
      const result = geminiOutputSchema.safeParse({
        ...validPayload,
        categoryHint: '',
      });

      expect(result.success).toBe(false);
    });

    it('rejeita payload sem type', () => {
      const withoutType = (({ type: _type, ...rest }) => rest)(validPayload);

      const result = geminiOutputSchema.safeParse(withoutType);

      expect(result.success).toBe(false);
    });

    it('rejeita payload sem confidence', () => {
      const withoutConfidence = (({ confidence: _confidence, ...rest }) => rest)(validPayload);

      const result = geminiOutputSchema.safeParse(withoutConfidence);

      expect(result.success).toBe(false);
    });

    it('rejeita payload completamente vazio', () => {
      const result = geminiOutputSchema.safeParse({});

      expect(result.success).toBe(false);
    });

    it('rejeita payload onde amount é string numérica', () => {
      const result = geminiOutputSchema.safeParse({
        ...validPayload,
        amount: '150.5',
      });

      expect(result.success).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// isConfidenceAcceptable
// ---------------------------------------------------------------------------
describe('isConfidenceAcceptable', () => {
  it('retorna true para confidence de 0.8 (acima do limiar de 0.7)', () => {
    expect(isConfidenceAcceptable(0.8)).toBe(true);
  });

  it('retorna true para confidence exatamente no limiar mínimo (0.7)', () => {
    // O limiar é >= 0.7, ou seja, 0.7 é aceitável
    expect(isConfidenceAcceptable(0.7)).toBe(true);
  });

  it('retorna true para confidence máxima (1.0)', () => {
    expect(isConfidenceAcceptable(1)).toBe(true);
  });

  it('retorna false para confidence de 0.5 (abaixo do limiar)', () => {
    expect(isConfidenceAcceptable(0.5)).toBe(false);
  });

  it('retorna false para confidence imediatamente abaixo do limiar (0.69)', () => {
    expect(isConfidenceAcceptable(0.69)).toBe(false);
  });

  it('retorna false para confidence zero (mínimo absoluto)', () => {
    expect(isConfidenceAcceptable(0)).toBe(false);
  });
});
