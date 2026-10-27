import { z } from 'zod';

const id = z.number().int().positive();
const name = z.string().trim().min(1).max(200);
const page = { page: z.number().int().min(1).max(100000).default(1), limit: z.number().int().min(1).max(100).default(25), search: z.string().trim().max(200).optional() };
const write = { idempotencyKey: z.string().min(8).max(100).regex(/^[a-zA-Z0-9_-]+$/).describe('Chave única por intenção. Reutilize a mesma chave ao repetir uma chamada com os mesmos dados.') };
const edit = { ...write, expectedVersion: z.string().regex(/^[a-f0-9]{64}$/).describe('Versão obtida na última consulta; conflito exige nova consulta e revisão.') };
const parents = { territoryId: id, blockId: id };
const houseFields = { number: z.string().trim().min(1).max(100), legend: z.string().max(1000).nullable().optional(), dontVisit: z.boolean().optional() };

export const agentTools = [
  { name: 'connection_context', description: 'Consultar a congregação conectada e as permissões concedidas antes de trabalhar no cadastro.', schema: z.object({}).strict() },
  { name: 'list_territory_types', description: 'Consultar os tipos de território disponíveis nesta congregação. Use um tipo existente ao cadastrar.', schema: z.object({}).strict() },
  { name: 'list_territories', description: 'Pesquisar territórios da congregação, inclusive vazios e sem rodada.', schema: z.object({ ...page, typeId: id.optional() }).strict() },
  { name: 'get_territory', description: 'Consultar um território e sua versão para edição.', schema: z.object({ id }).strict() },
  { name: 'create_territory', description: 'Cadastrar um território vazio em um tipo existente da congregação.', schema: z.object({ name, typeId: id, ...write }).strict() },
  { name: 'update_territory', description: 'Editar nome e tipo de um território. Mudança de tipo exige território sem casas e histórico.', schema: z.object({ id, name: name.optional(), typeId: id.optional(), ...edit }).strict().refine(p => p.name !== undefined || p.typeId !== undefined, 'Informe uma alteração') },
  { name: 'list_blocks', description: 'Pesquisar quadras aprovadas de um território, sem depender de rodada.', schema: z.object({ territoryId: id, ...page }).strict() },
  { name: 'get_block', description: 'Consultar uma quadra e sua versão no território.', schema: z.object({ territoryId: id, id }).strict() },
  { name: 'create_block', description: 'Cadastrar uma quadra vazia em um território; não substitui ruas existentes.', schema: z.object({ territoryId: id, name, ...write }).strict() },
  { name: 'update_block', description: 'Editar apenas o nome da quadra, preservando ruas, casas e histórico. Quadras compartilhadas exigem revisão no Admin.', schema: z.object({ territoryId: id, id, name, ...edit }).strict() },
  { name: 'list_streets', description: 'Pesquisar ruas vinculadas à quadra. O id retornado identifica o vínculo da rua, não o addressId.', schema: z.object({ ...parents, ...page }).strict() },
  { name: 'get_street', description: 'Consultar rua pelo id do vínculo, sua versão e endereço cadastral.', schema: z.object({ ...parents, id }).strict() },
  { name: 'create_street', description: 'Cadastrar uma rua na quadra, preservando as outras ruas e suas casas.', schema: z.object({ ...parents, name, zipCode: z.string().max(20).optional(), ...write }).strict() },
  { name: 'update_street', description: 'Editar nome/CEP de uma rua apenas nesta quadra. Preserva casas e marcações; não mescla nem exclui ruas.', schema: z.object({ ...parents, id, name: name.optional(), zipCode: z.string().max(20).nullable().optional(), ...edit }).strict().refine(p => p.name !== undefined || p.zipCode !== undefined, 'Informe uma alteração') },
  { name: 'list_houses', description: 'Pesquisar casas aprovadas da rua. streetId é o id do vínculo retornado em list_streets. Não retorna marcações nem telefones.', schema: z.object({ ...parents, streetId: id, ...page }).strict() },
  { name: 'get_house', description: 'Consultar uma casa e sua versão para edição; não retorna dados de contato ou marcações.', schema: z.object({ id }).strict() },
  { name: 'create_house', description: 'Cadastrar casa na rua/quadra informadas. Pode iniciar rodada do mesmo tipo quando não houver rodada aberta compatível; retorna rodadas afetadas.', schema: z.object({ ...parents, streetId: id, ...houseFields, ...write }).strict() },
  { name: 'update_house', description: 'Editar número, legenda ou não visitar de uma casa. Preserva pais e marcações; não movimenta nem exclui casas.', schema: z.object({ id, number: houseFields.number.optional(), legend: houseFields.legend, dontVisit: houseFields.dontVisit, ...edit }).strict().refine(p => p.number !== undefined || p.legend !== undefined || p.dontVisit !== undefined, 'Informe uma alteração') },
];
