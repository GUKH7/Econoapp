import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Optional,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { PinoLogger } from 'nestjs-pino';
import { ZodError } from 'zod';

@Injectable()
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  constructor(@Optional() @Inject(PinoLogger) private readonly logger?: PinoLogger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    // Ignora contextos não-HTTP (ex: Telegraf/Telegram bot updates)
    if (host.getType() !== 'http') {
      if (this.logger) {
        this.logger.error({ err: exception }, 'Exception in non-HTTP context');
      }
      return;
    }

    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const path = request.url;
    const requestId = (request as Request & { id?: string }).id;
    const errorContext = { path, requestId, timestamp: new Date().toISOString() };

    if (exception instanceof ZodError) {
      response.status(HttpStatus.BAD_REQUEST).json({
        message: 'Validation error',
        fieldErrors: exception.flatten().fieldErrors,
        ...errorContext,
      });
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const errorResponse = exception.getResponse();
      if (typeof errorResponse === 'string') {
        response.status(status).json({ message: errorResponse, ...errorContext });
        return;
      }

      response.status(status).json({
        ...(errorResponse as Record<string, unknown>),
        ...errorContext,
      });
      return;
    }

    if (this.logger) {
      this.logger.error({ err: exception, ...errorContext }, 'Unhandled exception');
    } else {
      console.error('Unhandled exception', { err: exception, path });
    }
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      message: 'Internal server error',
      ...errorContext,
    });
  }
}
