import { Test, TestingModule } from '@nestjs/testing';
import { OfflineController } from './offline.controller';

describe('OfflineController', () => {
  let controller: OfflineController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [OfflineController],
    }).compile();

    controller = module.get<OfflineController>(OfflineController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
