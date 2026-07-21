import { Injectable } from '@nestjs/common';
import {
  WhatsappActionClassification,
  WhatsappActionEntities,
} from './whatsapp-action.types';

@Injectable()
export class WhatsappActionClassifierService {
  classify(message: string): WhatsappActionClassification | null {
    const normalized = this.normalize(message);
    if (!normalized) return null;

    const categoryName = this.extractCategoryName(message);
    const actionVerb = this.actionVerb(normalized);

    if (actionVerb === 'DELETE' && this.hasCategory(normalized)) {
      return this.result('DELETE_CATEGORY', { categoryName }, 0.99);
    }
    if (actionVerb === 'UPDATE' && this.hasCategory(normalized)) {
      const rename = this.extractCategoryRename(message);
      return this.result('UPDATE_CATEGORY', rename, 0.99);
    }
    if (actionVerb === 'CREATE' && this.hasCategory(normalized)) {
      return this.result('CREATE_CATEGORY', { categoryName }, 0.99);
    }
    if (actionVerb === 'CREATE' && this.isReceivable(normalized)) {
      return this.result('CREATE_RECEIVABLE', this.extractFinancialEntities(message), 0.97);
    }
    if (actionVerb === 'CREATE' && this.isPayable(normalized)) {
      return this.result('CREATE_PAYABLE', this.extractFinancialEntities(message), 0.97);
    }
    if (actionVerb === 'CREATE' && /\b(conta|carteira)\b/.test(normalized)) {
      return this.result('CREATE_ACCOUNT', { accountName: this.extractAccountName(message) }, 0.97);
    }

    if (/\b(or[cç]amento|limite)\b/.test(normalized) && this.hasMoney(normalized)) {
      return this.result('SET_BUDGET', { categoryName, ...this.extractFinancialEntities(message) }, 0.96);
    }
    if (this.isReceivable(normalized)) {
      return this.result('CREATE_RECEIVABLE', this.extractFinancialEntities(message), 0.88);
    }
    if (this.isPayable(normalized)) {
      return this.result('CREATE_PAYABLE', this.extractFinancialEntities(message), 0.88);
    }
    if (this.isExpenseQuery(normalized)) {
      return this.result('QUERY_EXPENSES', { categoryName }, 0.97);
    }
    if (/\b(listar?|mostr(?:a|e)|ver|quais|consultar?)\b.*\bcategor/.test(normalized)) {
      return this.result('LIST_CATEGORIES', {}, 0.98);
    }
    if (this.looksLikeTransaction(normalized)) {
      return this.result('CREATE_TRANSACTION', this.extractFinancialEntities(message), 0.95);
    }

    if (this.hasCategory(normalized) && categoryName) {
      return {
        ...this.result('UNKNOWN', { categoryName }, 0.45),
        ambiguity: 'CATEGORY_CREATE_OR_QUERY',
      };
    }
    return null;
  }

  private actionVerb(value: string): 'CREATE' | 'UPDATE' | 'DELETE' | null {
    if (/\b(criar?|cria|cria[r]?|adicionar?|adiciona|adciona|cadastrar?|cadastra|incluir?|inclui|add)\b/.test(value)) {
      return 'CREATE';
    }
    if (/\b(alterar?|altera|editar?|edita|renomear?|renomeia|mudar?|muda)\b/.test(value)) {
      return 'UPDATE';
    }
    if (/\b(excluir?|exclui|apagar?|apaga|deletar?|deleta|remover?|remove)\b/.test(value)) {
      return 'DELETE';
    }
    return null;
  }

  private extractCategoryName(message: string): string | undefined {
    const match = message.match(/categor(?:ia|ias)\s+(?:chamada|nomeada|pra|para)?\s*["“”']?([^"“”'?.,]+)["“”']?/i);
    const value = this.cleanEntity(match?.[1]);
    if (!value) return undefined;
    const normalized = this.normalize(value);
    if (/^(de |para )?(gasto|gastos|despesa|despesas|nova|novo)$/.test(normalized)) return undefined;
    return value;
  }

  private extractCategoryRename(message: string): WhatsappActionEntities {
    const match = message.match(/categor(?:ia|ias)\s+["“”']?(.+?)["“”']?\s+(?:para|por|pra)\s+["“”']?(.+?)["“”']?\s*$/i);
    return {
      currentCategoryName: this.cleanEntity(match?.[1]),
      newCategoryName: this.cleanEntity(match?.[2]),
    };
  }

  private extractAccountName(message: string): string | undefined {
    const match = message.match(/(?:conta|carteira)\s+(?:chamada|nomeada)?\s*["“”']?([^"“”'?.,]+)["“”']?/i);
    return this.cleanEntity(match?.[1]);
  }

  private extractFinancialEntities(message: string): WhatsappActionEntities {
    const amountMatch = message.match(/(?:r\$\s*)?(\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)/i);
    const amount = amountMatch
      ? Number(amountMatch[1]!.replace(/\./g, '').replace(',', '.'))
      : undefined;
    return { ...(amount && amount > 0 ? { amount } : {}) };
  }

  private isExpenseQuery(value: string): boolean {
    return /\b(quanto|qual|quais|mostrar?|mostra|liste?|listar?|consultar?|ver)\b.*\b(gastei|gasto|gastos|despesa|despesas)\b|\b(gastos?|despesas?)\b.*\b(m[eê]s|semana|hoje|ontem|categoria)\b/.test(value);
  }

  private looksLikeTransaction(value: string): boolean {
    return this.hasMoney(value) && /\b(gastei|gstei|gasto|paguei|comprei|recebi|ganhei|vendi|entrou|saiu|anota)\b/.test(value);
  }

  private isReceivable(value: string): boolean {
    return /\b(conta[s]? a receber|receb[ií]vel|tenho (?:algo )?a receber|me deve|vai me pagar)\b/.test(value);
  }

  private isPayable(value: string): boolean {
    return /\b(conta[s]? a pagar|pag[aá]vel|tenho (?:algo )?a pagar|pagar (?:o |a )?(?:fornecedor|boleto))\b/.test(value);
  }

  private hasCategory(value: string): boolean {
    return /\bcategor(?:ia|ias)\b/.test(value);
  }

  private hasMoney(value: string): boolean {
    return /r\$\s*\d|\b\d+[.,]\d{1,2}\b|\b\d+\s*(?:reais|real)\b|\b(?:um|dois|tres|quatro|cinco|seis|sete|oito|nove|dez|vinte|trinta|quarenta|cinquenta|sessenta|setenta|oitenta|noventa|cem|cento|duzentos|trezentos|quatrocentos|quinhentos|mil)\b.*\b(?:reais|real)\b/.test(value);
  }

  private cleanEntity(value?: string): string | undefined {
    const cleaned = value?.trim().replace(/^(?:a|uma|de)\s+/i, '').replace(/\s+/g, ' ');
    if (!cleaned) return undefined;
    return cleaned.charAt(0).toLocaleUpperCase('pt-BR') + cleaned.slice(1);
  }

  private result(
    action: WhatsappActionClassification['action'],
    entities: WhatsappActionEntities,
    confidence: number,
  ): WhatsappActionClassification {
    return { action, entities, confidence, source: 'RULE' };
  }

  private normalize(value: string): string {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLocaleLowerCase('pt-BR')
      .replace(/[^a-z0-9çãõáéíóúâêôàü$.,\s]/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
}
