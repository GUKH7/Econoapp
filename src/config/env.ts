import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET precisa ter no mínimo 32 caracteres'),
  JWT_EXPIRES_IN: z.string().min(1),
  JWT_REFRESH_EXPIRES_IN: z.string().min(1),
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  GEMINI_API_KEY: z.string().min(1),
  PORT: z
    .string()
    .default('3001')
    .transform((value) => Number(value)),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  console.error('Variáveis de ambiente inválidas:');
  console.error(parsedEnv.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsedEnv.data;
