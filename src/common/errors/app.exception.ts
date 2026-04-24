import { HttpException, HttpStatus } from '@nestjs/common';

export class AppException extends HttpException {
  constructor(message: string, status: HttpStatus, details?: unknown) {
    super({ message, details }, status);
  }
}

export class NotFoundException extends AppException {
  constructor(message = 'Recurso não encontrado', details?: unknown) {
    super(message, HttpStatus.NOT_FOUND, details);
  }
}

export class UnauthorizedException extends AppException {
  constructor(message = 'Não autorizado', details?: unknown) {
    super(message, HttpStatus.UNAUTHORIZED, details);
  }
}

export class ForbiddenException extends AppException {
  constructor(message = 'Acesso negado', details?: unknown) {
    super(message, HttpStatus.FORBIDDEN, details);
  }
}

export class BadRequestException extends AppException {
  constructor(message = 'Requisição inválida', details?: unknown) {
    super(message, HttpStatus.BAD_REQUEST, details);
  }
}

export class ConflictException extends AppException {
  constructor(message = 'Conflito de dados', details?: unknown) {
    super(message, HttpStatus.CONFLICT, details);
  }
}
