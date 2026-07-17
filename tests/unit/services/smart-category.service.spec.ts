import { TransactionType } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SmartCategoryService } from '@/modules/transactions/smart-category.service';

describe('SmartCategoryService', () => {
  const prisma = {
    categoryPreference: {
      findMany: vi.fn(),
      upsert: vi.fn(),
    },
  };

  const categories = [
    { id: 'food', name: 'Alimentação' },
    { id: 'transport', name: 'Transporte' },
    { id: 'health', name: 'Saúde' },
    { id: 'other', name: 'Outros' },
  ];

  let service: SmartCategoryService;

  beforeEach(() => {
    vi.clearAllMocks();
    prisma.categoryPreference.findMany.mockResolvedValue([]);
    prisma.categoryPreference.upsert.mockResolvedValue({});
    service = new SmartCategoryService(prisma as never);
  });

  it('classifica estabelecimentos brasileiros conhecidos sem criar outra categoria', async () => {
    await expect(service.suggestCategoryId({
      userId: 'user',
      description: 'Compra no Carrefour',
      type: TransactionType.EXPENSE,
      categories,
      fallbackCategoryId: 'other',
    })).resolves.toBe('food');

    await expect(service.suggestCategoryId({
      userId: 'user',
      description: 'Corrida de Uber hoje',
      type: TransactionType.EXPENSE,
      categories,
      fallbackCategoryId: 'other',
    })).resolves.toBe('transport');
  });

  it('não aprende palavras genéricas isoladas da descrição', async () => {
    await service.remember({
      userId: 'user',
      description: 'Paguei uma compra no Carrefour hoje',
      categoryName: 'Alimentação',
      type: TransactionType.EXPENSE,
    });

    const savedKeys = prisma.categoryPreference.upsert.mock.calls.map(
      ([call]) => call.create.sourceKey,
    );
    expect(savedKeys).toContain('carrefour');
    expect(savedKeys).not.toContain('paguei');
    expect(savedKeys).not.toContain('compra');
    expect(savedKeys).not.toContain('hoje');
  });

  it('prioriza a preferência mais específica em vez de uma palavra com mais usos', async () => {
    prisma.categoryPreference.findMany.mockResolvedValue([
      { sourceKey: 'carrefour', categoryName: 'Alimentação', hits: 2, updatedAt: new Date() },
      { sourceKey: 'carrefour gasolina', categoryName: 'Transporte', hits: 1, updatedAt: new Date() },
    ]);

    await expect(service.suggestCategoryId({
      userId: 'user',
      description: 'Carrefour gasolina',
      type: TransactionType.EXPENSE,
      categories,
      fallbackCategoryId: 'other',
    })).resolves.toBe('transport');
  });

  it('não confunde números parciais com o app 99', async () => {
    await expect(service.suggestCategoryId({
      userId: 'user',
      description: 'Compra 199 reais',
      type: TransactionType.EXPENSE,
      categories,
      fallbackCategoryId: 'other',
    })).resolves.toBe('other');
  });
});
