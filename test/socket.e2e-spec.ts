import { INestApplication } from '@nestjs/common';
import { io, Socket } from 'socket.io-client';
import request from 'supertest';

import { Role } from '../src/enum/role.enum';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { PaypalService } from '../src/modules/gateway/paypal.service';
import { UploadGateway } from '../src/modules/gateway/upload.gateway';
import { createTestToken } from './utils/auth-helper';
import { cleanDatabase } from './utils/db-cleaner';
import { createSocketTestApp } from './utils/socket-app-helper';

jest.setTimeout(60000);

describe('WebSocket Integration (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let httpServer: any;
  let port: number;
  const sockets: Socket[] = [];

  beforeAll(async () => {
    app = await createSocketTestApp();
    prisma = app.get(PrismaService);
    httpServer = app.getHttpServer();
    await app.listen(0);
    const address = app.getHttpServer().address();
    port = typeof address === 'string' ? 0 : address.port;
  }, 30000);

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await cleanDatabase(prisma);
  });

  afterEach(() => {
    while (sockets.length > 0) {
      const socket = sockets.pop();
      if (socket && socket.connected) {
        socket.disconnect();
      }
    }
  });

  const createSocket = (token: string): Socket => {
    const url = `http://127.0.0.1:${port}`;
    const socket = io(url, {
      transports: ['websocket'],
      auth: { token },
      forceNew: true,
      reconnection: false,
    });
    sockets.push(socket);
    return socket;
  };

  describe('UploadGateway', () => {
    it('should receive uploadProgress events', async () => {
      const userId = 123;
      const token = createTestToken({ roles: [Role.ADMIN], tenantId: 1, userId });
      const socket = createSocket(token);

      await new Promise<void>((resolve, reject) => {
        socket.on('connect', resolve);
        socket.on('connect_error', reject);
      });

      const uploadGateway = app.get(UploadGateway);

      const progressPromise = new Promise<void>(resolve => {
        socket.on('uploadProgress', data => {
          expect(data.progress).toBe(50);
          resolve();
        });
      });

      uploadGateway.sendProgress(userId, 50);

      await progressPromise;
      socket.disconnect();
    });

    it('should handle sendProgress when client is not found', () => {
      const uploadGateway = app.get(UploadGateway);
      const loggerSpy = jest.spyOn(uploadGateway.logger, 'error');

      uploadGateway.sendProgress(999, 50);

      expect(loggerSpy).toHaveBeenCalledWith('Client not found for user 999');
    });

    it('should remove client from list on disconnect', async () => {
      const userId = 456;
      const token = createTestToken({ roles: [Role.ADMIN], tenantId: 1, userId });
      const socket = createSocket(token);

      await new Promise<void>(resolve => {
        socket.on('connect', resolve);
      });

      const uploadGateway = app.get(UploadGateway);
      expect(uploadGateway.clients.some(c => c.userId === userId)).toBe(true);

      socket.disconnect();

      // Wait a bit for handleDisconnect to be called
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(uploadGateway.clients.some(c => c.userId === userId)).toBe(false);
    });
  });

  describe('PaypalService', () => {
    it('should be defined', () => {
      const service = app.get(PaypalService);
      expect(service).toBeDefined();
    });
  });
});
