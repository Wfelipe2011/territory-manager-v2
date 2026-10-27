import { agentConfig, agentTenantEnabled } from '../modules/agents/agent.config';

describe('Liberação de tenants MCP', () => {
  const prior = { ...process.env };
  afterEach(() => {
    for (const key of Object.keys(process.env)) if (key.startsWith('AGENT_')) delete process.env[key];
    Object.assign(process.env, prior);
  });

  it('bloqueia todos quando a lista está ausente ou vazia', () => {
    process.env.AGENT_MCP_ENABLED = 'true';
    delete process.env.AGENT_MCP_ALLOWED_TENANT_IDS;
    expect(agentTenantEnabled(1)).toBe(false);
    process.env.AGENT_MCP_ALLOWED_TENANT_IDS = '  ';
    expect(agentTenantEnabled(1)).toBe(false);
  });

  it('exige ativação global e ID exato na lista', () => {
    process.env.AGENT_MCP_ALLOWED_TENANT_IDS = '1, 23,1';
    process.env.AGENT_MCP_ENABLED = 'false';
    expect(agentTenantEnabled(1)).toBe(false);
    process.env.AGENT_MCP_ENABLED = 'true';
    expect(agentTenantEnabled(1)).toBe(true);
    expect(agentTenantEnabled(23)).toBe(true);
    expect(agentTenantEnabled(2)).toBe(false);
  });

  it('recusa curingas, entradas parciais e IDs inválidos na configuração', () => {
    process.env.AGENT_MCP_ENABLED = 'false';
    for (const value of ['*', '1,', '1,,2', '0', '-1', '1.5', '1x', '1e3', '9007199254740992']) {
      process.env.AGENT_MCP_ALLOWED_TENANT_IDS = value;
      expect(() => agentConfig()).toThrow('AGENT_MCP_ALLOWED_TENANT_IDS');
    }
  });
});
