import { Injectable, Logger } from '@nestjs/common';
import { Subject } from 'rxjs';

import { instanceIdFromEnv } from '../../infra/envs';

export interface SseConnection {
  id: string;
  roomKey: string;
  identityKey: string;
  tenantId: number;
  signatureExpiresAt: Date | null;
  subject: Subject<RealtimeEvent | AuthExpiredEvent | PingEvent>;
  close: () => void;
}

export type RealtimeEvent = MessageEventLike;

export interface MessageEventLike {
  type: string;
  data: unknown;
}

export interface AuthExpiredEvent {
  type: 'auth_expired';
  data: { reason: string };
}

export interface PingEvent {
  type: 'ping';
  data: Record<string, never>;
}

const HEARTBEAT_MS = 25_000;
const AUTH_CHECK_MS = 5_000;

@Injectable()
export class SseManager {
  private readonly logger = new Logger(SseManager.name);
  private readonly connections = new Map<string, Map<string, SseConnection>>();
  private readonly watchTimer = new Map<string, NodeJS.Timeout>();

  register(connection: SseConnection): void {
    let bucket = this.connections.get(connection.roomKey);
    if (!bucket) {
      bucket = new Map();
      this.connections.set(connection.roomKey, bucket);
    }
    bucket.set(connection.id, connection);
    this.logger.log(
      `Conexão ${connection.id} (identity=${connection.identityKey}, tenant=${connection.tenantId}) entrou em ${connection.roomKey} — ${bucket.size} conexões locais`
    );
    if (connection.signatureExpiresAt) {
      this.watchAuth(connection);
    }
  }

  unregister(connectionId: string): { roomKey: string; roomCount: number } | null {
    for (const [roomKey, bucket] of this.connections) {
      const found = bucket.get(connectionId);
      if (!found) continue;
      const timer = this.watchTimer.get(connectionId);
      if (timer) {
        clearInterval(timer);
        this.watchTimer.delete(connectionId);
      }
      bucket.delete(connectionId);
      found.subject.complete();
      const remaining = bucket.size;
      if (remaining === 0) {
        this.connections.delete(roomKey);
      }
      this.logger.log(`Conexão ${connectionId} removida de ${roomKey} — ${remaining} conexões locais restantes`);
      return { roomKey, roomCount: remaining };
    }
    return null;
  }

  broadcastToRoom(roomKey: string, event: RealtimeEvent): void {
    const bucket = this.connections.get(roomKey);
    if (!bucket || bucket.size === 0) return;
    for (const conn of bucket.values()) {
      try {
        conn.subject.next(event);
      } catch (err) {
        this.logger.warn(`Falha enviando evento para ${conn.id}: ${(err as Error).message}`);
      }
    }
    this.logger.debug(`Broadcast '${event.type}' em ${roomKey} para ${bucket.size} conexões`);
  }

  emitPresenceChanged(roomKey: string, userCount: number): void {
    this.broadcastToRoom(roomKey, {
      type: 'presence_changed',
      data: { streetKey: roomKey, userCount },
    });
  }

  getLocalUserCount(roomKey: string): number {
    return this.connections.get(roomKey)?.size ?? 0;
  }

  getTotalLocalConnections(): number {
    let total = 0;
    for (const bucket of this.connections.values()) total += bucket.size;
    return total;
  }

  getIdentityKey(connectionId: string): string | undefined {
    for (const bucket of this.connections.values()) {
      const c = bucket.get(connectionId);
      if (c) return c.identityKey;
    }
    return undefined;
  }

  getRoomKey(connectionId: string): string | undefined {
    for (const bucket of this.connections.values()) {
      const c = bucket.get(connectionId);
      if (c) return c.roomKey;
    }
    return undefined;
  }

  private watchAuth(connection: SseConnection): void {
    if (!connection.signatureExpiresAt) return;
    const check = (): void => {
      const remaining = connection.signatureExpiresAt!.getTime() - Date.now();
      if (remaining <= 0) {
        const event: AuthExpiredEvent = { type: 'auth_expired', data: { reason: 'signature_expired' } };
        try {
          connection.subject.next(event);
          connection.close();
        } catch {
          // ignore — connection may already be closed
        }
        const timer = this.watchTimer.get(connection.id);
        if (timer) {
          clearInterval(timer);
          this.watchTimer.delete(connection.id);
        }
      }
    };
    const timer = setInterval(check, AUTH_CHECK_MS);
    this.watchTimer.set(connection.id, timer);
  }
}

export function newSseConnectionId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `c-${Math.random().toString(36).slice(2)}-${Date.now()}`;
}

export const HEARTBEAT_INTERVAL_MS = HEARTBEAT_MS;
export const PING_EVENT: PingEvent = { type: 'ping', data: {} };

export function instanceIdOrDefault(): string {
  return instanceIdFromEnv();
}
