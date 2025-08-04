import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from 'src/infra/prisma/prisma.service';
import { FirebaseService } from './infra/firebase.service';

@Injectable()
export class FirebaseUploadService {
  private readonly logger = new Logger(FirebaseUploadService.name);
  constructor(
    readonly prisma: PrismaService,
    readonly firebaseService: FirebaseService
  ) { }

  async uploadFile(path: string, file: Express.Multer.File) {
    const fileType = file.mimetype.split('/')[1];
    const fileUrl = await this.firebaseService.uploadFile(file, `${path}/${Date.now()}.${fileType}`);
    return fileUrl;
  }
}