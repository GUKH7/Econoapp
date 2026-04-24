import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { json, Request } from 'express';
import { Logger } from 'nestjs-pino';
import { apiReference } from '@scalar/nestjs-api-reference';
import { AppModule } from '@/app.module';
import { env } from '@/config/env';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  app.enableCors({
    origin: process.env.CORS_ORIGIN ?? '*',
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  app.use(
    json({
      verify: (req, _, buffer) => {
        (req as Request).rawBody = Buffer.from(buffer);
      },
    }),
  );

  app.useLogger(app.get(Logger));
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", 'https://cdn.jsdelivr.net'],
          scriptSrcElem: ["'self'", 'https://cdn.jsdelivr.net'],
          styleSrc: ["'self'", 'https:', "'unsafe-inline'"],
          styleSrcElem: ["'self'", 'https:', "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'https:'],
          fontSrc: ["'self'", 'https:', 'data:'],
          connectSrc: ["'self'"],
          frameSrc: ["'none'"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
        },
      },
    }),
  );
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const swaggerConfig = new DocumentBuilder()
    .setTitle('EconoApp API')
    .setDescription('API de gestão financeira para vendedores de marketplace via Telegram e WhatsApp')
    .setVersion('1.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        name: 'Authorization',
        in: 'header',
      },
      'access-token',
    )
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);

  // Mantém o endpoint JSON para ferramentas externas (ex: Postman, CI)
  SwaggerModule.setup('openapi', app, document, { jsonDocumentUrl: 'openapi.json' });

  // Scalar UI (substitui o Swagger UI)
  app.use(
    '/docs',
    apiReference({
      content: document,
      theme: 'default',
      layout: 'modern',
    }),
  );

  await app.listen(env.PORT);
}

void bootstrap();
