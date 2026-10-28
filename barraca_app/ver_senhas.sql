-- Versão 37: o dono e os administradores podem VER a senha dos funcionários (Equipe → 👁 Ver senhas).
-- Rode UMA vez no SQL Editor do Supabase, depois do seguranca_login.sql.
--
-- Como funciona:
--   - O login continua conferindo a senha criptografada de forma irreversível (bcrypt), como hoje.
--   - Além disso, cada senha nova (cadastro ou troca) ganha uma cópia cifrada com uma chave que fica só
--     aqui no banco (tabela app_segredos, que o app não consegue ler).
--   - A cópia só é aberta pela função ver_senhas, que confere se quem pede é o dono ou um administrador
--     (com a senha dele). O app não consegue ler a coluna da cópia diretamente.
--   - As senhas cadastradas ANTES deste SQL não podem ser recuperadas (só existe o bcrypt delas): elas
--     aparecem depois que forem trocadas uma vez (Equipe → funcionário → Trocar senha).
-- Nada é apagado e ninguém precisa trocar de senha para continuar entrando.

begin; -- tudo ou nada

do $$
begin
  if to_regclass('public.app_segredos') is null then
    raise exception 'Rode primeiro o seguranca_login.sql (a tabela app_segredos não existe).';
  end if;
end
$$;

create extension if not exists pgcrypto with schema extensions;

-- Chave das cópias cifradas (gerada aqui, nunca sai do banco)
alter table public.app_segredos add column if not exists chave_senhas text;
update public.app_segredos set chave_senhas = encode(extensions.gen_random_bytes(32), 'hex') where chave_senhas is null;

-- Cópia cifrada da senha. O app não pode ler esta coluna.
alter table public.funcionarios add column if not exists senha_cifrada bytea;
revoke select (senha_cifrada) on public.funcionarios from anon, authenticated;

-- Ao cadastrar ou trocar a senha: guarda a cópia cifrada e depois criptografa a senha do login (bcrypt).
-- security definer: precisa ler a chave em app_segredos, que o app não lê.
create or replace function public.funcionarios_hash_senha() returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  chave text;
begin
  if new.password is not null and new.password !~ '^\$2[abxy]\$' then
    select chave_senhas into chave from public.app_segredos where id;
    if chave is not null then
      new.senha_cifrada := extensions.pgp_sym_encrypt(new.password, chave);
    end if;
    new.password := extensions.crypt(new.password, extensions.gen_salt('bf'));
  end if;
  return new;
end
$$;

-- Lista as senhas, só para o dono ou um administrador ativo (confere usuário e senha de quem pede).
-- senha = null: cadastrada antes deste SQL (troque a senha para ela aparecer).
create or replace function public.ver_senhas(p_usuario text, p_senha text) returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  quem json := public.verificar_login(p_usuario, p_senha);
  chave text;
begin
  if quem is null or quem->>'role' <> 'owner' or coalesce((quem->>'ativo')::boolean, true) = false then
    raise exception 'Somente o dono ou um administrador pode ver as senhas.' using errcode = '42501';
  end if;
  select chave_senhas into chave from public.app_segredos where id;
  return coalesce((
    select json_agg(json_build_object(
      'username', f.username,
      'senha', case when f.senha_cifrada is null then null else extensions.pgp_sym_decrypt(f.senha_cifrada, chave) end
    ) order by f.nome)
    from public.funcionarios f
    where coalesce((to_jsonb(f)->>'excluido')::boolean, false) = false
  ), '[]'::json);
end
$$;

revoke all on function public.ver_senhas(text, text) from public;
grant execute on function public.ver_senhas(text, text) to anon, authenticated;

commit;
