-- Preço, estoque e produtos removidos passam a ser guardados no banco (antes ficavam só no navegador
-- de cada aparelho). Rode uma vez no SQL Editor do Supabase. Nada do que já existe é apagado.
alter table produtos
  add column if not exists ativo boolean not null default true,
  add column if not exists estoque_qtd numeric,
  add column if not exists estoque_minimo numeric;
