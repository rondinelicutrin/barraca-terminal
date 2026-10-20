-- Permite lançar pagamentos que saem do saldo de uma maquininha de cartão (além das retiradas de dinheiro).
-- Todas as retiradas que já existem continuam como "dinheiro".
alter table retiradas
  add column if not exists origem text not null default 'dinheiro'
  check (origem in ('dinheiro', 'maq1', 'maq2'));
