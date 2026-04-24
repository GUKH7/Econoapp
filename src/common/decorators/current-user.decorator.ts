import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { JwtPayload } from '@/common/types';

export const CurrentUser = createParamDecorator((_: unknown, context: ExecutionContext): JwtPayload => {
  const request = context.switchToHttp().getRequest<{ user: JwtPayload }>();
  return request.user;
});
