import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Shell, TopBar, BottomNav } from "@/components/Shell";
import { useStore, getAllProducts, descontoPercentual, limiteCategoriaFuncionario } from "@/lib/store";
import { BRL } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { BufferedNumberInput } from "@/components/ui/buffered-number-input";
import { gerarRelatorioPdf } from "@/lib/pdf";
import { baixarCsv } from "@/lib/csv";
import type { Category } from "@/lib/products";

export const Route = createFileRoute("/owner/descontos")({
  component: DescontosPage,
  head: () => ({ meta: [{ title: "Descontos por funcionário — Barraca Terminal" }, { name: "description", content: "Configurar o desconto de consumo de cada funcionário, produto a produto." }] }),
});

const CATS: { key: Category; label: string }[] = [
  { key: "pastel", label: "Pastel" },
  { key: "caldo", label: "Caldo" },
  { key: "bebida", label: "Bebidas" },
  { key: "outros", label: "Outros" },
];

function DescontosPage() {
  const { state, dispatch } = useStore();
  const nav = useNavigate();
  const products = getAllProducts(state).filter((p) => p.saleable);
  const [username, setUsername] = useState(state.funcionarios[0]?.username ?? "");
  const [cat, setCat] = useState<Category>("pastel");

  const f = state.funcionarios.find((x) => x.username === username);

  const setPct = (productId: string, pct: number) => {
    if (!username) return;
    dispatch({ type: "SET_DESCONTO_FUNCIONARIO", username, productId, patch: { percentual: pct } });
  };
  // O limite vale para a categoria inteira (todos os sabores somados). Ele é gravado igual em todos os
  // produtos da categoria, para nunca ficar um valor diferente em cada produto.
  const setLimiteCategoria = (categoria: Category, limite: number) => {
    if (!username) return;
    for (const p of products.filter((x) => x.category === categoria)) {
      dispatch({
        type: "SET_DESCONTO_FUNCIONARIO", username, productId: p.id,
        patch: { percentual: descontoPercentual(state, username, p), limite: limite > 0 ? limite : undefined },
      });
    }
  };
  const restaurar = (productId: string) => {
    if (!username) return;
    dispatch({ type: "REMOVE_DESCONTO_FUNCIONARIO", username, productId });
  };

  // Matriz completa (todos os funcionários x todos os produtos vendáveis) para o relatório
  const montarMatriz = () => {
    const linhas: { funcionario: string; produto: string; percentual: number; limite: string }[] = [];
    for (const func of state.funcionarios) {
      for (const p of products) {
        const pct = descontoPercentual(state, func.username, p);
        const lim = limiteCategoriaFuncionario(state, func.username, p.category);
        linhas.push({ funcionario: func.nome, produto: p.name, percentual: pct, limite: lim != null ? `${lim} (total da categoria)` : "sem limite" });
      }
    }
    return linhas;
  };

  const baixarPdf = () => {
    if (state.funcionarios.length === 0) { alert("Nenhum funcionário cadastrado."); return; }
    const linhas = montarMatriz();
    gerarRelatorioPdf({
      filename: "descontos-por-funcionario.pdf",
      title: "Desconto de consumo por funcionário",
      sections: state.funcionarios.map((func) => ({
        heading: func.nome,
        columns: ["Produto", "Desconto", "Limite"],
        rows: linhas.filter((l) => l.funcionario === func.nome).map((l) => [l.produto, `${l.percentual}%`, l.limite]),
      })),
    });
  };

  const baixarCsvArquivo = () => {
    if (state.funcionarios.length === 0) { alert("Nenhum funcionário cadastrado."); return; }
    const linhas = montarMatriz();
    baixarCsv(
      "descontos-por-funcionario.csv",
      ["Funcionário", "Produto", "Desconto (%)", "Limite (un)"],
      linhas.map((l) => [l.funcionario, l.produto, l.percentual, l.limite]),
    );
  };

  return (
    <Shell>
      <TopBar title="Descontos por funcionário" right={<button onClick={() => nav({ to: "/owner/funcionarios" })} className="text-xs text-muted-foreground">Voltar</button>} />

      <div className="p-3 space-y-3">
        <p className="text-[11px] text-muted-foreground">
          Configure, para cada funcionário, qual o desconto de cada produto no "🍽 Meu consumo" (Ponto) — por
          exemplo 20%, 30%, 50% ou 100% (grátis) — e, por categoria, um limite de unidades com desconto (campo no
          topo de cada aba). O limite vale para a categoria inteira, somando todos os sabores: ex. limite 2 em pastel =
          só os 2 primeiros pastéis do registro (de qualquer sabor) têm desconto; do 3º em diante paga 100%. Vale para
          Pastel, Caldo e Bebidas — e a água só é grátis dentro do limite. Sem configuração, vale o padrão do sistema (grátis para itens gratuitos, 50% para os demais).
        </p>

        <div>
          <label className="text-xs text-muted-foreground">Funcionário</label>
          <select
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="mt-1 w-full h-10 rounded-md bg-input border border-border px-3 text-sm"
          >
            {state.funcionarios.length === 0 && <option value="">Nenhum funcionário cadastrado</option>}
            {state.funcionarios.map((func) => (
              <option key={func.username} value={func.username}>{func.nome}</option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Button variant="secondary" onClick={baixarPdf}>📄 PDF (todos)</Button>
          <Button variant="secondary" onClick={baixarCsvArquivo}>📊 CSV (todos)</Button>
        </div>
      </div>

      {f && (
        <>
          <div className="px-3 flex gap-1 overflow-x-auto pb-2">
            {CATS.map((c) => (
              <button key={c.key} onClick={() => setCat(c.key)}
                className={`px-3 h-8 rounded-full text-xs whitespace-nowrap ${cat === c.key ? "bg-primary text-primary-foreground" : "bg-card border border-border text-muted-foreground"}`}>
                {c.label}
              </button>
            ))}
          </div>

          <div className="p-3 space-y-2">
            {(() => {
              const lc = limiteCategoriaFuncionario(state, username, cat);
              return (
                <div className={`rounded-lg border p-3 space-y-1.5 ${lc != null ? "border-warning/50 bg-warning/10" : "border-border bg-card"}`}>
                  <label className="text-xs font-medium">Limite de unidades com desconto — {CATS.find((c) => c.key === cat)?.label} (total, todos os sabores)</label>
                  <BufferedNumberInput value={lc ?? 0} decimal={false} className="w-full text-right" placeholder="sem limite"
                    onChange={(n) => setLimiteCategoria(cat, n)} />
                  <p className="text-[11px] text-muted-foreground">
                    {lc != null
                      ? `${f.nome} tem desconto só nas primeiras ${lc} un. desta categoria por registro (qualquer sabor). A partir da ${lc + 1}ª paga 100% — inclusive a água. Deixe 0 para não ter limite.`
                      : "Sem limite: todas as unidades têm o desconto configurado."}
                  </p>
                </div>
              );
            })()}
            {products.filter((p) => p.category === cat).map((p) => {
              const pct = descontoPercentual(state, username, p);
              const temOverride = !!state.descontosPorFuncionario[username]?.[p.id];
              return (
                <div key={p.id} className="bg-card border border-border rounded-lg p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="text-sm">{p.name} <span className="text-xs text-muted-foreground mono">({BRL(p.price)})</span></div>
                    {temOverride && (
                      <button onClick={() => restaurar(p.id)} className="text-[11px] text-muted-foreground hover:text-primary">Restaurar padrão</button>
                    )}
                  </div>
                  <div>
                    <label className="text-[10px] text-muted-foreground uppercase tracking-wide">Desconto (%)</label>
                    <BufferedNumberInput value={pct} decimal={false} className="mt-0.5 w-full text-right" placeholder="50"
                      onChange={(n) => setPct(p.id, Math.max(0, Math.min(100, n)))} />
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    Preço com desconto: <span className="mono">{pct >= 100 ? "Grátis" : BRL(p.price * (1 - pct / 100))}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      <BottomNav />
    </Shell>
  );
}
