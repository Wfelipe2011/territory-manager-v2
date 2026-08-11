export const envs = {
  JWT_SECRET: process.env.JWT_SECRET!,
  DATABASE_URL: process.env.DATABASE_URL!,
  AWS_REGION: process.env.AWS_REGION || 'us-east-1',
  AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID,
  AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
  CLOUDWATCH_LOG_GROUP: process.env.CLOUDWATCH_LOG_GROUP || 'territory-manager',
  LOG_LEVEL: process.env.LOG_LEVEL || 'debug',
  INSTANCE_ID: process.env.INSTANCE_ID,
  PGBOSS_SCHEMA: process.env.PGBOSS_SCHEMA || 'pgboss',
};

export function instanceIdFromEnv(): string {
  return process.env.INSTANCE_ID || 'unknown';
}
