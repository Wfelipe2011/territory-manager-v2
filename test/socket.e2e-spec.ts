import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { io, Socket } from 'socket.io-client';
import { createSocketTestApp } from './utils/socket-app-helper';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { createTestToken } from './utils/auth-helper';
import { Role } from '../src/enum/role.enum';
import { UploadGateway } from '../src/modules/gateway/upload.gateway';
import { EventsGateway } from '../src/modules/gateway/event.gateway';
import { PaypalService } from '../src/modules/gateway/paypal.service';
import { cleanDatabase } from './utils/db-cleaner';

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
            reconnection: false
        });
        sockets.push(socket);
        return socket;
    };

    describe('EventsGateway', () => {
        it('should connect and join a room', (done) => {
            const token = createTestToken({ roles: [Role.ADMIN], tenantId: 1 });
            const socket = createSocket(token);

            socket.on('connect', () => {
                const roomName = 'test-room';
                socket.emit('join', { roomName, username: 'test-user' });
            });

            socket.on('test-room', (data) => {
                if (data.type === 'user_joined') {
                    expect(data.data.userCount).toBe(1);
                    socket.disconnect();
                    done();
                }
            });

            socket.on('connect_error', (err) => {
                done(err);
            });
        });

        it('should receive update_house event when a house is updated via HTTP', async () => {
            // Seed data
            const tenant = await prisma.multitenancy.create({ data: { name: 'Test Tenant' } });
            const type = await prisma.type.create({ data: { name: 'Test Type', tenantId: tenant.id } });
            const territory = await prisma.territory.create({ data: { name: 'Test Territory', tenantId: tenant.id, typeId: type.id } });
            const block = await prisma.block.create({ data: { name: 'Test Block', tenantId: tenant.id } });
            const address = await prisma.address.create({ data: { name: 'Test Address', tenantId: tenant.id } });
            const house = await prisma.house.create({
                data: {
                    number: '123',
                    tenantId: tenant.id,
                    territoryId: territory.id,
                    blockId: block.id,
                    addressId: address.id
                }
            });

            await prisma.round.create({
                data: {
                    houseId: house.id,
                    roundNumber: 1,
                    completed: false,
                    tenantId: tenant.id,
                    blockId: block.id,
                    territoryId: territory.id,
                }
            });

            const token = createTestToken({ roles: [Role.ADMIN], tenantId: tenant.id });
            const socket = createSocket(token);

            const roomName = `${territory.id}-${block.id}-${address.id}-1`;

            await new Promise<void>((resolve, reject) => {
                socket.on('connect', () => {
                    socket.emit('join', { roomName, username: 'test-user' });
                });

                socket.on(roomName, (data) => {
                    if (data.type === 'user_joined') {
                        resolve();
                    }
                });

                socket.on('connect_error', reject);
            });

            // Act
            const response = await request(httpServer)
                .patch(`/v1/territories/${territory.id}/blocks/${block.id}/address/${address.id}/houses/${house.id}`)
                .set('Authorization', `Bearer ${token}`)
                .send({ status: true, round: 1 });

            expect(response.status).toBe(200);

            // Assert
            await new Promise<void>((resolve) => {
                socket.on(roomName, (data) => {
                    if (data.type === 'update_house') {
                        expect(+data.data.houseId).toBe(house.id);
                        expect(data.data.completed).toBe(true);
                        resolve();
                    }
                });
            });

            socket.disconnect();
        });

        it('should handle user disconnection and emit user_left', async () => {
            const token = createTestToken({ roles: [Role.ADMIN], tenantId: 1 });
            const socket1 = createSocket(token);
            const socket2 = createSocket(token);
            const roomName = 'disconnect-room';

            // Join both sockets
            await new Promise<void>((resolve) => {
                let joined = 0;
                const onJoined = (data: any) => {
                    if (data.type === 'user_joined') {
                        joined++;
                        if (joined === 2) resolve();
                    }
                };
                socket1.on('connect', () => socket1.emit('join', { roomName, username: 'user1' }));
                socket2.on('connect', () => socket2.emit('join', { roomName, username: 'user2' }));
                socket1.on(roomName, onJoined);
                socket2.on(roomName, onJoined);
            });

            // Disconnect socket1 and wait for user_left on socket2
            const leftPromise = new Promise<void>((resolve) => {
                socket2.on(roomName, (data) => {
                    if (data.type === 'user_left') {
                        expect(data.data.userCount).toBe(1);
                        resolve();
                    }
                });
            });

            socket1.disconnect();
            await leftPromise;

            socket2.disconnect();
        });

        it('should handle cron cleanup of disconnected sockets', async () => {
            const eventsGateway = app.get(EventsGateway);
            const deadRoom = 'cron-room';
            const liveRoom = 'live-room';
            const deadSocketId = 'dead-socket-id';

            // Conectar um socket real e entrar em liveRoom
            const token = createTestToken({ roles: [Role.ADMIN], tenantId: 1 });
            const socket = createSocket(token);
            await new Promise<void>((resolve) => {
                socket.on('connect', () => {
                    socket.emit('join', { roomName: liveRoom, username: 'live-user' });
                });
                socket.on(liveRoom, (data) => {
                    if (data.type === 'user_joined') resolve();
                });
            });

            // Injetar manualmente um socket fantasma nos Maps
            const activeRooms: Map<string, Set<string>> = (eventsGateway as any).activeRooms;
            const socketToRoom: Map<string, string> = (eventsGateway as any).socketToRoom;
            activeRooms.set(deadRoom, new Set([deadSocketId]));
            socketToRoom.set(deadSocketId, deadRoom);

            // Antes do cron: fantasma + vivo presentes
            expect(socketToRoom.has(deadSocketId)).toBe(true);
            expect(socketToRoom.has(socket.id)).toBe(true);

            eventsGateway.handleCron();

            // Após o cron: fantasma removido, vivo preservado
            expect(socketToRoom.has(deadSocketId)).toBe(false);
            expect(activeRooms.has(deadRoom)).toBe(false);
            expect(socketToRoom.has(socket.id)).toBe(true);

            socket.disconnect();
        });

        it('should log when no sockets are disconnected in handleCron', async () => {
            const eventsGateway = app.get(EventsGateway);
            const loggerSpy = jest.spyOn((eventsGateway as any).logger, 'debug');

            // Garantir Maps vazios (nenhum socket registrado)
            (eventsGateway as any).activeRooms.clear();
            (eventsGateway as any).socketToRoom.clear();

            eventsGateway.handleCron();

            expect(loggerSpy).toHaveBeenCalledWith('Nenhum socket obsoleto encontrado');
        });

        it('should return early in emitRoom if no entity is found', async () => {
            const eventsGateway = app.get(EventsGateway);
            const result = await eventsGateway.emitRoom('non-existent-room', { type: 'test' });
            expect(result).toBeUndefined();
        });

        it('should registrar sessão no banco ao conectar e fechar ao desconectar', async () => {
            const tenant = await prisma.multitenancy.create({ data: { name: 'Tenant Log Test' } });
            const token = createTestToken({ roles: [Role.ADMIN], tenantId: tenant.id });
            const socket = createSocket(token);
            const roomName = 'session-log-room';

            await new Promise<void>((resolve) => {
                socket.on('connect', () => socket.emit('join', { roomName, username: 'log-user' }));
                socket.on(roomName, (data) => { if (data.type === 'user_joined') resolve(); });
            });

            // Aguarda o setImmediate do create completar
            await new Promise(r => setTimeout(r, 100));

            const record = await prisma.socket.findFirst({ where: { socketId: socket.id } });
            expect(record).not.toBeNull();
            expect(record!.tenantId).toBe(tenant.id);
            expect(record!.disconnectedAt).toBeNull();

            socket.disconnect();

            // Aguarda o setImmediate do updateMany completar
            await new Promise(r => setTimeout(r, 100));

            const updated = await prisma.socket.findFirst({ where: { socketId: socket.id } });
            expect(updated!.disconnectedAt).not.toBeNull();
        });
    });

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

            const progressPromise = new Promise<void>((resolve) => {
                socket.on('uploadProgress', (data) => {
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

            await new Promise<void>((resolve) => {
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
