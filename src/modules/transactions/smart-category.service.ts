import { Inject, Injectable } from '@nestjs/common';
import { Category, TransactionType } from '@prisma/client';
import { PrismaService } from '@/config/database';

@Injectable()
export class SmartCategoryService {
  private readonly ignoredPreferenceTokens = new Set([
    'a', 'ao', 'aos', 'as', 'com', 'compra', 'compras', 'da', 'das', 'de', 'do', 'dos',
    'em', 'gasto', 'gastos', 'hoje', 'meu', 'minha', 'no', 'nos', 'na', 'nas', 'pagamento',
    'paguei', 'para', 'por', 'real', 'reais', 'um', 'uma', 'valor', 'via',
  ]);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async suggestCategoryId(input: {
    userId: string;
    description: string;
    type: TransactionType;
    categories: Pick<Category, 'id' | 'name'>[];
    fallbackCategoryId: string;
  }): Promise<string> {
    const learned = await this.findLearnedCategoryName(input.userId, input.description, input.type);
    if (learned) {
      const match = this.findCategoryByName(input.categories, learned);
      if (match) return match.id;
    }

    const direct = this.findCategoryMention(input.description, input.categories);
    if (direct) return direct.id;

    const rule = this.findRuleCategory(input.description, input.type, input.categories);
    if (rule) return rule.id;

    return input.fallbackCategoryId;
  }

  async remember(input: {
    userId: string;
    description: string;
    categoryName: string;
    type: TransactionType;
  }): Promise<void> {
    const categoryName = input.categoryName.trim();
    if (!categoryName) return;

    const keys = this.preferenceKeys(input.description).filter(
      (key) => key !== this.preferenceKey(categoryName),
    );
    await Promise.all(
      keys.map((sourceKey) =>
        this.prisma.categoryPreference.upsert({
          where: { userId_sourceKey_type: { userId: input.userId, sourceKey, type: input.type } },
          create: {
            userId: input.userId,
            sourceKey,
            sourceText: sourceKey,
            categoryName,
            type: input.type,
          },
          update: { categoryName, hits: { increment: 1 } },
        }),
      ),
    );
  }

  private async findLearnedCategoryName(
    userId: string,
    description: string,
    type: TransactionType,
  ): Promise<string | null> {
    const keys = this.preferenceKeys(description);
    if (!keys.length) return null;
    const preferences = await this.prisma.categoryPreference.findMany({
      where: { userId, type, sourceKey: { in: keys } },
      orderBy: [{ hits: 'desc' }, { updatedAt: 'desc' }],
    });
    const priority = new Map(keys.map((key, index) => [key, keys.length - index]));
    preferences.sort((left, right) => {
      const specificity = (priority.get(right.sourceKey) ?? 0) - (priority.get(left.sourceKey) ?? 0);
      if (specificity !== 0) return specificity;
      return right.hits - left.hits;
    });
    return preferences[0]?.categoryName ?? null;
  }

  private findCategoryMention(description: string, categories: Pick<Category, 'id' | 'name'>[]) {
    const normalized = this.normalize(description);
    return categories.find((category) => {
      const categoryKey = this.normalize(category.name);
      return categoryKey.length >= 3 && normalized.includes(categoryKey);
    });
  }

  private findCategoryByName(categories: Pick<Category, 'id' | 'name'>[], name: string) {
    const key = this.normalize(name);
    return categories.find((category) => this.normalize(category.name) === key);
  }

  private findRuleCategory(
    description: string,
    type: TransactionType,
    categories: Pick<Category, 'id' | 'name'>[],
  ) {
    const normalized = this.normalize(description);
    const rules: Array<{ keywords: string[]; categoryNames: string[]; type?: TransactionType }> = [
      {
        keywords: [
          'ifood', 'rappi', 'restaurante', 'lanchonete', 'delivery', 'mercado', 'supermercado',
          'atacadao', 'assai', 'carrefour', 'padaria', 'acougue',
        ],
        categoryNames: ['alimentacao', 'comida', 'mercado', 'supermercado'],
        type: TransactionType.EXPENSE,
      },
      {
        keywords: [
          'uber', '99', 'taxi', 'posto', 'combustivel', 'gasolina', 'etanol', 'estacionamento',
          'pedagio', 'metro', 'onibus', 'passagem',
        ],
        categoryNames: ['transporte', 'carro', 'mobilidade'],
        type: TransactionType.EXPENSE,
      },
      {
        keywords: ['farmacia', 'drogaria', 'remedio', 'medicamento', 'medico', 'hospital', 'consulta', 'exame'],
        categoryNames: ['saude', 'farmacia'],
        type: TransactionType.EXPENSE,
      },
      {
        keywords: ['netflix', 'spotify', 'cinema', 'prime video', 'youtube premium', 'disney', 'hbo', 'globoplay'],
        categoryNames: ['assinaturas', 'lazer', 'entretenimento'],
        type: TransactionType.EXPENSE,
      },
      {
        keywords: ['aluguel', 'condominio', 'energia', 'luz', 'agua', 'internet', 'telefone', 'celular', 'gas'],
        categoryNames: ['moradia', 'casa', 'contas', 'contas da casa'],
        type: TransactionType.EXPENSE,
      },
      {
        keywords: ['faculdade', 'escola', 'curso', 'livro', 'material escolar', 'udemy', 'alura'],
        categoryNames: ['educacao', 'estudos', 'cursos'],
        type: TransactionType.EXPENSE,
      },
      {
        keywords: ['shopee', 'amazon', 'mercado livre', 'magalu', 'roupa', 'calcado'],
        categoryNames: ['compras', 'vestuario', 'outros'],
        type: TransactionType.EXPENSE,
      },
      {
        keywords: ['pix recebido', 'salario', 'provento', 'pagamento recebido'],
        categoryNames: ['salario', 'receitas', 'vendas'],
        type: TransactionType.INCOME,
      },
    ];

    for (const rule of rules) {
      if (rule.type && rule.type !== type) continue;
      if (!rule.keywords.some((keyword) => this.containsTerm(normalized, keyword))) continue;
      const matched = categories.find((category) =>
        rule.categoryNames.includes(this.normalize(category.name)),
      );
      if (matched) return matched;
    }
    return null;
  }

  private preferenceKeys(value: string): string[] {
    const normalized = this.preferenceKey(value);
    if (!normalized) return [];
    const tokens = normalized
      .split(' ')
      .filter((token) => token.length >= 3 && !this.ignoredPreferenceTokens.has(token) && !/^\d+$/.test(token));
    const compact = tokens.slice(0, 4).join(' ');
    const distinctiveTokens = tokens.filter((token) => token.length >= 4).slice(0, 6);
    return [...new Set([normalized, compact, ...distinctiveTokens])].filter(Boolean);
  }

  private preferenceKey(value: string | null | undefined): string | null {
    const normalized = this.normalize(value ?? '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
    return normalized || null;
  }

  private normalize(value: string): string {
    return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  }

  private containsTerm(normalizedText: string, normalizedTerm: string): boolean {
    const escaped = normalizedTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|\\s)${escaped}(?=\\s|$)`).test(normalizedText.replace(/[^a-z0-9 ]/g, ' '));
  }
}
