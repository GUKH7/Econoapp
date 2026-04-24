export function isConfidenceAcceptable(confidence: number): boolean {
  return confidence >= 0.7;
}

export function buildConfirmationMessage(
  description: string,
  amount: number,
  netAmount: number,
  channelName: string | null,
): string {
  const money = new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });

  const channelLabel = channelName ? `🏪 Canal: ${channelName}` : '🏪 Canal: não informado';

  return [
    '✅ *Transação registrada!*',
    `📝 Descrição: ${description}`,
    `💰 Valor bruto: ${money.format(amount)}`,
    `💵 Valor líquido: ${money.format(netAmount)}`,
    channelLabel,
  ].join('\n');
}
