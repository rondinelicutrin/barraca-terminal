-- Versão 46: pagamentos extras e preço dos fornecedores (fardo de cana e gelo) na Folha semanal
-- (Equipe → 📋 Folha semanal). Rode uma vez no SQL Editor do Supabase. Nada do que já existe é alterado.
create table if not exists public.folha_semana_itens (
  id text primary key,
  semana_inicio date not null,                -- segunda-feira da semana
  tipo text not null check (tipo in ('extra', 'fornecedor')),
  descricao text,                             -- motivo do pagamento extra
  product_id text,                            -- produto do fornecedor (cc_fardo, ot_gelo)
  valor numeric not null default 0,           -- extra: valor; fornecedor: preço por unidade
  created_at timestamptz not null default now()
);

-- O app (chave pública) lê e grava, como nas outras tabelas da folha
alter table public.folha_semana_itens enable row level security;
drop policy if exists "app acessa itens da folha" on public.folha_semana_itens;
create policy "app acessa itens da folha" on public.folha_semana_itens
  for all to anon, authenticated using (true) with check (true);
grant select, insert, update, delete on public.folha_semana_itens to anon, authenticated;
