import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Shell, TopBar, BottomNav } from "@/components/Shell";
import { useStore, getAllProducts, valoresConsumoPonto, type Ponto } from "@/lib/store";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { BRL, formatDateBR, todayISO } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BufferedNumberInput } from "@/components/ui/buffered-number-input";
import { DatePickerBR } from "@/components/ui/date-picker-br";
import { gerarRelatorioPdf } from "@/lib/pdf";
import { baixarCsv } from "@/lib/csv";
import { Trash2 } from "lucide-react";
import type { Category, Product } from "@/lib/products";
import { useFiltro } from "@/lib/filtros";

type ProdutosTab = Category | "consumo";

const CATS: { key: ProdutosTab; label: string }[] = [
  { key: "pastel", label: "Pastel" },
  { key: "caldo", label: "Caldo" },
  { key: "bebida", label: "Bebidas" },
  { key: "outros", label: "Outros" },
  { key: "consumo", label: "Consumo func." },
];

export const Route = createFileRoute("/owner/produtos")({
  component: Produtos,
  validateSearch: (search: Record<string, unknown>): { tab?: ProdutosTab } => ({
    tab: (["pastel", "caldo", "bebida", "outros", "consumo"] as const).includes(search.tab as ProdutosTab)
      ? (search.tab as ProdutosTab)
      : undefined,
  }),
  head: () => ({ meta: [{ title: "Produtos — Barraca Terminal" }, { name: "description", content: "Editar preços, catálogo e consumo dos funcionários." }] }),
});

