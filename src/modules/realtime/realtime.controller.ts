import { BadRequestException, Controller, Logger, MessageEvent, OnModuleInit, Param, Query, Req, Sse } from '@nestjs/common';
import { Request } from 'express';
import { Observable, Subject, Subscription, timer } from 'rxjs';

import { Public } from '../../decorators/public.decorator';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { EventsBusService } from '../events-bus/events-bus.service';
import { PresenceService } from '../presence/presence.service';
import { SseAuthService } from './sse-auth.service';
import {
  AuthExpiredEvent,
  HEARTBEAT_INTERVAL_MS,
  PING_EVENT,
  PingEvent,
  RealtimeEvent,
  SseConnection,
  SseManager,
  instanceIdOrDefault,
  newSseConnectionId,
} from './sse.manager';

interface StreetParams {
  territoryId: string;
  blockId: string;
  addressId: string;
}

interface QueryDto {
  s?: string;
  round?: string;
}

@Controller('v1/realtime')
export class RealtimeController implements OnModuleInit {
  private readonly logger = new Logger(RealtimeController.name);

  constructor(
    private readonly sseAuthService: SseAuthService,
    private readonly sseManager: SseManager,
    private readonly presenceService: PresenceService,
    private readonly eventsBus: EventsBusService,
    private readonly prisma: PrismaService
  ) {}

  onModuleInit(): void {
    this.logger.log(`RealtimeController inicializado (instance=${instanceIdOrDefault()})`);
  }

  @Sse('street/:territoryId/:blockId/:addressId')
  @Public()
  streamStreet(@Param() params: StreetParams, @Query() query: QueryDto): Observable<MessageEvent> {
    const { territoryId, blockId, addressId } = params;
    const round = Number(query.round);

    if (!territoryId || !blockId || !addressId || !Number.isFinite(round)) {
      throw new BadRequestException('Parâmetros de rota inválidos');
    }

    const streetKey = `house:${territoryId}:${blockId}:${addressId}:${round}`;

    return new Observable<MessageEvent>(subscriber => {
      let connectionId: string | null = null;
      let heartbeatTimer: Subscription | null = null;
      let removed = false;

      const teardown = async (reason: string): Promise<void> => {
        if (removed) return;
        removed = true;
        if (heartbeatTimer) {
          heartbeatTimer.unsubscribe();
          heartbeatTimer = null;
        }
        if (connectionId) {
          const id = connectionId;
          const identityKey = this.sseManager.getIdentityKey(id);
          const roomKeyFor = this.sseManager.getRoomKey(id);
          connectionId = null;
          this.sseManager.unregister(id);
          if (roomKeyFor && identityKey) {
            await this.prisma
              .$transaction(async tx => {
                await this.presenceService.leave(id, tx);
                await this.eventsBus.publishUserLeft(tx, {
                  streetKey: roomKeyFor,
                  identityKey,
                  presenceId: id,
                });
              })
              .catch(err => this.logger.warn(`Falha no teardown de presence: ${(err as Error).message}`));
          }
        }
        if (!subscriber.closed) {
          subscriber.complete();
        }
        this.logger.debug(`SSE fechado em ${streetKey}: ${reason}`);
      };

      void (async () => {
        try {
          const ctx = await this.sseAuthService.resolveBySignatureKey(query.s ?? '');
          const instanceId = instanceIdOrDefault();
          const id = newSseConnectionId();

          const subject = new Subject<RealtimeEvent | AuthExpiredEvent | PingEvent>();
          const connection: SseConnection = {
            id,
            roomKey: streetKey,
            identityKey: ctx.identityKey,
            tenantId: ctx.tenantId,
            signatureExpiresAt: ctx.signatureExpiresAt,
            subject,
            close: () => subscriber.complete(),
          };

          connectionId = id;
          this.sseManager.register(connection);

          subject.subscribe({
            next: (event: RealtimeEvent | AuthExpiredEvent | PingEvent) => subscriber.next(event as MessageEvent),
            error: (err: unknown) => {
              this.logger.warn(`Subject erro em ${streetKey}: ${String(err)}`);
              void teardown('subject-error');
            },
            complete: () => {
              void teardown('subject-complete');
            },
          });

          subscriber.next({
            type: 'connected',
            data: { streetKey, instanceId },
          });

          await this.prisma
            .$transaction(async tx => {
              const row = await this.presenceService.join(
                {
                  streetKey,
                  identityKey: ctx.identityKey,
                  connectionId: id,
                  instanceId,
                },
                tx
              );
              await this.eventsBus.publishUserJoined(tx, {
                streetKey,
                identityKey: ctx.identityKey,
                presenceId: row.presenceId,
              });
            })
            .catch(err => this.logger.warn(`Falha registrando presence: ${(err as Error).message}`));

          heartbeatTimer = timer(HEARTBEAT_INTERVAL_MS, HEARTBEAT_INTERVAL_MS).subscribe(() => {
            if (!subscriber.closed) subscriber.next(PING_EVENT);
          });
        } catch (err) {
          this.logger.warn(`Falha abrindo SSE em ${streetKey}: ${(err as Error).message}`);
          subscriber.next({
            type: 'error',
            data: { reason: (err as Error).message },
          });
          await teardown('auth-error');
        }
      })();

      return () => {
        void teardown('client-disconnect');
      };
    });
  }

