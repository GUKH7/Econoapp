import type { Request } from 'express';
import type { PaginationMeta } from './response.types';

export interface JwtPayload {
  sub: string;
  phone: string;
  email?: string;
}

export interface PaginatedResult<T> {
  data: T[];
  meta: PaginationMeta;
}

export type AuthenticatedRequest = Request & {
  user?: JwtPayload;
  rawBody?: Buffer;
};

declare module 'express-serve-static-core' {
  interface Request {
    user?: JwtPayload;
    rawBody?: Buffer;
  }
}
