import { BadGatewayException, Logger, UseGuards } from '@nestjs/common';
import { SubscribeMessage, MessageBody, WebSocketGateway, ConnectedSocket, WebSocketServer } from '@nestjs/websockets';
import { Socket, Server } from 'socket.io';
import { PrismaService } from 'src/infra/prisma.service';
import { AuthGuard } from '../auth/guard/auth.guard';
import { Cron, CronExpression } from '@nestjs/schedule';

interface User {
  id: string;
  userId: number;
  roles: string[];
}

@WebSocketGateway({ transports: ['websocket'] })
export class EventsGateway {
  @WebSocketServer() server: Server;
  private logger = new Logger(EventsGateway.name);
  constructor(private prisma: PrismaService) {}

  @UseGuards(AuthGuard)
  @SubscribeMessage('join')
  async handleJoinEvent(@MessageBody() data: { roomName: string; username: string }, @ConnectedSocket() client: Socket & { user: User }) {
    // if (!client.handshake.query.key) throw new Error('Chave de autenticação não informada');
    const { roomName, username } = data;
    try {
      await this.prisma.socket.create({
        data: {
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
    this.logger.log(`Emitindo evento ${data.type} para a sala ${roomName}`);
    const entity = await this.prisma.socket.findFirst({
      where: {
        room: roomName,
      },
    });
    if (!entity) return;
    this.server.to(roomName).emit(`${roomName}`, data);
  }

  @Cron(CronExpression.EVERY_DAY_AT_1AM)
  async deleteSockets() {
    this.logger.log('Deletando sockets expirados');
    const { count } = await this.prisma.socket.deleteMany();
    this.logger.log(`Sockets deletados: ${count}`);
  }
}