  @Sse('waiting-room/:groupId')
  @Public()
  streamWaitingRoom(@Param('groupId') groupId: string, @Query() query: QueryDto, @Req() req: Request): Observable<MessageEvent> {
    if (!groupId) {
      throw new BadRequestException('Parâmetros de rota inválidos');
    }

    const roomKey = `waiting-room:${groupId}`;

    return new Observable<MessageEvent>(subscriber => {
      let connectionId: string | null = null;
      let heartbeatTimer: Subscription | null = null;
      let removed = false;

      const teardown = (reason: string): void => {
        if (removed) return;
        removed = true;
        if (heartbeatTimer) {
          heartbeatTimer.unsubscribe();
          heartbeatTimer = null;
        }
        if (connectionId) {
          this.sseManager.unregister(connectionId);
          connectionId = null;
        }
        if (!subscriber.closed) {
          subscriber.complete();
        }
        this.logger.debug(`SSE da sala fechado em ${roomKey}: ${reason}`);
      };

      void (async () => {
        try {
          const ctx = await this.sseAuthService.resolveTenantBySignatureKey(query.s ?? '');
          const sessionId = req.headers['session-id'];
          const identityKey = typeof sessionId === 'string' && sessionId ? sessionId : 'anonymous';
          const instanceId = instanceIdOrDefault();
          const id = newSseConnectionId();

          const subject = new Subject<RealtimeEvent | AuthExpiredEvent | PingEvent>();
          const connection: SseConnection = {
            id,
            roomKey,
            identityKey,
            tenantId: ctx.tenantId,
            signatureExpiresAt: null,
            subject,
            close: () => subscriber.complete(),
          };

          connectionId = id;
          this.sseManager.register(connection);

          subject.subscribe({
            next: (event: RealtimeEvent | AuthExpiredEvent | PingEvent) => subscriber.next(event as MessageEvent),
            error: (err: unknown) => {
              this.logger.warn(`Subject erro em ${roomKey}: ${String(err)}`);
              teardown('subject-error');
            },
            complete: () => {
              teardown('subject-complete');
            },
          });

          subscriber.next({
            type: 'connected',
            data: { roomKey, instanceId },
          });

          heartbeatTimer = timer(HEARTBEAT_INTERVAL_MS, HEARTBEAT_INTERVAL_MS).subscribe(() => {
            if (!subscriber.closed) subscriber.next(PING_EVENT);
          });
        } catch (err) {
          this.logger.warn(`Falha abrindo SSE da sala em ${roomKey}: ${(err as Error).message}`);
          subscriber.next({
            type: 'error',
            data: { reason: (err as Error).message },
          });
          teardown('auth-error');
        }
      })();

      return () => {
        teardown('client-disconnect');
      };
    });
  }
}