function Produtos() {
  const { state, dispatch } = useStore();
  const { tab: tabFromUrl } = Route.useSearch();
  const products = getAllProducts(state);
  const [tabSalva, setTabSalva] = useFiltro<ProdutosTab>("produtos.tab", "pastel");
  const [tab, setTabLocal] = useState<ProdutosTab>(tabFromUrl ?? tabSalva);
  const setTab = (t: ProdutosTab) => { setTabLocal(t); setTabSalva(t); };
  const [nome, setNome] = useState("");
  const [preco, setPreco] = useState(0);
  const [saleable, setSaleable] = useState(true);

  const addProduct = () => {
    if (tab === "consumo") return;
    if (!nome) return alert("Digite o nome do produto.");
    const b: Product = {
      id: `${tab}_x_${Date.now()}`,
      name: nome,
      price: saleable ? preco : 0,
      category: tab,
      saleable,
    };
    dispatch({ type: "ADD_PRODUCT", b });
    setNome(""); setPreco(0); setSaleable(true);
  };

  return (
    <Shell>
      <TopBar title="Produtos" right={<Link to="/owner/descontos" className="text-xs text-primary">🏷️ Descontos</Link>} />
      <div className="px-3 pt-3 flex gap-1 overflow-x-auto pb-2">
        {CATS.map((c) => (
          <button key={c.key} onClick={() => setTab(c.key)}
            className={`px-3 h-8 rounded-full text-xs whitespace-nowrap ${tab === c.key ? "bg-primary text-primary-foreground" : "bg-card border border-border text-muted-foreground"}`}>{c.label}</button>
        ))}
      </div>

      {tab === "consumo" ? (
        <ConsumoFuncionarios products={products} />
      ) : (
        <div className="p-3 space-y-2">
          <p className="text-[11px] text-muted-foreground -mt-1 mb-1">
            Defina a quantidade em estoque e o nível de "Alerta em" — quando a quantidade cair até esse valor, o item aparece com aviso de estoque baixo para o funcionário na tela de Turno.
          </p>
          {products.filter((p) => p.category === tab).map((p) => {
            const qtd = state.estoqueQtd[p.id] ?? 0;
            const minimo = state.estoqueMinimo[p.id] ?? 0;
            const baixo = minimo > 0 && qtd <= minimo;
            return (
              <div key={p.id} className="bg-card border border-border rounded-lg p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex-1">
                    <div className="text-sm flex items-center gap-1.5">
                      {p.name}
                      {baixo && <span className="text-warning text-xs">⚠ estoque baixo</span>}
                    </div>
                    <div className="text-[11px] text-muted-foreground">{p.saleable ? "à venda" : "apenas estoque"}{p.freeForEmployee ? " · grátis func." : ""}</div>
                  </div>
                  {p.id.includes("_x_") && (
                    <button onClick={() => dispatch({ type: "REMOVE_PRODUCT", productId: p.id })} className="text-muted-foreground hover:text-destructive">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="text-[10px] text-muted-foreground uppercase tracking-wide">Preço (R$)</label>
                    {p.saleable ? (
                      <BufferedNumberInput
                        value={p.price}
                        placeholder="0,00"
                        className="mt-0.5 w-full text-right"
                        onChange={(n) => dispatch({ type: "SET_PRICE", productId: p.id, price: n })}
                      />
                    ) : (
                      <div className="mt-0.5 h-9 flex items-center justify-end text-xs text-muted-foreground">—</div>
                    )}
                  </div>
                  <div>
                    <label className="text-[10px] text-muted-foreground uppercase tracking-wide">Quantidade</label>
                    <BufferedNumberInput
                      value={qtd}
                      placeholder="0"
                      className="mt-0.5 w-full text-right"
                      onChange={(n) => dispatch({ type: "SET_ESTOQUE_QTD", productId: p.id, qtd: n })}
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-muted-foreground uppercase tracking-wide">Alerta em</label>
                    <BufferedNumberInput
                      value={minimo}
                      placeholder="0"
                      className="mt-0.5 w-full text-right"
                      onChange={(n) => dispatch({ type: "SET_ESTOQUE_MINIMO", productId: p.id, minimo: n })}
                    />
                  </div>
                </div>
              </div>
            );
          })}

          <div className="bg-card border border-border rounded-xl p-3 space-y-2 mt-3">
            <h3 className="text-sm font-semibold">Adicionar {CATS.find((c) => c.key === tab)?.label.toLowerCase()}</h3>
            <Input placeholder="Nome do produto" value={nome} onChange={(e) => setNome(e.target.value)} />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={saleable} onChange={(e) => setSaleable(e.target.checked)} className="accent-primary" />
              À venda (desmarque para itens só de estoque, ex: ingrediente/insumo)
            </label>
            {saleable && (
              <div>
                <label className="text-xs text-muted-foreground">Preço (R$)</label>
                <BufferedNumberInput value={preco} placeholder="0,00" className="mt-1 w-full h-10"
                  onChange={setPreco} />
              </div>
            )}
            <Button onClick={addProduct} className="w-full">Adicionar</Button>
          </div>
        </div>
      )}
      <BottomNav />
    </Shell>
  );
}

// Lista os registros de consumo (Ponto) de todos os funcionários num período, com campo editável
// de quantidade por item — para o dono poder corrigir um consumo lançado errado — e exportação
// em PDF ou CSV para análise/impressão.
function ConsumoFuncionarios({ products }: { products: ReturnType<typeof getAllProducts> }) {
  const { state, dispatch } = useStore();
  const [from, setFrom] = useFiltro("consumo.from", () => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 10);
  });
  const [to, setTo] = useFiltro("consumo.to", todayISO());
  const [funcSelecionado, setFuncSelecionado] = useFiltro("consumo.func", ""); // "" = todos os funcionários
  const [transferindo, setTransferindo] = useState<{ ponto: Ponto; productId: string } | null>(null);

  const nomeFunc = (username: string) => state.funcionarios.find((f) => f.username === username)?.nome ?? username;
  const nomeItem = (productId: string) => products.find((p) => p.id === productId)?.name ?? productId;
  const valorItem = (pt: Ponto, productId: string) =>
    valoresConsumoPonto(state, pt.employeeUsername, pt.consumo)[productId] ?? 0;

  const registros = useMemo(() => state.pontos
    .filter((p) => p.consumo.length > 0 && p.date >= from && p.date <= to)
    .filter((p) => !funcSelecionado || p.employeeUsername === funcSelecionado)
    .sort((a, b) => b.date.localeCompare(a.date)), [state.pontos, from, to, funcSelecionado]);

  const totalGeral = useMemo(() => registros.reduce(
    (s, p) => s + p.consumo.reduce((s2, c) => s2 + valorItem(p, c.productId), 0), 0,
  ), [registros, products]);

  const sufixoArquivo = funcSelecionado ? `-${nomeFunc(funcSelecionado).toLowerCase().replace(/\s+/g, "-")}` : "";

  const baixarPdf = () => {
    if (registros.length === 0) { alert("Nenhum consumo no período selecionado."); return; }
    gerarRelatorioPdf({
      filename: `consumo-funcionarios-${from}-a-${to}${sufixoArquivo}.pdf`,
      title: "Consumo dos funcionários",
      subtitle: `${formatDateBR(from)} a ${formatDateBR(to)}${funcSelecionado ? ` · ${nomeFunc(funcSelecionado)}` : ""}`,
      sections: registros.map((p) => ({
        heading: `${nomeFunc(p.employeeUsername)} · ${formatDateBR(p.date)}`,
        columns: ["Item", "Qtd", "Valor"],
        rows: p.consumo.map((c) => [nomeItem(c.productId), String(c.qty), `R$ ${valorItem(p, c.productId).toFixed(2)}`]),
        totalRow: ["", "Subtotal", `R$ ${p.consumo.reduce((s, c) => s + valorItem(p, c.productId), 0).toFixed(2)}`],
      })),
    });
  };

  const baixarCsvArquivo = () => {
    if (registros.length === 0) { alert("Nenhum consumo no período selecionado."); return; }
    const rows: (string | number)[][] = [];
    for (const p of registros) {
      for (const c of p.consumo) {
        rows.push([nomeFunc(p.employeeUsername), formatDateBR(p.date), nomeItem(c.productId), c.qty, valorItem(p, c.productId).toFixed(2)]);
      }
    }
    baixarCsv(`consumo-funcionarios-${from}-a-${to}${sufixoArquivo}.csv`, ["Funcionário", "Data", "Item", "Qtd", "Valor (R$)"], rows);
  };

  return (
    <div className="p-3 space-y-2">
      <div className="bg-card border border-border rounded-xl p-3 space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-xs text-muted-foreground">De</label>
            <div className="mt-1"><DatePickerBR value={from} onChange={setFrom} /></div>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Até</label>
            <div className="mt-1"><DatePickerBR value={to} onChange={setTo} /></div>
          </div>
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Funcionário</label>
          <select
            value={funcSelecionado}
            onChange={(e) => setFuncSelecionado(e.target.value)}
            className="mt-1 w-full h-10 rounded-md bg-input border border-border px-3 text-sm"
          >
            <option value="">Todos os funcionários</option>
            {state.funcionarios.map((f) => (
              <option key={f.username} value={f.username}>{f.nome}</option>
            ))}
          </select>
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground -mt-1 mb-1">
        Corrija aqui a quantidade de qualquer item consumido por um funcionário (0 remove o item). Se o consumo
        foi lançado no nome errado, use ↔ para transferir para quem realmente consumiu.
      </p>
      <div className="grid grid-cols-2 gap-2">
        <Button variant="secondary" onClick={baixarPdf}>📄 PDF</Button>
        <Button variant="secondary" onClick={baixarCsvArquivo}>📊 CSV</Button>
      </div>

      {registros.length === 0 ? (
        <div className="text-sm text-muted-foreground py-2">Nenhum consumo registrado nesse período.</div>
      ) : (
        <>
          {registros.map((p) => (
            <div key={p.id} className="bg-card border border-border rounded-lg p-3 space-y-2">
              <div className="text-sm font-medium flex items-center justify-between">
                <span>{nomeFunc(p.employeeUsername)}</span>
                <span className="text-xs text-muted-foreground font-normal">{formatDateBR(p.date)}</span>
              </div>
              <div className="space-y-1.5">
                {p.consumo.map((c) => (
                  <div key={c.productId} className="flex items-center gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm truncate">{nomeItem(c.productId)}</div>
                      <div className="text-[11px] text-muted-foreground mono">{BRL(valorItem(p, c.productId))}/{c.qty}un</div>
                    </div>
                    <BufferedNumberInput
                      value={c.qty}
                      decimal={false}
                      className="w-16 text-center"
                      onChange={(n) => dispatch({ type: "UPDATE_PONTO_CONSUMO", pontoId: p.id, productId: c.productId, qty: n })}
                    />
                    <button type="button" title="Transferir para outro funcionário" aria-label={`Transferir ${nomeItem(c.productId)}`}
                      onClick={() => setTransferindo({ ponto: p, productId: c.productId })}
                      className="h-9 px-2 rounded-md border border-border text-xs text-primary hover:bg-primary/10">
                      ↔
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))}
          <div className="bg-card border border-primary/40 rounded-lg p-3 flex justify-between items-center text-sm font-semibold">
            <span>Total do período</span>
            <span className="mono text-primary">{BRL(totalGeral)}</span>
          </div>
        </>
      )}
      <TransferirConsumoDialog alvo={transferindo} onClose={() => setTransferindo(null)} nomeItem={nomeItem} nomeFunc={nomeFunc} />
    </div>
  );
}

// Transfere (toda ou parte da) quantidade de um item de consumo de um funcionário para outro, na mesma
// data. Serve para corrigir consumo lançado no nome errado (ex.: tudo no nome de quem estava logada).
// O total consumido no turno não muda — só muda de quem é a conta.
function TransferirConsumoDialog({ alvo, onClose, nomeItem, nomeFunc }: {
  alvo: { ponto: Ponto; productId: string } | null;
  onClose: () => void;
  nomeItem: (id: string) => string;
  nomeFunc: (username: string) => string;
}) {
  const { state, dispatch } = useStore();
  const [para, setPara] = useState("");
  const [qtd, setQtd] = useState(0);
  // Sempre lê o registro atualizado (a quantidade pode ter mudado)
  const ponto = alvo ? state.pontos.find((p) => p.id === alvo.ponto.id) ?? null : null;
  const item = ponto?.consumo.find((c) => c.productId === alvo?.productId);
  const max = item?.qty ?? 0;
  const destinos = state.funcionarios.filter((f) => !f.excluido && f.username !== ponto?.employeeUsername);

  const abrir = (aberto: boolean) => { if (!aberto) { onClose(); setPara(""); setQtd(0); } };
  const quantidade = qtd > 0 ? qtd : max;

  const transferir = () => {
    if (!ponto || !item || !alvo) return;
    if (!para) { alert("Escolha para quem transferir."); return; }
    if (quantidade > max) { alert(`Só há ${max} un. neste registro.`); return; }
    // 1) tira de quem estava
    dispatch({ type: "UPDATE_PONTO_CONSUMO", pontoId: ponto.id, productId: item.productId, qty: max - quantidade });
    // 2) coloca em quem consumiu: no registro dele do mesmo dia (se houver) ou num registro só de consumo
    const doDestino = state.pontos.find((p) => p.employeeUsername === para && p.date === ponto.date);
    if (doDestino) {
      const atual = doDestino.consumo.find((c) => c.productId === item.productId)?.qty ?? 0;
      dispatch({ type: "UPDATE_PONTO_CONSUMO", pontoId: doDestino.id, productId: item.productId, qty: atual + quantidade });
    } else {
      dispatch({
        type: "ADD_PONTO",
        p: {
          id: crypto.randomUUID(), employeeUsername: para, date: ponto.date,
          entrada: "00:00", saida: "00:00", transporte: 0, refeicao: 0, colegas: [],
          consumo: [{ productId: item.productId, qty: quantidade }],
        },
      });
    }
    alert(`Transferido: ${quantidade}× ${nomeItem(item.productId)} de ${nomeFunc(ponto.employeeUsername)} para ${nomeFunc(para)} (${formatDateBR(ponto.date)}).`);
    abrir(false);
  };

  return (
    <Dialog open={!!alvo && !!item} onOpenChange={abrir}>
      <DialogContent className="max-w-[420px]">
        <DialogHeader><DialogTitle>↔ Transferir consumo</DialogTitle></DialogHeader>
        {ponto && item && (
          <div className="space-y-3">
            <p className="text-sm">
              <span className="font-medium">{item.qty}× {nomeItem(item.productId)}</span> lançado para{" "}
              <span className="font-medium">{nomeFunc(ponto.employeeUsername)}</span> em {formatDateBR(ponto.date)}.
            </p>
            <div>
              <label className="text-xs text-muted-foreground">Quem consumiu de verdade?</label>
              <select value={para} onChange={(e) => setPara(e.target.value)}
                className="mt-1 w-full h-10 rounded-md bg-input border border-border px-3 text-sm">
                <option value="">Escolha o funcionário</option>
                {destinos.map((f) => <option key={f.username} value={f.username}>{f.nome}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Quantidade a transferir (de {max})</label>
              <BufferedNumberInput value={qtd} decimal={false} placeholder={String(max)} className="mt-1 w-full h-10" onChange={setQtd} />
            </div>
            <Button className="w-full" onClick={transferir}>Transferir {quantidade} un.</Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
