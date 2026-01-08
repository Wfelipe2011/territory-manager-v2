import { Test, TestingModule } from '@nestjs/testing';
import { OfflineService } from './offline.service';

describe('OfflineService', () => {
  let service: OfflineService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [OfflineService],
    }).compile();

    service = module.get<OfflineService>(OfflineService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
