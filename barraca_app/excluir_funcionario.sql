-- Versão 34: excluir funcionário (Equipe → funcionário → Excluir).
-- O funcionário excluído some de todas as listas e não entra mais no app, mas o registro fica no banco
-- para o histórico (turnos, pontos, folha, consumo) continuar com o nome certo. Apagar de verdade não é
-- possível: o banco protege os registros ligados a ele (por isso a exclusão antiga não funcionava).
-- Rode uma vez no SQL Editor do Supabase. Nada do que já existe é alterado.
alter table public.funcionarios add column if not exists excluido boolean not null default false;

-- Depois do seguranca_login.sql o app só lê as colunas liberadas: libera também esta.
grant select (excluido) on public.funcionarios to anon, authenticated;
