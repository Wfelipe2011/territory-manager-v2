import { createParamDecorator, ExecutionContext, Logger } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { envs } from './envs';

export const Loggable = createParamDecorator((data: unknown, ctx: ExecutionContext) => {
  const request = ctx.switchToHttp().getRequest();
  let token = '';
  try {
    token = request.headers.authorization.split(' ')[1];
    const decode = jwt.verify(token, envs.JWT_SECRET) as any;
    return new Logger(`${decode.userName}-${decode.userId}`);
  } catch (error) {
    const uuid = Math.random().toString(36).substring(7);
    return new Logger(`${uuid}`);
  }
});
