import { useState } from "react";
import { useStore, getAllProducts, valorConsumoPonto, valoresConsumoPonto, ehSoConsumo, type Turno, type ShiftItem } from "@/lib/store";
import { BRL } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { BufferedNumberInput } from "@/components/ui/buffered-number-input";

// Consumo de cada pessoa do turno, editável pelo dono/administrador (Histórico → ✏️, turno aberto ou
// fechado): os funcionários esquecem de lançar. Cada mudança grava na hora nos dois lugares:
// - no ponto da pessoa na data do turno (é o que a folha desconta; sem ponto, cria um registro só de consumo);
// - na coluna Consumo do turno (estoque), para o resultado do fechamento continuar certo.
export function ConsumoTurnoEditor({ local, setLocal, isAtivo }: {
  local: Turno; setLocal: (t: Turno) => void; isAtivo: boolean;
}) {
  const { state, dispatch } = useStore();
  const products = getAllProducts(state);
  const [extras, setExtras] = useState<string[]>([]);
  const [novo, setNovo] = useState<Record<string, { pid: string; qtd: number }>>({});
  const nome = (u: string) => state.funcionarios.find((f) => f.username === u)?.nome ?? u;
  const pessoas = [...new Set([local.employee, ...(local.outrosFuncionarios ?? []), ...extras])];
  const disponiveis = state.funcionarios.filter((f) => !f.excluido && !pessoas.includes(f.username));
  const pontosDe = (u: string) => state.pontos.filter((p) => p.employeeUsername === u && p.date === local.date);
  const qtd = (u: string, pid: string) =>
    pontosDe(u).reduce((s, p) => s + (p.consumo.find((c) => c.productId === pid)?.qty ?? 0), 0);
  const itensDe = (u: string) => {
    const m: Record<string, number> = {};
    for (const p of pontosDe(u)) for (const c of p.consumo) m[c.productId] = (m[c.productId] ?? 0) + c.qty;
    return Object.entries(m).filter(([, q]) => q > 0).map(([productId, q]) => ({ productId, qty: q }));
  };

  // Ajusta a coluna Consumo do turno (estoque) pela diferença
  const ajustarTurno = (pid: string, delta: number) => {
    const soma = (it: ShiftItem | undefined): ShiftItem => {
      const base = it ?? { entrada: 0, chegada: 0, sobra: 0, consumo: 0, descarte: 0 };
      return { ...base, consumo: Math.max(0, (base.consumo || 0) + delta) };
    };
    setLocal({ ...local, items: { ...local.items, [pid]: soma(local.items[pid]) } });
    if (isAtivo && state.turnoAtivo) {
      dispatch({ type: "UPDATE_ITEM", productId: pid, patch: { consumo: soma(state.turnoAtivo.items[pid]).consumo } });
    } else {
      const t = state.historico.find((h) => h.id === local.id);
      if (t) dispatch({ type: "EDIT_HIST", id: t.id, turno: { ...t, items: { ...t.items, [pid]: soma(t.items[pid]) } } });
    }
  };

  const definir = (u: string, pid: string, novoTotal: number) => {
    const atual = qtd(u, pid);
    const delta = Math.round(novoTotal) - atual;
    if (delta === 0 || novoTotal < 0) return;
    const prod = products.find((p) => p.id === pid);
    if (delta > 0) {
      // Consumo maior do que o que saiu do estoque deixaria o "vendido" negativo
      const it = local.items[pid];
      if (local.closedAt && it) {
        const livre = it.entrada + (it.chegada ?? 0) - (it.sobra ?? 0) - (it.consumo || 0) - (it.descarte || 0) - (it.consumoEst || 0);
        if (delta > livre && !confirm(`${prod?.name ?? pid}: só ${Math.max(0, livre)} unidade(s) saíram do estoque sem consumo/descarte neste turno (entrada + chegada − sobra). Lançar ${delta} mesmo assim?`)) return;
      }
      const ps = pontosDe(u);
      const alvo = ps.find((p) => p.consumo.some((c) => c.productId === pid)) ?? ps.find((p) => !ehSoConsumo(p)) ?? ps[0];
      if (alvo) {
        const q = alvo.consumo.find((c) => c.productId === pid)?.qty ?? 0;
        dispatch({ type: "UPDATE_PONTO_CONSUMO", pontoId: alvo.id, productId: pid, qty: q + delta });
      } else {
        dispatch({ type: "ADD_PONTO", p: { id: crypto.randomUUID(), employeeUsername: u, date: local.date, entrada: "00:00", saida: "00:00",
          transporte: 0, refeicao: 0, colegas: [], consumo: [{ productId: pid, qty: delta }] } });
      }
    } else {
      let resto = -delta;
      for (const p of [...pontosDe(u)].reverse()) {
        const q = p.consumo.find((c) => c.productId === pid)?.qty ?? 0;
        if (!q || resto <= 0) continue;
        const tira = Math.min(q, resto);
        dispatch({ type: "UPDATE_PONTO_CONSUMO", pontoId: p.id, productId: pid, qty: q - tira });
        resto -= tira;
      }
    }
    ajustarTurno(pid, delta);
  };

  return (
    <div className="bg-card border border-border rounded-xl p-3 space-y-3">
      <div>
        <div className="text-sm font-semibold">🍽 Consumo dos funcionários do turno</div>
        <p className="text-[11px] text-muted-foreground">
          Altere a quantidade (0 tira o item) ou inclua o que foi esquecido. Grava na hora: entra na folha da pessoa e na coluna
          Consumo do turno (o esperado do fechamento é recalculado).
        </p>
      </div>
      {pessoas.map((u) => {
        const itens = itensDe(u);
        const valores = valoresConsumoPonto(state, u, itens);
        const n = novo[u] ?? { pid: "", qtd: 1 };
        return (
          <div key={u} className="bg-background border border-border/60 rounded-lg p-2 space-y-1.5">
            <div className="flex justify-between text-xs font-semibold">
              <span>{nome(u)}</span>
              <span className="mono">{BRL(valorConsumoPonto(state, u, itens))}</span>
            </div>
            {itens.length === 0 && <div className="text-[11px] text-muted-foreground">Nenhum consumo lançado.</div>}
            {itens.map((c) => (
              <div key={c.productId} className="flex items-center justify-between gap-2 text-xs">
                <span className="flex items-center gap-1.5">
                  <BufferedNumberInput value={c.qty} decimal={false} className="w-14 h-8 text-xs" aria-label={`Consumo de ${nome(u)}: ${products.find((p) => p.id === c.productId)?.name ?? c.productId}`}
                    onChange={() => {}}
                    onBlur={(q) => {
                      if (q === 0 && !confirm(`Tirar ${products.find((p) => p.id === c.productId)?.name} do consumo de ${nome(u)}?`)) return;
                      definir(u, c.productId, q);
                    }} />
                  × {products.find((p) => p.id === c.productId)?.name ?? c.productId}
                </span>
                <span className="mono">{BRL(valores[c.productId] ?? 0)}</span>
              </div>
            ))}
            <div className="flex items-center gap-1.5">
              <select value={n.pid} aria-label={`Produto para incluir no consumo de ${nome(u)}`}
                onChange={(e) => setNovo({ ...novo, [u]: { ...n, pid: e.target.value } })}
                className="flex-1 h-8 rounded-md bg-input border border-border px-2 text-xs">
                <option value="">+ incluir item…</option>
                {products.filter((p) => p.saleable).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <BufferedNumberInput value={n.qtd} decimal={false} className="w-12 h-8 text-xs" aria-label={`Quantidade a incluir para ${nome(u)}`}
                onChange={(q) => setNovo({ ...novo, [u]: { ...n, qtd: q } })} />
              <Button variant="secondary" className="h-8 px-2 text-xs" disabled={!n.pid || n.qtd <= 0}
                onClick={() => { definir(u, n.pid, qtd(u, n.pid) + n.qtd); setNovo({ ...novo, [u]: { pid: "", qtd: 1 } }); }}>
                Incluir
              </Button>
            </div>
          </div>
        );
      })}
      {disponiveis.length > 0 && (
        <select value="" aria-label="Incluir outra pessoa no consumo do turno" onChange={(e) => e.target.value && setExtras([...extras, e.target.value])}
          className="w-full h-9 rounded-md bg-input border border-border px-2 text-xs">
          <option value="">+ incluir outra pessoa…</option>
          {disponiveis.map((f) => <option key={f.username} value={f.username}>{f.nome}</option>)}
        </select>
      )}
    </div>
  );
}
