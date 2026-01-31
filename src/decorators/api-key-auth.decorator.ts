import { SetMetadata } from '@nestjs/common';

export const IS_API_KEY_AUTH = 'isApiKeyAuth';
export const ApiKeyAuth = () => SetMetadata(IS_API_KEY_AUTH, true);
