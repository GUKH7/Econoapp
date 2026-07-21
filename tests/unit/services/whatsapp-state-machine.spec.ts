import { ConflictException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import {
  assertFlowTransition,
  normalizeFlowStep,
  normalizeFlowType,
  versionedPendingData,
} from '@/modules/whatsapp/whatsapp-state-machine';

describe('Whatsapp state machine', () => {
  it('normaliza tipos e etapas desconhecidos para IDLE', () => {
    expect(normalizeFlowType('INVALID')).toBe('IDLE');
    expect(normalizeFlowStep('INVALID')).toBe('IDLE');
  });

  it('permite avançar de coleta para confirmação', () => {
    expect(() => assertFlowTransition('WAITING_AMOUNT', 'WAITING_CONFIRMATION')).not.toThrow();
  });

  it('impede reabrir seleção depois de concluir sem iniciar nova operação', () => {
    expect(() => assertFlowTransition('COMPLETED', 'COMPLETED')).not.toThrow();
    expect(() => assertFlowTransition('WAITING_CONFIRMATION', 'WAITING_AMOUNT'))
      .toThrow(ConflictException);
  });

  it('anexa metadados de versão sem apagar as entidades do rascunho', () => {
    expect(versionedPendingData(
      { amount: 25 },
      4,
      'TRANSACTION',
      'WAITING_CONFIRMATION',
    )).toEqual({
      amount: 25,
      _flow: { type: 'TRANSACTION', step: 'WAITING_CONFIRMATION', version: 4 },
    });
  });
});
