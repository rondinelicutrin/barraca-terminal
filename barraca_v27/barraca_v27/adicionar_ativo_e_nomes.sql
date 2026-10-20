-- 1) Ativar / desativar funcionários (Equipe). Todo mundo que já existe continua ativo.
alter table funcionarios
  add column if not exists ativo boolean not null default true;

-- 2) Nome das maquininhas (ex.: nome do banco) — editável em Pagamentos.
alter table config_geral
  add column if not exists nome_maq1 text,
  add column if not exists nome_maq2 text;
