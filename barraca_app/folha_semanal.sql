-- Versão 30: adicional e desconto de cada semana na folha (Equipe → Folha semanal).
-- Rode uma vez no SQL Editor do Supabase. Nada do que já existe é alterado.
create table if not exists public.folha_ajustes (
  employee_username text not null,
  semana_inicio date not null,          -- segunda-feira da semana
  adicional numeric not null default 0,
  desconto numeric not null default 0,
  observacao text,
  primary key (employee_username, semana_inicio)
);

-- O app (chave pública) pode ler e gravar os ajustes, como nas outras tabelas
alter table public.folha_ajustes enable row level security;
drop policy if exists "app acessa ajustes da folha" on public.folha_ajustes;
create policy "app acessa ajustes da folha" on public.folha_ajustes
  for all to anon, authenticated using (true) with check (true);
grant select, insert, update, delete on public.folha_ajustes to anon, authenticated;
