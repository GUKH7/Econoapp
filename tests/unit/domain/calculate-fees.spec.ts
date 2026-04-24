import { describe, expect, it } from 'vitest';
import { calculateFeeAmount, calculateNetAmount } from '@/domain/finance/calculate-fees';

describe('calculate-fees domain', () => {
  it('calcula taxa de 18%', () => {
    expect(calculateFeeAmount(100, 18)).toBe(18);
    expect(calculateNetAmount(100, 18)).toBe(82);
  });

  it('calcula taxa zero', () => {
    expect(calculateFeeAmount(100, 0)).toBe(0);
    expect(calculateNetAmount(100, 0)).toBe(100);
  });

  it('arredonda corretamente taxa fracionada', () => {
    expect(calculateFeeAmount(123.45, 12.34)).toBe(15.23);
    expect(calculateNetAmount(123.45, 12.34)).toBe(108.22);
  });

  it('calcula taxa de 100%', () => {
    expect(calculateFeeAmount(250, 100)).toBe(250);
    expect(calculateNetAmount(250, 100)).toBe(0);
  });

  it('lança erro para taxa negativa', () => {
    expect(() => calculateFeeAmount(100, -1)).toThrowError();
  });

  it('lança erro para taxa maior que 100', () => {
    expect(() => calculateFeeAmount(100, 101)).toThrowError();
  });
});
