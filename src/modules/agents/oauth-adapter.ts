import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { digest } from './agent.config';

// Provider-owned protocol state survives restarts and multiple API instances.
export function oauthAdapter(prisma: PrismaService, encryptionKey: string) {
  const key = Buffer.from(encryptionKey, 'hex');
  const seal = (payload: unknown) => {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const value = Buffer.concat([cipher.update(JSON.stringify(payload)), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), value]).toString('base64');
  };
  const open = (payload: string) => {
    const value = Buffer.from(payload, 'base64');
    const cipher = createDecipheriv('aes-256-gcm', key, value.subarray(0, 12));
    cipher.setAuthTag(value.subarray(12, 28));
    return JSON.parse(Buffer.concat([cipher.update(value.subarray(28)), cipher.final()]).toString());
  };
  return class Adapter {
    constructor(public model: string) {}
    key(id: string) { return digest(`${this.model}:${id}`); }
    async upsert(id: string, payload: any, expiresIn: number) {
      const data = {
        model: this.model, payload: seal(payload), grantId: payload.grantId ? digest(payload.grantId) : null,
        uid: payload.uid ? digest(`${this.model}:${payload.uid}`) : null,
        userCode: payload.userCode ? digest(`${this.model}:${payload.userCode}`) : null,
        expiresAt: new Date(Date.now() + expiresIn * 1000),
      };
      await prisma.agent_oauth_artifact.upsert({ where: { key: this.key(id) }, create: { key: this.key(id), ...data }, update: data });
    }
    decode(row: any) {
      if (!row || row.expiresAt <= new Date()) return undefined;
      return { ...open(row.payload), ...(row.consumedAt ? { consumed: row.consumedAt } : {}) };
    }
    async find(id: string) { return this.decode(await prisma.agent_oauth_artifact.findUnique({ where: { key: this.key(id) } })); }
    async findByUid(uid: string) { return this.decode(await prisma.agent_oauth_artifact.findUnique({ where: { uid: digest(`${this.model}:${uid}`) } })); }
    async findByUserCode(code: string) { return this.decode(await prisma.agent_oauth_artifact.findUnique({ where: { userCode: digest(`${this.model}:${code}`) } })); }
    async destroy(id: string) { await prisma.agent_oauth_artifact.deleteMany({ where: { key: this.key(id) } }); }
    async consume(id: string) {
      const result = await prisma.agent_oauth_artifact.updateMany({ where: { key: this.key(id), consumedAt: null, expiresAt: { gt: new Date() } }, data: { consumedAt: Math.floor(Date.now() / 1000) } });
      if (result.count !== 1) throw new Error('OAuth artifact already consumed');
    }
    async revokeByGrantId(grantId: string) {
      await prisma.agent_oauth_artifact.deleteMany({ where: { grantId: digest(grantId) } });
      await prisma.agent_connection.updateMany({ where: { id: grantId }, data: { revokedAt: new Date() } });
    }
  };
}
