function validateFeePercent(feePercent: number): void {
  if (feePercent < 0 || feePercent > 100) {
    throw new Error('feePercent deve estar entre 0 e 100');
  }
}

export function calculateFeeAmount(amount: number, feePercent: number): number {
  validateFeePercent(feePercent);
  return Math.round(((amount * feePercent) / 100) * 100) / 100;
}

export function calculateNetAmount(amount: number, feePercent: number): number {
  const feeAmount = calculateFeeAmount(amount, feePercent);
  return Math.round((amount - feeAmount) * 100) / 100;
}
