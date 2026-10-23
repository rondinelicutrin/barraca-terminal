-- Versão 29: inclusão de dinheiro no caixa (Pagamentos → Dinheiro). Rode uma vez no SQL Editor do Supabase.
-- Cada lançamento passa a dizer se foi retirada (tira do caixa) ou inclusão (coloca no caixa).
-- Tudo o que já existe continua como "retirada". Nada é apagado.
alter table retiradas
  add column if not exists tipo text not null default 'retirada'
  check (tipo in ('retirada', 'inclusao'));
