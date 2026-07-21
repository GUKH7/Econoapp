import { ConflictException } from '@nestjs/common';

export const WHATSAPP_FLOW_TYPES = [
  'IDLE',
  'DETAILS',
  'TRANSACTION_DETAILS',
  'TRANSACTION',
  'PAYMENT',
  'CATEGORY',
  'MUTATION',
  'ACTION',
] as const;

export type WhatsappFlowType = (typeof WHATSAPP_FLOW_TYPES)[number];

export const WHATSAPP_FLOW_STEPS = [
  'IDLE',
  'WAITING_INPUT',
  'WAITING_AMOUNT',
  'WAITING_DESCRIPTION',
  'WAITING_SELECTION',
  'WAITING_CONFIRMATION',
  'COMPLETED',
  'CANCELLED',
] as const;

export type WhatsappFlowStep = (typeof WHATSAPP_FLOW_STEPS)[number];
export type AssistantSessionChannel = 'WHATSAPP' | 'APP';

export type WhatsappQuickAction = {
  id: string;
  label: string;
  value: string;
};

const ALLOWED_TRANSITIONS: Record<WhatsappFlowStep, readonly WhatsappFlowStep[]> = {
  IDLE: ['WAITING_INPUT', 'WAITING_AMOUNT', 'WAITING_DESCRIPTION', 'WAITING_SELECTION', 'WAITING_CONFIRMATION'],
  WAITING_INPUT: ['WAITING_INPUT', 'WAITING_AMOUNT', 'WAITING_DESCRIPTION', 'WAITING_SELECTION', 'WAITING_CONFIRMATION', 'COMPLETED', 'CANCELLED'],
  WAITING_AMOUNT: ['WAITING_AMOUNT', 'WAITING_DESCRIPTION', 'WAITING_SELECTION', 'WAITING_CONFIRMATION', 'COMPLETED', 'CANCELLED'],
  WAITING_DESCRIPTION: ['WAITING_DESCRIPTION', 'WAITING_AMOUNT', 'WAITING_SELECTION', 'WAITING_CONFIRMATION', 'COMPLETED', 'CANCELLED'],
  WAITING_SELECTION: ['WAITING_SELECTION', 'WAITING_INPUT', 'WAITING_CONFIRMATION', 'COMPLETED', 'CANCELLED'],
  WAITING_CONFIRMATION: ['WAITING_CONFIRMATION', 'WAITING_SELECTION', 'COMPLETED', 'CANCELLED'],
  COMPLETED: ['WAITING_INPUT', 'WAITING_AMOUNT', 'WAITING_DESCRIPTION', 'WAITING_SELECTION', 'WAITING_CONFIRMATION'],
  CANCELLED: ['WAITING_INPUT', 'WAITING_AMOUNT', 'WAITING_DESCRIPTION', 'WAITING_SELECTION', 'WAITING_CONFIRMATION'],
};

export function normalizeFlowType(value?: string | null): WhatsappFlowType {
  return WHATSAPP_FLOW_TYPES.includes(value as WhatsappFlowType) ? value as WhatsappFlowType : 'IDLE';
}

export function normalizeFlowStep(value?: string | null): WhatsappFlowStep {
  return WHATSAPP_FLOW_STEPS.includes(value as WhatsappFlowStep) ? value as WhatsappFlowStep : 'IDLE';
}

export function assertFlowTransition(from: string | null | undefined, to: string): void {
  const current = normalizeFlowStep(from);
  const next = normalizeFlowStep(to);
  if (current === next || ALLOWED_TRANSITIONS[current].includes(next)) return;
  throw new ConflictException(`Transicao de conversa invalida: ${current} -> ${next}.`);
}

export function versionedPendingData(
  data: unknown,
  stateVersion: number,
  flowType: string,
  flowStep: string,
): Record<string, unknown> {
  const value = data && typeof data === 'object' && !Array.isArray(data)
    ? data as Record<string, unknown>
    : { value: data };
  return {
    ...value,
    _flow: {
      type: normalizeFlowType(flowType),
      step: normalizeFlowStep(flowStep),
      version: stateVersion,
    },
  };
}
