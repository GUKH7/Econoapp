import { PrismaClient } from '@prisma/client';
import { hash } from 'bcryptjs';

const prisma = new PrismaClient();

const channels: Array<{ name: string; feePercent: number }> = [
  { name: 'Shopee', feePercent: 18 },
  { name: 'Mercado Livre', feePercent: 14 },
  { name: 'Site Próprio', feePercent: 0 },
  { name: 'Físico', feePercent: 0 },
];

const categoryNames = ['Venda', 'Frete', 'Taxa Plataforma', 'Estoque', 'Marketing', 'Outros'];

async function seedUserData(userId: string): Promise<void> {
  for (const channel of channels) {
    const existingChannel = await prisma.salesChannel.findFirst({
      where: { userId, name: channel.name },
    });
    if (!existingChannel) {
      await prisma.salesChannel.create({
        data: { ...channel, isActive: true, userId },
      });
    }
  }

  for (const categoryName of categoryNames) {
    const existing = await prisma.category.findFirst({
      where: { userId, name: categoryName },
    });
    if (!existing) {
      await prisma.category.create({
        data: { name: categoryName, userId },
      });
    }
  }
}

async function main(): Promise<void> {
  const passwordHash = await hash('12345678', 10);

  // Usuário de teste — criado pelo seed se não existir
  const testUser = await prisma.user.upsert({
    where: { phone: '11999999999' },
    update: {},
    create: {
      name: 'Usuário Teste',
      phone: '11999999999',
      email: 'teste@econoapp.local',
      passwordHash,
    },
  });

  console.log(`Seeding data for test user: ${testUser.id} (${testUser.phone})`);
  await seedUserData(testUser.id);

  // Usuário real de exemplo — TODO: substituir pelo número real antes de usar em produção
  const realUser = await prisma.user.upsert({
    where: { phone: '11900000001' },
    update: {},
    create: {
      name: 'Usuário Real Teste',
      phone: '11900000001', // TODO: substituir pelo número real antes de usar em produção
      passwordHash,
    },
  });

  console.log(`Seeding data for real user: ${realUser.id} (${realUser.phone})`);
  await seedUserData(realUser.id);

  console.log('Seed completed successfully.');
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
