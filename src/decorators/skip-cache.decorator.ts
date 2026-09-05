import { SetMetadata } from '@nestjs/common';

export const SKIP_CACHE = 'skipCache';
export const SkipCache = () => SetMetadata(SKIP_CACHE, true);
