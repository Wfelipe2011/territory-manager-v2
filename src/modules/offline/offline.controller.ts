import { Controller, Get, Param, Query, Post, Body } from '@nestjs/common';
import { OfflineService } from './offline.service';
import { VERSION } from '../../enum/version.enum';
import { Public } from '../../decorators/public.decorator';

@Controller({
    version: VERSION.V2,
    path: 'offline',
})
export class OfflineController {
    constructor(private readonly offlineService: OfflineService) { }

    @Public()
    @Get('snapshot/:territoryId')
    async getSnapshot(
        @Param('territoryId') territoryId: number,
        @Query('signature') signature: string,
    ) {
        return this.offlineService.getSnapshot(territoryId, signature);
    }

    @Public()
    @Post('sync')
    async sync(
        @Query('signature') signature: string,
        @Body() body: { territoryId: number; changes: any[] },
    ) {
        return this.offlineService.sync(signature, body);
    }
}
