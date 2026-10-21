-- Segurança do login (versão 28). Rode UMA vez no SQL Editor do Supabase.
--
-- ANTES DE RODAR: troque a senha do dono na linha marcada abaixo (senha_mestre_nova).
-- A senha antiga ("barracaterminal") estava escrita no código, que é público no GitHub — deixa de valer.
--
-- O que muda:
--   1) As senhas dos funcionários passam a ser guardadas criptografadas (bcrypt). As que já existem são
--      convertidas agora; as novas são convertidas automaticamente ao cadastrar.
--   2) O app não consegue mais ler a coluna de senha: o login é conferido aqui no banco
--      (função verificar_login), que só responde "certo" ou "errado".
--   3) A senha do dono fica guardada aqui no banco (tabela app_segredos), não mais no código.
-- Nada é apagado. Os funcionários continuam entrando com as mesmas senhas de hoje.

begin; -- tudo ou nada: se der qualquer erro, nada é alterado

-- Confere a nova senha do dono antes de qualquer mudança
do $$
declare
  senha_mestre_nova text := 'TROQUE_AQUI';  -- <<<<< COLOQUE AQUI A NOVA SENHA DO DONO
begin
  if senha_mestre_nova = 'TROQUE_AQUI' or length(senha_mestre_nova) < 6 then
    raise exception 'Troque a senha do dono (senha_mestre_nova) antes de rodar. Use pelo menos 6 caracteres.';
  end if;
  perform set_config('barraca.senha_mestre', senha_mestre_nova, true); -- vale só até o fim desta execução
end
$$;

create extension if not exists pgcrypto with schema extensions;

-- Coluna "ativo" (se o adicionar_ativo_e_nomes.sql ainda não foi rodado)
alter table public.funcionarios add column if not exists ativo boolean not null default true;

-- 1) Senhas criptografadas
create or replace function public.funcionarios_hash_senha() returns trigger
language plpgsql
set search_path = public, extensions
as $$
begin
  if new.password is not null and new.password !~ '^\$2[abxy]\$' then
    new.password := extensions.crypt(new.password, extensions.gen_salt('bf'));
  end if;
  return new;
end
$$;

drop trigger if exists trg_funcionarios_hash_senha on public.funcionarios;
create trigger trg_funcionarios_hash_senha
  before insert or update of password on public.funcionarios
  for each row execute function public.funcionarios_hash_senha();

-- Converte as senhas que já existem (o gatilho acima faz a criptografia)
update public.funcionarios set password = password where password !~ '^\$2[abxy]\$';

-- 2) Senha do dono, guardada fora do alcance do app
create table if not exists public.app_segredos (
  id boolean primary key default true check (id),
  senha_mestre text not null
);
alter table public.app_segredos enable row level security; -- sem políticas: o app não lê nem altera
revoke all on public.app_segredos from anon, authenticated;

insert into public.app_segredos (id, senha_mestre)
values (true, extensions.crypt(current_setting('barraca.senha_mestre'), extensions.gen_salt('bf')))
on conflict (id) do update set senha_mestre = excluded.senha_mestre;

-- 3) Login conferido no banco. Devolve os dados da pessoa (sem a senha) ou nulo se usuário/senha errados.
create or replace function public.verificar_login(p_usuario text, p_senha text) returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  usuario text := lower(trim(coalesce(p_usuario, '')));
  hash text;
  f jsonb;
begin
  if usuario = 'dono' then
    select senha_mestre into hash from public.app_segredos where id;
    if hash is not null and hash = extensions.crypt(coalesce(p_senha, ''), hash) then
      return json_build_object('role', 'owner', 'username', 'dono', 'nome', 'Dono', 'ativo', true);
    end if;
    return null;
  end if;

  select to_jsonb(x) into f from public.funcionarios x where lower(trim(x.username)) = usuario limit 1;
  if f is null or (f->>'password') is null
     or (f->>'password') <> extensions.crypt(coalesce(p_senha, ''), f->>'password') then
    return null;
  end if;
  return json_build_object(
    'role', case when f->>'role' = 'owner' then 'owner' else 'employee' end,
    'username', f->>'username',
    'nome', f->>'nome',
    'ativo', coalesce((f->>'ativo')::boolean, true)
  );
end
$$;

revoke all on function public.verificar_login(text, text) from public;
grant execute on function public.verificar_login(text, text) to anon, authenticated;

-- 4) O app continua lendo todas as colunas de funcionarios, menos a senha
revoke select on public.funcionarios from anon, authenticated;
do $$
declare
  colunas text;
begin
  select string_agg(quote_ident(column_name), ', ') into colunas
  from information_schema.columns
  where table_schema = 'public' and table_name = 'funcionarios' and column_name <> 'password';
  execute format('grant select (%s) on public.funcionarios to anon, authenticated', colunas);
end
$$;

commit;
