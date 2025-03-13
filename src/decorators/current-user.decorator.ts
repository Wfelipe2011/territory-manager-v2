import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { RequestUser } from 'src/interfaces/RequestUser';

export const CurrentUser = createParamDecorator((data: keyof RequestUser['user'] | undefined, ctx: ExecutionContext) => {
  const request = ctx.switchToHttp().getRequest<RequestUser>();
  const user = request.user;

  // Se um campo específico for solicitado (ex.: `id`, `roles`), retorna apenas ele
  if (data) {
    return user[data];
  }

  // Caso contrário, retorna o objeto completo do usuário
  return user;
});
