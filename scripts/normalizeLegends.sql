-- Script para normalizar legendas da tabela house
-- Legendas suportadas: Comércio, Residência, Terreno, Fundos, Testemunha de Jeová, Igreja, Escola, Hospital, Apartamento

BEGIN;

-- Normalizar variações de "Comércio"
UPDATE house SET legend = 'Comércio' WHERE legend = 'Comércio ';
UPDATE house SET legend = 'Comércio' WHERE legend = 'comércio';
UPDATE house SET legend = 'Comércio' WHERE legend = 'Comércio/Residência';
UPDATE house SET legend = 'Comércio' WHERE legend = 'Bar';
UPDATE house SET legend = 'Comércio' WHERE legend = 'Restaurante';
UPDATE house SET legend = 'Comércio' WHERE legend = 'Oficina';
UPDATE house SET legend = 'Comércio' WHERE legend = 'Despachante';
UPDATE house SET legend = 'Comércio' WHERE legend = 'Empresa';
UPDATE house SET legend = 'Comércio' WHERE legend = 'Bazar Beneficiente';
UPDATE house SET legend = 'Comércio' WHERE legend = 'Galpão';
UPDATE house SET legend = 'Comércio' WHERE legend = 'Indústria';
UPDATE house SET legend = 'Comércio' WHERE legend = 'ferro velho';
UPDATE house SET legend = 'Comércio' WHERE legend = 'Posto de Saúde';
UPDATE house SET legend = 'Comércio' WHERE legend = 'Salão de Festas';

-- Normalizar variações de "Residência"
UPDATE house SET legend = 'Residência' WHERE legend = 'Residencia';
UPDATE house SET legend = 'Residência' WHERE legend = 'Residencial';
UPDATE house SET legend = 'Residência' WHERE legend IS NULL;

-- Normalizar variações de "Apartamento" (prédios, condomínios, interfones)
UPDATE house SET legend = 'Apartamento' WHERE legend = 'Apartamentos';
UPDATE house SET legend = 'Apartamento' WHERE legend = 'Prédio';
UPDATE house SET legend = 'Apartamento' WHERE legend = 'Predio';
UPDATE house SET legend = 'Apartamento' WHERE legend = 'Predio ';
UPDATE house SET legend = 'Apartamento' WHERE legend = 'Prédio ';
UPDATE house SET legend = 'Apartamento' WHERE legend = 'Condomínio';
UPDATE house SET legend = 'Apartamento' WHERE legend = 'Condomínio ';
UPDATE house SET legend = 'Apartamento' WHERE legend = 'Condominio CDHU';
UPDATE house SET legend = 'Apartamento' WHERE legend = 'Cond. Dolce Vita';
UPDATE house SET legend = 'Apartamento' WHERE legend = 'Vila';
UPDATE house SET legend = 'Apartamento' WHERE legend = 'Interfone Codificado';

-- Normalizar variações de "Fundos"
UPDATE house SET legend = 'Fundos' WHERE legend = 'Fundo';

-- Normalizar variações de "Testemunha de Jeová"
UPDATE house SET legend = 'Testemunha de Jeová' WHERE legend = 'Testemunhas de Jeová';

-- Normalizar variações de "Igreja"
UPDATE house SET legend = 'Igreja' WHERE legend = 'Templo';

-- Normalizar variações de "Escola"
UPDATE house SET legend = 'Escola' WHERE legend = 'Escola CEI 25';
UPDATE house SET legend = 'Escola' WHERE legend = 'Faculdade';

-- Normalizar variações de "Hospital"
UPDATE house SET legend = 'Hospital' WHERE legend = 'Asilo';
UPDATE house SET legend = 'Hospital' WHERE legend = 'Lar de Idosos Amor de Vó';

-- Normalizar variações de "Terreno"
UPDATE house SET legend = 'Terreno' WHERE legend = 'Terreno vazio';
UPDATE house SET legend = 'Terreno' WHERE legend = 'Construção';
UPDATE house SET legend = 'Terreno' WHERE legend = 'Obra';

-- Limpar legendas inválidas/especiais
UPDATE house SET legend = 'Residência' WHERE legend = '~~';
UPDATE house SET legend = 'Residência' WHERE legend = 'Sem casas';
UPDATE house SET legend = 'Residência' WHERE legend = 'Deletar';

-- Legenda que pode precisar de revisão manual:
-- 'Não Bater' (50 registros) - manter ou NULL?
-- UPDATE house SET legend = NULL WHERE legend = 'Não Bater';

COMMIT;

-- Verificar resultado após execução:
-- SELECT legend, COUNT(1) FROM house GROUP BY legend ORDER BY legend;
-- npx prisma db execute --file scripts/normalizeLegends.sql --schema prisma/schema.prisma