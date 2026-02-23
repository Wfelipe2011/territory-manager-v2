import { Logger, UseGuards } from '@nestjs/common';
import { SubscribeMessage, MessageBody, WebSocketGateway, ConnectedSocket, WebSocketServer, OnGatewayInit } from '@nestjs/websockets';
import { Socket, Server } from 'socket.io';
import { PrismaService } from 'src/infra/prisma/prisma.service';
import { AuthGuard } from '../auth/guard/auth.guard';
import { Cron, CronExpression } from '@nestjs/schedule';

interface User {
  id: string;
  userId: number;
  tenantId: number;
  roles: string[];
}

@WebSocketGateway({ transports: ['websocket'] })
export class EventsGateway implements OnGatewayInit {
  @WebSocketServer() server: Server;
  private logger = new Logger(EventsGateway.name);
  /** sala → conjunto de socketIds ativos */
  private readonly activeRooms = new Map<string, Set<string>>();
  /** socketId → sala (lookup reverso para O(1) no disconnect) */
  private readonly socketToRoom = new Map<string, string>();

  constructor(private readonly prisma: PrismaService) { }

  afterInit() {
    this.logger.log('WebSocket Gateway initialized');
  }

  @UseGuards(AuthGuard)
  @SubscribeMessage('join')
  handleJoinEvent(@MessageBody() data: { roomName: string; username: string }, @ConnectedSocket() client: Socket & { user: User }) {
    const { roomName, username } = data;
    try {
      // Remove de sala anterior, caso o socket já estivesse em outra
      const previousRoom = this.socketToRoom.get(client.id);
      if (previousRoom && previousRoom !== roomName) {
        this.removeSocketFromRoom(client.id, previousRoom);
      }

      client.join(roomName);

      if (!this.activeRooms.has(roomName)) {
        this.activeRooms.set(roomName, new Set());
      }
      this.activeRooms.get(roomName)!.add(client.id);
      this.socketToRoom.set(client.id, roomName);

      const roomCount = this.activeRooms.get(roomName)!.size;

      this.logger.log(`Usuário ${username} entrou na sala ${roomName} (${roomCount} usuários)`);

      // Log assíncrono — não bloqueia o caminho crítico
      const tenantId = client.user?.tenantId;
      if (tenantId) {
        setImmediate(() =>
          this.prisma.socket.create({ data: { socketId: client.id, room: roomName, tenantId } })
            .catch(e => this.logger.warn(`Erro ao registrar sessão: ${e.message}`))
        );
      }

      this.server.to(roomName).emit(`${roomName}`, {
        type: 'user_joined',
        data: { userCount: roomCount },
      });
    } catch (error) {
      this.logger.error(`Erro ao entrar na sala ${JSON.stringify({ username, roomName, error }, null, 2)}`);
    }
  }

  @UseGuards(AuthGuard)
  @SubscribeMessage('disconnect')
  handleDisconnect(@ConnectedSocket() client: Socket) {
    this.logger.log(`Usuário desconectado ${client.id}`);
    const room = this.socketToRoom.get(client.id);
    if (!room) return;

    this.removeSocketFromRoom(client.id, room);
    const roomCount = this.activeRooms.get(room)?.size ?? 0;

    this.logger.log(`Usuário saiu da sala ${room} - ${client.id} (${roomCount} usuários restantes)`);

    // Log assíncrono — fechar intervalo da sessão
    const socketId = client.id;
    setImmediate(() =>
      this.prisma.socket.updateMany({ where: { socketId, disconnectedAt: null }, data: { disconnectedAt: new Date() } })
        .catch(e => this.logger.warn(`Erro ao fechar sessão: ${e.message}`))
    );

    this.server.to(room).emit(`${room}`, {
      type: 'user_left',
      data: { userCount: roomCount },
    });
  }

  getConnectedSocketCount(): number {
    return this.socketToRoom.size;
  }

  emitRoom(roomName: string, data: any) {
    this.logger.debug(`Emitindo evento ${data.type} para a sala ${roomName}`);
    const roomSockets = this.activeRooms.get(roomName);
    if (!roomSockets || roomSockets.size === 0) return;
    this.server.to(roomName).emit(`${roomName}`, data);
  }

  @Cron(CronExpression.EVERY_30_SECONDS)
  handleCron() {
    this.logger.debug('Iniciando verificação de sockets em memória');
    const liveSocketIds = new Set(this.server.sockets.sockets.keys());
    const staleIds: string[] = [];

    for (const [socketId] of this.socketToRoom) {
      if (!liveSocketIds.has(socketId)) {
        staleIds.push(socketId);
      }
    }

    if (staleIds.length === 0) {
      this.logger.debug('Nenhum socket obsoleto encontrado');
      return;
    }

    this.logger.log(`Removendo ${staleIds.length} socket(s) obsoleto(s): ${staleIds}`);

    // Log assíncrono — fechar intervalos das sessões fantasma
    setImmediate(() =>
      this.prisma.socket.updateMany({ where: { socketId: { in: staleIds }, disconnectedAt: null }, data: { disconnectedAt: new Date() } })
        .catch(e => this.logger.warn(`Erro ao fechar sessões obsoletas: ${e.message}`))
    );

    const affectedRooms = new Set<string>();
    for (const staleId of staleIds) {
      const room = this.socketToRoom.get(staleId);
      if (room) {
        affectedRooms.add(room);
        this.removeSocketFromRoom(staleId, room);
      }
    }

    for (const room of affectedRooms) {
      const roomCount = this.activeRooms.get(room)?.size ?? 0;
      this.logger.log(`Emitindo user_left para sala ${room} (${roomCount} usuários)`);
      this.server.to(room).emit(`${room}`, {
        type: 'user_left',
        data: { userCount: roomCount },
      });
    }

    this.logger.debug('Verificação de sockets finalizada');
  }

  private removeSocketFromRoom(socketId: string, room: string) {
    this.socketToRoom.delete(socketId);
    const roomSockets = this.activeRooms.get(room);
    if (roomSockets) {
      roomSockets.delete(socketId);
      if (roomSockets.size === 0) this.activeRooms.delete(room);
    }
  }
}
