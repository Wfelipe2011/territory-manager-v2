import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, VersioningType } from '@nestjs/common';
import { AppModule } from '../../src/app.module';
import { FirebaseService } from '../../src/infra/firebase.service';
import { PrismaService } from '../../src/infra/prisma/prisma.service';

export async function createSocketTestApp(): Promise<INestApplication> {
    const moduleFixture: TestingModule = await Test.createTestingModule({
        imports: [AppModule],
    })
        .overrideProvider(FirebaseService)
        .useValue({
            onModuleInit: jest.fn(),
            uploadFile: jest.fn(),
            console: {
                log: jest.fn(),
                error: jest.fn(),
            },
        })
        .compile();

    const app = moduleFixture.createNestApplication({
        logger: false,
    });

    app.enableVersioning({
        type: VersioningType.URI,
    });

    await app.init();
    return app;
}
