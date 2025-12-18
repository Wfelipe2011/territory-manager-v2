import { Logger, UseGuards } from '@nestjs/common';
import { WebSocketGateway, WebSocketServer, OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect, ConnectedSocket } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { AuthGuard } from '../auth/guard/auth.guard';
import * as jwt from 'jsonwebtoken';
import { envs } from 'src/infra/envs';

@WebSocketGateway({ transports: ['websocket'] })
export class UploadGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  logger = new Logger('UploadGateway');
  clients: { userId: number; socketId: string }[] = [];
  @WebSocketServer() server: Server;

  afterInit(server: Server) {
    this.logger.log('WebSocket gateway initialized');
  }

  @UseGuards(AuthGuard)
  handleConnection(@ConnectedSocket() client: Socket) {
    if (client.handshake.auth?.token) {
      const decode = jwt.verify(client.handshake.auth?.token, envs.JWT_SECRET) as any;
      this.clients.push({ userId: decode.userId, socketId: client.id });
      this.logger.log(`Client connected: ${decode.userName}-${decode.userId}-${client.id}`);
    }
    this.logger.log(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
    this.clients = this.clients.filter(c => c.socketId !== client.id);
  }

  sendProgress(userId: number, progress: number) {
    this.logger.log(`Tentando enviar progresso ${progress} para o usuário ${userId}`);
    const client = this.clients.find(client => client.userId === userId);
    if (!client) {
      this.logger.error(`Client not found for user ${userId}`);
      this.logger.log(`Clients: ${this.clients.map(c => c.userId).join(', ')}`);
      return;
    }
    this.logger.log(`Sending progress ${progress} to client ${client.socketId}`);
    this.server.to(String(client.socketId)).emit('uploadProgress', { progress });
  }
}
