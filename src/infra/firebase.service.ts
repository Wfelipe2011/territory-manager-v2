import * as admin from 'firebase-admin';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from './prisma/prisma.service';

@Injectable()
export class FirebaseService implements OnModuleInit {
  private logger = new Logger(FirebaseService.name)
  constructor(private prisma: PrismaService) { }

  async onModuleInit() {
    this.logger.log('Inicializando Firebase Admin SDK');
    await this.prisma.connectToDatabase()
    this.logger.log('Conectado ao banco de dados');
    const firebase = await this.prisma.firebase.findFirst()
    admin.initializeApp({
      credential: admin.credential.cert(firebase?.config as any),
      storageBucket: 'territorio-digital.appspot.com',
    });
    this.logger.log('Firebase Admin SDK inicializado com sucesso');
  }

  async uploadFile(file: Express.Multer.File, name: string) {
    const bucket = admin.storage().bucket();

    // Crie um arquivo com o nome desejado no Firebase Storage
    const blob = bucket.file(name);
    const blobStream = blob.createWriteStream({
      resumable: false,
    });

    return new Promise((resolve, reject) => {
      blobStream.on('error', reject);
      blobStream.on('finish', () => {
        // Define as permissões para o arquivo
        blob.makePublic().then(() => {
          resolve(`https://storage.googleapis.com/${bucket.name}/${blob.name}`);
        });
      });
      blobStream.end(file.buffer);
    });
  }

  async deleteFileByUrl(fileUrl: string): Promise<void> {
    const bucket = admin.storage().bucket();

    // Extrair o caminho do arquivo a partir da URL
    const filePath = fileUrl.replace('https://storage.googleapis.com/territorio-digital.appspot.com/', '');

    // Deletar o arquivo
    const file = bucket.file(filePath);

    return file
      .delete()
      .then(() => {
        this.logger.log(`Arquivo ${filePath} deletado com sucesso.`);
      })
      .catch(error => {
        this.logger.error(`Erro ao deletar o arquivo ${filePath}:`, error);
        throw new Error('Erro ao deletar o arquivo');
      });
  }
}
