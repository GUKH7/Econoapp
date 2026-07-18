import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET precisa ter no mínimo 32 caracteres'),
  JWT_EXPIRES_IN: z.string().min(1),
  JWT_REFRESH_EXPIRES_IN: z.string().min(1),
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  GEMINI_API_KEY: z.string().min(1),
  GOOGLE_CLIENT_ID: z.string().default(''),
  GMAIL_API_CLIENT_ID: z.string().default(''),
  GMAIL_API_CLIENT_SECRET: z.string().default(''),
  GMAIL_API_REFRESH_TOKEN: z.string().default(''),
  GMAIL_FROM_EMAIL: z.string().default(''),
  PASSWORD_RESET_URL: z.string().url().default('http://localhost:5173/?resetPassword=1'),
  CORS_ORIGIN: z.string().default(''),
  WHATSAPP_BOT_API_URL: z.string().url().default('http://64.181.189.107:3001/econoapp'),
  WHATSAPP_BOT_SEND_MESSAGE_PATH: z.string().default('/send-message'),
  WHATSAPP_ADMIN_PHONES: z.string().default('5511934736234'),
  ADMIN_PANEL_LOGIN: z.string().default(''),
  ADMIN_PANEL_PASSWORD: z.string().default(''),
  WHATSAPP_WEBHOOK_TOKEN: z.string().default(''),
  WHATSAPP_BUDGET_ALERT_TOKEN: z.string().default(''),
  WHATSAPP_BUDGET_ALERT_INTERVAL_MINUTES: z.coerce.number().int().min(5).default(60),
  RECURRING_TRANSACTION_INTERVAL_MINUTES: z.coerce.number().int().min(5).default(60),
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
