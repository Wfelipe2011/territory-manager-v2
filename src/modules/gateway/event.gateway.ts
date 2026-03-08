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
  /** sala → conjunto de usernames (UUID do front) ativos */
  private readonly activeRooms = new Map<string, Set<string>>();
  /** client.id → sala (lookup reverso para O(1) no disconnect) */
  private readonly socketToRoom = new Map<string, string>();
  /** client.id → username (UUID do front, para uso em disconnect/cron) */
  private readonly socketToUsername = new Map<string, string>();

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
      this.activeRooms.get(roomName)!.add(username);
      this.socketToRoom.set(client.id, roomName);
      this.socketToUsername.set(client.id, username);

      const roomCount = this.activeRooms.get(roomName)!.size;

      this.logger.log(`Usuário ${username} entrou na sala ${roomName} (${roomCount} usuários)`);

      // Log assíncrono — não bloqueia o caminho crítico
      const tenantId = client.user?.tenantId;
      if (tenantId) {
        setImmediate(() =>
          this.prisma.socket.upsert({
            where: { socketId: username },
            create: { socketId: username, room: roomName, tenantId },
            update: { room: roomName, disconnectedAt: null, createdAt: new Date() },
          }).catch(e => this.logger.warn(`Erro ao registrar sessão: ${e.message}`))
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
    const username = this.socketToUsername.get(client.id);
    if (!room) return;

    this.removeSocketFromRoom(client.id, room);
    const roomCount = this.activeRooms.get(room)?.size ?? 0;

    this.logger.log(`Usuário saiu da sala ${room} - ${username ?? client.id} (${roomCount} usuários restantes)`);

    // Log assíncrono — fechar intervalo da sessão
    if (username) {
      setImmediate(() =>
        this.prisma.socket.updateMany({ where: { socketId: username, disconnectedAt: null }, data: { disconnectedAt: new Date() } })
          .catch(e => this.logger.warn(`Erro ao fechar sessão: ${e.message}`))
      );
    }

    this.server.to(room).emit(`${room}`, {
      type: 'user_left',
      data: { userCount: roomCount },
    });
  }

  getConnectedSocketCount(): number {
    return new Set(this.socketToUsername.values()).size;
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
    const staleUsernames = staleIds
      .map(id => this.socketToUsername.get(id))
      .filter((u): u is string => !!u);

    if (staleUsernames.length > 0) {
      setImmediate(() =>
        this.prisma.socket.updateMany({ where: { socketId: { in: staleUsernames }, disconnectedAt: null }, data: { disconnectedAt: new Date() } })
          .catch(e => this.logger.warn(`Erro ao fechar sessões obsoletas: ${e.message}`))
      );
    }

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
    const username = this.socketToUsername.get(socketId);
    this.socketToRoom.delete(socketId);
    this.socketToUsername.delete(socketId);

    if (username) {
      // Só remove o username da sala se nenhuma outra aba/conexão do mesmo usuário ainda estiver nela
      const hasOtherTab = [...this.socketToRoom.entries()]
        .some(([sid, r]) => r === room && this.socketToUsername.get(sid) === username);

      if (!hasOtherTab) {
        const roomSockets = this.activeRooms.get(room);
        if (roomSockets) {
          roomSockets.delete(username);
          if (roomSockets.size === 0) this.activeRooms.delete(room);
        }
      }
    }
  }
}
