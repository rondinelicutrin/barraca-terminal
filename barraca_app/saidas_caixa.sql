-- Versão 57: saídas de dinheiro do caixa (ex.: limpeza da praça) lançadas no turno.
-- Rode uma vez no SQL Editor do Supabase. Nada do que já existe é alterado.

-- Lista de despesas que podem ser pagas com o dinheiro do caixa (nome e valor), criada pelo dono/administrador
create table if not exists public.despesas_caixa (
  id text primary key,
  nome text not null,
  valor numeric not null default 0,
  ordem integer not null default 0,
  created_at timestamptz not null default now()
);

-- Cada saída lançada num turno (nome e valor copiados da lista na hora do lançamento)
create table if not exists public.turno_saidas (
  id text primary key,
  turno_id text not null,
  despesa_id text,
  nome text not null,
  valor numeric not null default 0,
  lancado_por text,
  created_at timestamptz not null default now()
);
create index if not exists turno_saidas_turno_id_idx on public.turno_saidas (turno_id);

-- O app (chave pública) lê e grava, como nas outras tabelas
alter table public.despesas_caixa enable row level security;
drop policy if exists "app acessa despesas do caixa" on public.despesas_caixa;
create policy "app acessa despesas do caixa" on public.despesas_caixa
  for all to anon, authenticated using (true) with check (true);
grant select, insert, update, delete on public.despesas_caixa to anon, authenticated;

alter table public.turno_saidas enable row level security;
drop policy if exists "app acessa saidas do turno" on public.turno_saidas;
create policy "app acessa saidas do turno" on public.turno_saidas
  for all to anon, authenticated using (true) with check (true);
grant select, insert, update, delete on public.turno_saidas to anon, authenticated;
