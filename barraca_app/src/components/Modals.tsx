import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useStore, getAllProducts, descontoPercentual, valorConsumoPonto, limiteCategoriaFuncionario, type ShiftItem } from "@/lib/store";
import { BRL, parseInt2, parseBR } from "@/lib/format";

// Limite máximo para um produto: entrada + chegada - descarte - consumoEst
function limiteDisponivel(it: ShiftItem | undefined, tipo: "consumo" | "descarte"): number {
  if (!it) return 999;
  const base = (it.entrada || 0) + (it.chegada || 0);
  if (tipo === "consumo") {
    // Consumo do funcionário: disponível menos descarte, consumo barraca e o consumo já registrado no turno
    return Math.max(0, base - (it.descarte || 0) - (it.consumoEst || 0) - (it.consumo || 0));
  }
  // Descarte: desconta do disponível menos consumo do funcionário e consumo barraca
  return Math.max(0, base - (it.consumo || 0) - (it.consumoEst || 0));
}

// Lançamento de consumo de UMA pessoa. Abre sempre vazio (antes trazia o que foi lançado para a pessoa
// anterior, e quem não apagava acabava lançando o consumo de um no nome de outro). O que for salvo é
// SOMADO ao que já foi lançado para essa pessoa (aparece na lista abaixo do botão dela).
export function ConsumoModal({
  open, onOpenChange, items, hasActiveTurno = true, username, nomePessoa, reservado, onSave,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  items?: Record<string, ShiftItem>;
  hasActiveTurno?: boolean; // false = não há turno aberto agora; bloqueia todo o consumo
  username?: string; // quando definido, usa o desconto configurado para esse funcionário/produto
  nomePessoa?: string; // aparece no título: deixa claro para quem está sendo lançado
  reservado?: Record<string, number>; // já lançado (ainda não registrado) para todas as pessoas: conta no limite
  onSave: (v: Record<string, number>) => void;
}) {
  const { state } = useStore();
  const products = getAllProducts(state).filter((p) => p.saleable);
  const [local, setLocal] = useState<Record<string, number>>({});
  useEffect(() => {
    if (open) setLocal({});
  }, [open]);

  const total = username
    ? valorConsumoPonto(state, username, products.map((p) => ({ productId: p.id, qty: local[p.id] || 0 })))
    : products.reduce((s, p) => {
        const q = local[p.id] || 0;
        return p.freeForEmployee || q <= 0 ? s : s + q * (p.price / 2);
      }, 0);

  // Com turno aberto, vale o estoque do próprio turno (entrada + chegada − descarte − consumo barraca).
  // Antes também exigia a "quantidade em estoque" salva, que fica vazia/zerada no 1º turno, em produto
  // novo ou quando a sobra anterior foi 0 — e bloqueava o consumo mesmo com mercadoria que acabou de chegar.
  const semEstoque = (pid: string, limite: number) => {
    if (!hasActiveTurno) return true;
    if (items) return limite <= 0;
    return (state.estoqueQtd[pid] ?? 0) <= 0;
  };

  const handleChange = (pid: string, rawVal: string) => {
    const val = parseInt2(rawVal);
    const limite = items ? Math.max(0, limiteDisponivel(items[pid], "consumo") - (reservado?.[pid] ?? 0)) : 999;
    if (semEstoque(pid, limite) && val > 0) {
      alert("Sem estoque disponível para este produto.");
      return;
    }
    if (val > limite) {
      alert(`Consumo do funcionário não pode exceder o estoque disponível (${limite}).`);
      return;
    }
    setLocal({ ...local, [pid]: val });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[480px] max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>🍽 Consumo de {nomePessoa ?? "funcionário"}</DialogTitle></DialogHeader>
        <p className="text-xs text-muted-foreground">
          {username ? "Desconto configurado por produto para este funcionário · Água é grátis" : "Desconto = 50% do preço · Água é grátis"}
        </p>
        {!hasActiveTurno && (
          <p className="text-[11px] text-warning">Nenhum turno aberto — abra um turno para liberar o consumo.</p>
        )}
        <div className="space-y-1.5 mt-2">
          {products.map((p) => {
            const limite = items ? Math.max(0, limiteDisponivel(items[p.id], "consumo") - (reservado?.[p.id] ?? 0)) : 999;
            const indisponivel = semEstoque(p.id, limite);
            const pct = username ? descontoPercentual(state, username, p) : 50;
            const limiteDesc = username ? limiteCategoriaFuncionario(state, username, p.category) : undefined;
            const precoComDesc = p.price * (1 - pct / 100);
            return (
              <div key={p.id} className={`flex items-center gap-2 py-1 border-b border-border/50 ${indisponivel ? "opacity-50" : ""}`}>
                <div className="flex-1 min-w-0">
                  <div className="text-sm truncate">{p.name}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {indisponivel ? (
                      <span className="text-destructive">Sem estoque</span>
                    ) : (
                      <>
                        {p.freeForEmployee ? "Grátis" : pct >= 100 ? "Grátis" : `${BRL(p.price)} → ${BRL(precoComDesc)}`}
                        {items && <span className="ml-1 text-text3"> (max: {limite})</span>}
                        {limiteDesc != null && <span className="ml-1 text-warning"> (desc. até {limiteDesc}un no total de {p.category === "pastel" ? "pastéis" : p.category === "caldo" ? "caldos" : p.category === "bebida" ? "bebidas" : "outros"})</span>}
                      </>
                    )}
                  </div>
                </div>
                <input
                  type="text" inputMode="numeric" disabled={indisponivel}
                  className="mono w-16 h-9 rounded-md bg-input px-2 text-center text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                  value={local[p.id] || ""}
                  onChange={(e) => handleChange(p.id, e.target.value)}
                />
              </div>
            );
          })}
        </div>
        <DialogFooter className="flex-row justify-between items-center mt-2">
          <div className="mono text-sm">Total desconto: <span className="text-primary font-semibold">{BRL(total)}</span></div>
          <Button onClick={() => { onSave(Object.fromEntries(Object.entries(local).filter(([, q]) => q > 0))); onOpenChange(false); }}>
            Adicionar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Soma dois lançamentos de consumo (produto -> quantidade)
export function somarConsumo(a: Record<string, number>, b: Record<string, number>): Record<string, number> {
  const out = { ...a };
  for (const [pid, q] of Object.entries(b)) if (q > 0) out[pid] = (out[pid] ?? 0) + q;
  return out;
}

export function DescarteModal({
  open, onOpenChange, values, items, onSave,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  values: Record<string, number>;
  items?: Record<string, ShiftItem>;
  onSave: (v: Record<string, number>) => void;
}) {
  const { state } = useStore();
  const products = getAllProducts(state);
  const [local, setLocal] = useState<Record<string, number>>(values);
  const totalItems = Object.values(local).reduce((s, n) => s + (n || 0), 0);

  const handleChange = (pid: string, rawVal: string, decimal?: boolean) => {
    const val = decimal ? parseBR(rawVal) : parseInt2(rawVal);
    if (items) {
      const it = items[pid];
      const limite = limiteDisponivel(it, "descarte");
      const nome = products.find((p) => p.id === pid)?.name ?? "o produto";
      if (val > limite) {
        alert(limite === 0 && it && !it.entrada && it.chegada == null
          ? `Sem estoque de ${nome} no turno. Preencha primeiro a Entrada/Chegada de ${nome} no menu Turno.`
          : `Descarte não pode exceder o estoque disponível (${limite}).`);
        return;
      }
      // Com a sobra já lançada, o descarte a mais deixaria o "vendido" negativo
      if (it?.sobra != null && val > limite - it.sobra) {
        alert(`Descarte de ${nome} maior que o disponível: a sobra lançada é ${it.sobra}. Corrija a sobra no menu Turno antes.`);
        return;
      }
    }
    setLocal({ ...local, [pid]: val });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[480px] max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>🗑 Descarte</DialogTitle></DialogHeader>
        <p className="text-xs text-muted-foreground">Sai do estoque mas não afeta o caixa esperado</p>
        <div className="space-y-1.5 mt-2">
          {products.map((p) => {
            const limite = items ? limiteDisponivel(items[p.id], "descarte") : 999;
            return (
              <div key={p.id} className="flex items-center gap-2 py-1 border-b border-border/50">
                <div className="flex-1 text-sm truncate">
                  {p.name}
                  {items && <span className="text-[11px] text-muted-foreground ml-1">(max: {limite})</span>}
                </div>
                <input
                  type="text" inputMode={p.decimal ? "decimal" : "numeric"}
                  className="mono w-16 h-9 rounded-md bg-input px-2 text-center text-sm"
                  value={local[p.id] || ""}
                  onChange={(e) => handleChange(p.id, e.target.value, p.decimal)}
                />
              </div>
            );
          })}
        </div>
        <DialogFooter className="flex-row justify-between items-center mt-2">
          <div className="mono text-sm">Itens: <span className="text-destructive font-semibold">{totalItems}</span></div>
          <Button onClick={() => { onSave(local); onOpenChange(false); }}>Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function collectConsumo(items: Record<string, ShiftItem>): Record<string, number> {
  const r: Record<string, number> = {};
  for (const [k, v] of Object.entries(items)) r[k] = v.consumo || 0;
  return r;
}
export function collectDescarte(items: Record<string, ShiftItem>): Record<string, number> {
  const r: Record<string, number> = {};
  for (const [k, v] of Object.entries(items)) r[k] = v.descarte || 0;
  return r;
}
