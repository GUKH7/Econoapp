import 'reflect-metadata';
import { ValidationPipe, RequestMethod } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { json, urlencoded } from 'express';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { apiReference } from '@scalar/nestjs-api-reference';
import { AppModule } from '@/app.module';
import { env } from '@/config/env';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bodyParser: false, bufferLogs: true });
  const express = app.getHttpAdapter().getInstance() as { set(name: string, value: unknown): void };
  express.set('trust proxy', 1);

  app.use(json({ limit: '15mb' }));
  app.use(urlencoded({ extended: true, limit: '15mb' }));

  const corsOrigins = env.CORS_ORIGIN
    ? env.CORS_ORIGIN.split(',').map((origin) => origin.trim()).filter(Boolean)
    : env.NODE_ENV === 'production'
      ? false
      : true;

  app.enableCors({
    origin: corsOrigins,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
    exposedHeaders: ['X-Request-Id'],
  });



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
  app.setGlobalPrefix('api/v1', {
    exclude: [{ path: 'health', method: RequestMethod.GET }],
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const swaggerConfig = new DocumentBuilder()
    .setTitle('EconoApp API')
    .setDescription('API de gestão financeira para vendedores de marketplace via Telegram')
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
