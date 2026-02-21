import { Global, Module } from '@nestjs/common';
import { NameResolverService } from './name-resolver.service';

@Global()
@Module({
    providers: [NameResolverService],
    exports: [NameResolverService],
})
export class NameResolverModule { }
