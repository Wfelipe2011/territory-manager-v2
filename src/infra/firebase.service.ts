import * as admin from 'firebase-admin';
import { Injectable } from '@nestjs/common';
import * as path from 'path';

@Injectable()
export class FirebaseService {
  constructor() {
    const serviceAccount = path.join(__dirname, '../../territorio-digital-firebase-adminsdk-yccxd-cb53a20e51.json');

    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      storageBucket: 'territorio-digital.appspot.com',
    });
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
}
