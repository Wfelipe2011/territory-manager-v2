import { Logger, UseGuards } from '@nestjs/common';
import { SubscribeMessage, MessageBody, WebSocketGateway, ConnectedSocket, WebSocketServer, OnGatewayInit } from '@nestjs/websockets';
import { Socket, Server } from 'socket.io';
import { PrismaService } from 'src/infra/prisma/prisma.service';
import { AuthGuard } from '../auth/guard/auth.guard';
import { Cron, CronExpression } from '@nestjs/schedule';

interface User {
  id: string;
  userId: number;
  roles: string[];
}

@WebSocketGateway({ transports: ['websocket'] })
export class EventsGateway implements OnGatewayInit {
  @WebSocketServer() server: Server;
  private logger = new Logger(EventsGateway.name);
  constructor(private prisma: PrismaService) { }

  afterInit() {
    this.logger.log('WebSocket Gateway initialized');
  }

  @UseGuards(AuthGuard)
  @SubscribeMessage('join')
  async handleJoinEvent(@MessageBody() data: { roomName: string; username: string }, @ConnectedSocket() client: Socket & { user: User }) {
    const { roomName, username } = data;
    try {
      await this.prisma.socket.upsert({
        where: {
          socketId: client.id,
        },
        update: {
          room: roomName,
        },
        create: {
          room: roomName,
          socketId: client.id,
        },
      });

      this.logger.log(`Usuário ${username} entrou na sala ${roomName}`);
      client.join(roomName);

      const roomCount = await this.prisma.socket.count({
        where: {
          room: roomName,
        },
      });

      this.server.to(roomName).emit(`${roomName}`, {
        type: 'user_joined',
        data: {
          userCount: roomCount,
        },
      });

      this.logger.log(`Sala ${roomName} possui ${roomCount} usuários`);
    } catch (error) {
      this.logger.error(`Erro ao criar socket ${JSON.stringify({ username, roomName, error }, null, 2)}`);
    }
  }

  @UseGuards(AuthGuard)
  @SubscribeMessage('disconnect')
  async handleDisconnect(@ConnectedSocket() client: Socket) {
    this.logger.log(`Usuário desconectado ${client.id}`);
    const socketEntity = await this.prisma.socket.findFirst({
      where: {
        socketId: client.id,
      },
    });

    if (socketEntity) {
      this.logger.log(`Usuário desconectado da sala ${socketEntity.room} - ${client.id}`);

      await this.prisma.socket
        .delete({
          where: {
            id: socketEntity.id,
          },
        })
        .catch(error => {
          this.logger.error(`Erro ao deletar socket ${JSON.stringify({ socketEntity, error }, null, 2)}`);
        });

      const roomCount = await this.prisma.socket.count({
        where: {
          room: socketEntity.room,
        },
      });

      this.server.to(socketEntity.room).emit(`${socketEntity.room}`, {
        type: 'user_left',
        data: {
          userCount: roomCount,
        },
      });

      this.logger.log(`Sala ${socketEntity.room} possui ${roomCount} usuários`);
    }
  }

  async emitRoom(roomName: string, data: any) {
    this.logger.debug(`Emitindo evento ${data.type} para a sala ${roomName}`);
    const entity = await this.prisma.socket.findFirst({
      where: {
        room: roomName,
      },
    });
    if (!entity) return;
    this.server.to(roomName).emit(`${roomName}`, data);
  }

  @Cron(CronExpression.EVERY_30_SECONDS)
  async handleCron() {
    this.logger.debug('Iniciando verificação de sockets');
    await this.prisma.connectToDatabase();
    this.logger.debug('Buscando sockets no banco de dados');
    const sockets = await this.prisma.socket.findMany();
    const socketIds = sockets.map(socket => socket.socketId);
    this.logger.debug('Sockets encontrados: ' + socketIds);
    const connectedSockets = Array.from(this.server.sockets.sockets.keys());
    this.logger.debug('Sockets conectados: ' + connectedSockets);

    const disconnectedSockets = socketIds.filter(socketId => !connectedSockets.includes(socketId));
    if (disconnectedSockets.length === 0) {
      this.logger.debug('Nenhum socket desconectado');
      return;
    }
    this.logger.log('Sockets desconectados: ' + disconnectedSockets);

    this.logger.log('Desconectando sockets do banco de dados');
    await this.prisma.socket.deleteMany({
      where: {
        socketId: {
          in: disconnectedSockets,
        },
      },
    });

    this.logger.log('Emitindo evento de saída para as salas');
    const socketsConnected = await this.prisma.socket.findMany({
      select: {
        room: true,
      },
      distinct: ['room'],
    });
    await Promise.all(
      socketsConnected.map(async skt => {
        const roomCount = await this.prisma.socket.count({
          where: {
            room: skt.room,
          },
        });
        this.logger.log(`Emitindo evento de saída para a sala ${skt.room} com ${roomCount} usuários`);
        this.server.to(skt.room).emit(`${skt.room}`, {
          type: 'user_left',
          data: {
            userCount: roomCount,
          },
        });
      })
    );

    this.logger.debug('Verificação de sockets finalizada');
  }
}
