import { useState } from "react";
import { useStore, totalSaidas, type Turno, type DespesaCaixa } from "@/lib/store";
import { BRL } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BufferedNumberInput } from "@/components/ui/buffered-number-input";
import { Trash2 } from "lucide-react";

const hora = (ms: number) => new Date(ms).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });

// Dinheiro tirado do caixa durante o turno para pagar uma despesa da lista (ex.: limpeza da praça).
// O valor vem da lista (só o dono/administrador muda em Produtos → Saídas do caixa) e soma no Arrecadado
// do fechamento: o dinheiro saiu do caixa, mas não é falta.
export function SaidasCaixa({ turno, podeAlterar = true }: { turno: Turno; podeAlterar?: boolean }) {
  const { state, dispatch } = useStore();
  const [escolha, setEscolha] = useState("");
  const saidas = turno.saidas ?? [];
  const lista = state.despesasCaixa;
  const nome = (u: string) => state.funcionarios.find((f) => f.username === u)?.nome ?? (u === "dono" ? "Dono" : u);

  const lancar = () => {
    const d = lista.find((x) => x.id === escolha);
    if (!d) { alert("Escolha a despesa paga com o dinheiro do caixa."); return; }
    if (!confirm(`Lançar saída do caixa:\n\n${d.nome}: ${BRL(d.valor)}\n\nTire do caixa exatamente esse valor. Ele não conta como falta no fechamento.`)) return;
    dispatch({ type: "ADD_SAIDA", saida: {
      id: crypto.randomUUID(), turnoId: turno.id, despesaId: d.id, nome: d.nome, valor: d.valor,
      por: state.currentUser?.username ?? "", criadoEm: Date.now(),
    } });
    setEscolha("");
  };
  const remover = (id: string, rotulo: string) => {
    if (!confirm(`Tirar a saída "${rotulo}" deste turno?\n\nSe o dinheiro não saiu do caixa, ele volta a contar no fechamento.`)) return;
    dispatch({ type: "REMOVE_SAIDA", turnoId: turno.id, id });
  };

  return (
    <div className="bg-card border border-border rounded-xl p-3 space-y-2" id="saidas-do-caixa">
      <div className="text-sm font-medium">💸 Saídas do caixa (pagamentos em dinheiro)</div>
      <p className="text-[11px] text-muted-foreground">
        Pagou alguma despesa com o dinheiro do caixa (ex.: limpeza da praça)? Lance aqui. O valor não conta como falta;
        conte o Dinheiro Final já sem esse dinheiro.
      </p>
      {saidas.length > 0 && (
        <div className="space-y-1">
          {saidas.map((x) => (
            <div key={x.id} className="flex items-center justify-between gap-2 text-xs bg-background border border-border/60 rounded-md px-2 py-1.5">
              <span>
                <span className="font-medium">{x.nome}</span>
                <span className="text-muted-foreground"> · {nome(x.por)} · {hora(x.criadoEm)}</span>
              </span>
              <span className="flex items-center gap-2">
                <span className="mono font-semibold">{BRL(x.valor)}</span>
                {podeAlterar && (
                  <button aria-label={`Tirar a saída ${x.nome}`} onClick={() => remover(x.id, `${x.nome} ${BRL(x.valor)}`)}
                    className="text-muted-foreground hover:text-destructive"><Trash2 className="w-3.5 h-3.5" /></button>
                )}
              </span>
            </div>
          ))}
          <div className="flex justify-between text-xs font-semibold pt-0.5">
            <span>Total de saídas</span><span className="mono">{BRL(totalSaidas(turno))}</span>
          </div>
        </div>
      )}
      {podeAlterar && (lista.length === 0 ? (
        <p className="text-[11px] text-warning">Nenhuma despesa cadastrada. O dono ou o administrador cadastra em Produtos → 💸 Saídas do caixa.</p>
      ) : (
        <div className="flex gap-2">
          <select value={escolha} onChange={(e) => setEscolha(e.target.value)} aria-label="Despesa paga com o dinheiro do caixa"
            className="flex-1 min-w-0 h-10 rounded-md bg-input border border-border px-2 text-sm">
            <option value="">Escolha a despesa…</option>
            {lista.map((d) => <option key={d.id} value={d.id}>{d.nome} — {BRL(d.valor)}</option>)}
          </select>
          <Button className="h-10 shrink-0" variant="secondary" onClick={lancar} disabled={!escolha}>Lançar saída</Button>
        </div>
      ))}
    </div>
  );
}

