import { Inject, Injectable } from '@nestjs/common';
import { Category, TransactionType } from '@prisma/client';
import { PrismaService } from '@/config/database';

@Injectable()
export class SmartCategoryService {
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
    const preference = await this.prisma.categoryPreference.findFirst({
      where: { userId, type, sourceKey: { in: keys } },
      orderBy: [{ hits: 'desc' }, { updatedAt: 'desc' }],
    });
    return preference?.categoryName ?? null;
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
        keywords: ['ifood', 'restaurante', 'lanchonete', 'mercado', 'supermercado', 'padaria', 'acougue'],
        categoryNames: ['alimentacao', 'comida', 'mercado'],
        type: TransactionType.EXPENSE,
      },
      {
        keywords: ['uber', '99', 'posto', 'combustivel', 'estacionamento', 'metro', 'onibus'],
        categoryNames: ['transporte', 'carro'],
        type: TransactionType.EXPENSE,
      },
      {
        keywords: ['farmacia', 'drogaria', 'medico', 'hospital', 'consulta'],
        categoryNames: ['saude'],
        type: TransactionType.EXPENSE,
      },
      {
        keywords: ['netflix', 'spotify', 'cinema', 'prime video', 'youtube', 'lazer'],
        categoryNames: ['lazer', 'assinaturas'],
        type: TransactionType.EXPENSE,
      },
      {
        keywords: ['aluguel', 'condominio', 'energia', 'luz', 'agua', 'internet'],
        categoryNames: ['moradia', 'casa', 'contas'],
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
      if (!rule.keywords.some((keyword) => normalized.includes(keyword))) continue;
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
    const tokens = normalized.split(' ').filter((token) => token.length >= 3);
    const compact = tokens.slice(0, 4).join(' ');
    return [...new Set([normalized, compact, ...tokens.slice(0, 6)])].filter(Boolean);
  }

  private preferenceKey(value: string | null | undefined): string | null {
    const normalized = this.normalize(value ?? '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
    return normalized || null;
  }

  private normalize(value: string): string {
    return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  }
}