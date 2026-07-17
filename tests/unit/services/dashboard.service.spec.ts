import { describe, expect, it } from 'vitest';
import { buildSpendingByTime } from '@/modules/dashboard/dashboard.service';

describe('buildSpendingByTime', () => {
  it('identifica o horário e a categoria em que o usuário mais gasta', () => {
    const result = buildSpendingByTime([
      { period: 'MORNING', categoryName: 'Transporte', total: 50, transactionCount: 2 },
      { period: 'EVENING', categoryName: 'Alimentação', total: 180, transactionCount: 3 },
      { period: 'EVENING', categoryName: 'Lazer', total: 70, transactionCount: 1 },
    ]);
    expect(result.sampleSize).toBe(6);
    expect(result.hasEnoughData).toBe(true);
    expect(result.peakPeriod).toBe('EVENING');
    expect(result.periods.find((period) => period.key === 'EVENING')).toMatchObject({ total: 250, transactionCount: 4, topCategory: 'Alimentação' });
  });

  it('não afirma um hábito com uma amostra pequena', () => {
    const result = buildSpendingByTime([{ period: 'AFTERNOON', categoryName: 'Saúde', total: 40, transactionCount: 2 }]);
    expect(result.hasEnoughData).toBe(false);
    expect(result.periods).toHaveLength(4);
  });
});