// Produtos → 💸 Saídas do caixa: a lista de despesas que podem ser pagas com o dinheiro do caixa e o valor de
// cada uma (só dono/administrador). Mudar o valor vale para os próximos lançamentos; os já feitos não mudam.
export function DespesasCaixaEditor() {
  const { state, dispatch } = useStore();
  const [nome, setNome] = useState("");
  const [valor, setValor] = useState(0);
  const salvar = (d: DespesaCaixa) => dispatch({ type: "SALVAR_DESPESA", d });
  const adicionar = () => {
    if (!nome.trim()) { alert("Digite o nome da despesa (ex.: Limpeza da praça)."); return; }
    if (valor <= 0) { alert("Informe o valor da despesa."); return; }
    const ordem = Math.max(0, ...state.despesasCaixa.map((d) => d.ordem)) + 1;
    salvar({ id: crypto.randomUUID(), nome: nome.trim(), valor, ordem });
    setNome(""); setValor(0);
  };
  return (
    <div className="p-3 space-y-2">
      <p className="text-[11px] text-muted-foreground -mt-1 mb-1">
        Despesas que o funcionário pode pagar com o dinheiro do caixa (menu Turno → aba Caixa → 💸 Saídas do caixa).
        Ele só escolhe da lista; o valor é o que está aqui. Mudar o valor vale para os próximos lançamentos.
      </p>
      {state.despesasCaixa.length === 0 && <p className="text-xs text-muted-foreground">Nenhuma despesa cadastrada ainda.</p>}
      {state.despesasCaixa.map((d) => (
        <div key={d.id} className="bg-card border border-border rounded-lg p-3 space-y-2">
          <div className="flex items-center gap-2">
            <Input defaultValue={d.nome} aria-label={`Nome da despesa ${d.nome}`} className="flex-1 h-9"
              onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== d.nome) salvar({ ...d, nome: v }); }} />
            <button aria-label={`Excluir a despesa ${d.nome}`} className="text-muted-foreground hover:text-destructive"
              onClick={() => confirm(`Excluir "${d.nome}" da lista?\n\nAs saídas já lançadas nos turnos continuam.`) && dispatch({ type: "REMOVE_DESPESA", id: d.id })}>
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-[10px] text-muted-foreground uppercase tracking-wide w-20">Valor (R$)</label>
            <BufferedNumberInput value={d.valor} placeholder="0,00" className="flex-1 text-right" aria-label={`Valor da despesa ${d.nome}`}
              onChange={() => {}} onBlur={(n) => { if (n > 0 && Math.abs(n - d.valor) > 0.004) salvar({ ...d, valor: n }); }} />
          </div>
        </div>
      ))}
      <div className="bg-card border border-border rounded-xl p-3 space-y-2 mt-3">
        <h3 className="text-sm font-semibold">Adicionar despesa</h3>
        <Input placeholder="Nome (ex.: Limpeza da praça)" value={nome} onChange={(e) => setNome(e.target.value)} aria-label="Nome da nova despesa" />
        <div>
          <label className="text-xs text-muted-foreground">Valor (R$)</label>
          <BufferedNumberInput value={valor} placeholder="0,00" className="mt-1 w-full h-10" onChange={setValor} aria-label="Valor da nova despesa" />
        </div>
        <Button onClick={adicionar} className="w-full">Adicionar à lista</Button>
      </div>
    </div>
  );
}
