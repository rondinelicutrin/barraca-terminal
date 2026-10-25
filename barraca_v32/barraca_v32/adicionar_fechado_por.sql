-- Versão 33: guarda quem FECHOU o turno (pode ser diferente de quem abriu), para o relatório do fechamento.
-- Rode uma vez no SQL Editor do Supabase. Nada do que já existe é alterado.
alter table public.turnos add column if not exists fechado_por text;
