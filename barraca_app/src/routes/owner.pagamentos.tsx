import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Shell, TopBar, BottomNav } from "@/components/Shell";
import { useStore, resumoPagamentos, nomeMaquina, ehInclusao, movimentosDinheiro, type Retirada } from "@/lib/store";
import { BRL, formatDateBR, todayISO } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DatePickerBR } from "@/components/ui/date-picker-br";
import { BufferedNumberInput } from "@/components/ui/buffered-number-input";
import { gerarRelatorioPdf } from "@/lib/pdf";
import { baixarCsv } from "@/lib/csv";
import { Trash2 } from "lucide-react";
import { useFiltro } from "@/lib/filtros";
import { PeriodoComSemana } from "@/components/PeriodoComSemana";

export const Route = createFileRoute("/owner/pagamentos")({
  component: PagamentosPage,
  head: () => ({ meta: [{ title: "Pagamentos — Barraca Terminal" }, { name: "description", content: "Vendas por tipo de pagamento, retiradas e inclusões de dinheiro no caixa e taxa das maquininhas." }] }),
});

function daysAgoISO(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function PagamentosPage() {
  const { state, dispatch } = useStore();
  const nav = useNavigate();
  const [from, setFrom] = useFiltro("pagamentos.from", daysAgoISO(7));
  const [to, setTo] = useFiltro("pagamentos.to", todayISO());

  const resumo = useMemo(() => resumoPagamentos(state.historico, from, to), [state.historico, from, to]);

  const retiradasTodas = useMemo(
    () => state.retiradas.filter((r) => r.date >= from && r.date <= to).sort((a, b) => b.date.localeCompare(a.date)),
    [state.retiradas, from, to],
  );
  const origemDe = (r: Retirada) => r.origem ?? "dinheiro";
  // Movimentos do caixa em dinheiro: retiradas (subtraem) e inclusões (somam)
  const movDinheiro = retiradasTodas.filter((r) => origemDe(r) === "dinheiro");
  const retiradasPeriodo = movDinheiro.filter((r) => !ehInclusao(r));
  const inclusoesPeriodo = movDinheiro.filter((r) => ehInclusao(r));
  const pagamentosMaq1 = retiradasTodas.filter((r) => origemDe(r) === "maq1");
  const pagamentosMaq2 = retiradasTodas.filter((r) => origemDe(r) === "maq2");
  const { retirado: totalRetirado, incluido: totalIncluido } = movimentosDinheiro(movDinheiro);
  const totalPagoMaq1 = pagamentosMaq1.reduce((s, r) => s + r.valor, 0);
  const totalPagoMaq2 = pagamentosMaq2.reduce((s, r) => s + r.valor, 0);
  const dinheiroLiquido = Math.max(0, resumo.dinheiro + totalIncluido - totalRetirado);

  const taxas = state.taxasMaquininha;
  // Líquido da maquininha = bruto − taxa − pagamentos lançados contra o saldo dela
  const maq1AposTaxa = resumo.maq1Bruto * (1 - taxas.maq1 / 100);
  const maq2AposTaxa = resumo.maq2Bruto * (1 - taxas.maq2 / 100);
  const maq1Liquido = maq1AposTaxa - totalPagoMaq1;
  const maq2Liquido = maq2AposTaxa - totalPagoMaq2;

  const totalLiquidoGeral = dinheiroLiquido + resumo.moedas + resumo.pix + resumo.voucher + maq1Liquido + maq2Liquido;

  // Formulário de movimento do caixa em dinheiro: retirada (tira) ou inclusão (coloca)
  const [novoTipo, setNovoTipo] = useState<"retirada" | "inclusao">("retirada");
  const [novoValor, setNovoValor] = useState(0);
  const [novoMotivo, setNovoMotivo] = useState("");
  const [novaData, setNovaData] = useState(todayISO());
  const incluindo = novoTipo === "inclusao";

  const addMovimento = () => {
    if (novoValor <= 0) { alert(incluindo ? "Informe o valor da inclusão." : "Informe o valor da retirada."); return; }
    if (!novoMotivo.trim()) { alert(incluindo ? "Informe de onde veio / para que foi a inclusão." : "Informe para que foi a retirada."); return; }
    const r: Retirada = {
      id: crypto.randomUUID(), date: novaData, valor: novoValor, motivo: novoMotivo.trim(), criadoEm: Date.now(),
      origem: "dinheiro", tipo: novoTipo,
    };
    dispatch({ type: "ADD_RETIRADA", r });
    setNovoValor(0); setNovoMotivo("");
  };

  // Formulário de pagamento abatido do saldo de uma maquininha de cartão
  const [cartaoMaq, setCartaoMaq] = useState<"maq1" | "maq2">("maq1");
  const [cartaoValor, setCartaoValor] = useState(0);
  const [cartaoMotivo, setCartaoMotivo] = useState("");
  const [cartaoData, setCartaoData] = useState(todayISO());

  const addPagamentoCartao = () => {
    if (cartaoValor <= 0) { alert("Informe o valor do pagamento."); return; }
    if (!cartaoMotivo.trim()) { alert("Informe para que foi o pagamento."); return; }
    const r: Retirada = { id: crypto.randomUUID(), date: cartaoData, valor: cartaoValor, motivo: cartaoMotivo.trim(), criadoEm: Date.now(), origem: cartaoMaq };
    dispatch({ type: "ADD_RETIRADA", r });
    setCartaoValor(0); setCartaoMotivo("");
  };
  const nomeMaq = (o: "maq1" | "maq2") => nomeMaquina(state.taxasMaquininha, o);

  const baixarPdf = () => {
    gerarRelatorioPdf({
      filename: `pagamentos-${from}-a-${to}.pdf`,
      title: "Vendas por tipo de pagamento",
      subtitle: `${formatDateBR(from)} a ${formatDateBR(to)}`,
      sections: [
        {
          heading: "Resumo por tipo de pagamento",
          columns: ["Tipo", "Bruto", "Líquido"],
          rows: [
            ["Dinheiro", `R$${resumo.dinheiro.toFixed(2)}`, `R$${dinheiroLiquido.toFixed(2)} (inclusões R$${totalIncluido.toFixed(2)}, retiradas R$${totalRetirado.toFixed(2)})`],
            ["Moedas", `R$${resumo.moedas.toFixed(2)}`, `R$${resumo.moedas.toFixed(2)}`],
            ["Pix", `R$${resumo.pix.toFixed(2)}`, `R$${resumo.pix.toFixed(2)}`],
            ["Voucher", `R$${resumo.voucher.toFixed(2)}`, `R$${resumo.voucher.toFixed(2)}`],
            [nomeMaq("maq1"), `R$${resumo.maq1Bruto.toFixed(2)}`, `R$${maq1Liquido.toFixed(2)} (taxa ${taxas.maq1}%, pagamentos R$${totalPagoMaq1.toFixed(2)})`],
            [nomeMaq("maq2"), `R$${resumo.maq2Bruto.toFixed(2)}`, `R$${maq2Liquido.toFixed(2)} (taxa ${taxas.maq2}%, pagamentos R$${totalPagoMaq2.toFixed(2)})`],
          ],
          totalRow: ["TOTAL LÍQUIDO", "", `R$${totalLiquidoGeral.toFixed(2)}`],
        },
        {
          heading: `Inclusões de dinheiro no caixa (total: R$${totalIncluido.toFixed(2)})`,
          columns: ["Data", "Valor", "Motivo"],
          rows: inclusoesPeriodo.map((r) => [formatDateBR(r.date), `R$${r.valor.toFixed(2)}`, r.motivo]),
        },
        {
          heading: `Retiradas de dinheiro (total: R$${totalRetirado.toFixed(2)})`,
          columns: ["Data", "Valor", "Motivo"],
          rows: retiradasPeriodo.map((r) => [formatDateBR(r.date), `R$${r.valor.toFixed(2)}`, r.motivo]),
        },
        {
          heading: `Pagamentos pelas maquininhas (total: R$${(totalPagoMaq1 + totalPagoMaq2).toFixed(2)})`,
          columns: ["Data", "Cartão/Banco", "Valor", "Motivo"],
          rows: [...pagamentosMaq1, ...pagamentosMaq2]
            .sort((a, b) => b.date.localeCompare(a.date))
            .map((r) => [formatDateBR(r.date), nomeMaq(r.origem as "maq1" | "maq2"), `R$${r.valor.toFixed(2)}`, r.motivo]),
        },
      ],
    });
  };

  const baixarCsvArquivo = () => {
    const linhas: (string | number)[][] = [];
    linhas.push(["RESUMO POR TIPO DE PAGAMENTO"]);
    linhas.push(["Tipo", "Bruto (R$)", "Líquido (R$)"]);
    linhas.push(["Dinheiro", resumo.dinheiro.toFixed(2), dinheiroLiquido.toFixed(2)]);
    linhas.push(["Moedas", resumo.moedas.toFixed(2), resumo.moedas.toFixed(2)]);
    linhas.push(["Pix", resumo.pix.toFixed(2), resumo.pix.toFixed(2)]);
    linhas.push(["Voucher", resumo.voucher.toFixed(2), resumo.voucher.toFixed(2)]);
    linhas.push([`${nomeMaq("maq1")} (taxa ${taxas.maq1}%)`, resumo.maq1Bruto.toFixed(2), maq1Liquido.toFixed(2)]);
    linhas.push([`${nomeMaq("maq2")} (taxa ${taxas.maq2}%)`, resumo.maq2Bruto.toFixed(2), maq2Liquido.toFixed(2)]);
    linhas.push(["TOTAL LÍQUIDO", "", totalLiquidoGeral.toFixed(2)]);
    linhas.push([]);
    linhas.push([`INCLUSÕES DE DINHEIRO NO CAIXA (total: R$${totalIncluido.toFixed(2)})`]);
    linhas.push(["Data", "Valor (R$)", "Motivo"]);
    for (const r of inclusoesPeriodo) linhas.push([formatDateBR(r.date), r.valor.toFixed(2), r.motivo]);
    linhas.push([]);
    linhas.push([`RETIRADAS DE DINHEIRO (total: R$${totalRetirado.toFixed(2)})`]);
    linhas.push(["Data", "Valor (R$)", "Motivo"]);
    for (const r of retiradasPeriodo) linhas.push([formatDateBR(r.date), r.valor.toFixed(2), r.motivo]);
    linhas.push([]);
    linhas.push([`PAGAMENTOS PELAS MAQUININHAS (total: R$${(totalPagoMaq1 + totalPagoMaq2).toFixed(2)})`]);
    linhas.push(["Data", "Cartão/Banco", "Valor (R$)", "Motivo"]);
    for (const r of [...pagamentosMaq1, ...pagamentosMaq2].sort((a, b) => b.date.localeCompare(a.date))) {
      linhas.push([formatDateBR(r.date), nomeMaq(r.origem as "maq1" | "maq2"), r.valor.toFixed(2), r.motivo]);
    }
    baixarCsv(`pagamentos-${from}-a-${to}.csv`, [], linhas);
  };

  return (
    <Shell>
      <TopBar title="Pagamentos" right={<button onClick={() => nav({ to: "/owner" })} className="text-xs text-muted-foreground">Voltar</button>} />

      <div className="p-3 space-y-3">
        <div className="bg-card border border-border rounded-xl p-3">
          <PeriodoComSemana from={from} to={to} setFrom={setFrom} setTo={setTo} />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Button variant="secondary" onClick={baixarPdf}>📄 PDF</Button>
          <Button variant="secondary" onClick={baixarCsvArquivo}>📊 CSV</Button>
        </div>

        {/* Resumo por tipo de pagamento */}
        <div className="bg-card border border-border rounded-xl p-3 space-y-2">
          <h2 className="text-sm font-semibold">Vendas por tipo de pagamento</h2>
          <div className="space-y-1.5 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Dinheiro (bruto)</span><span className="mono">{BRL(resumo.dinheiro)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Moedas</span><span className="mono">{BRL(resumo.moedas)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Pix</span><span className="mono">{BRL(resumo.pix)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Voucher</span><span className="mono">{BRL(resumo.voucher)}</span></div>
          </div>
        </div>

        {/* Dinheiro: retiradas e inclusões do caixa */}
        <div className="bg-card border border-border rounded-xl p-3 space-y-3">
          <h2 className="text-sm font-semibold">💵 Dinheiro — retiradas e inclusões do caixa</h2>
          <div className="text-xs text-muted-foreground space-y-1">
            <div className="flex justify-between"><span>Bruto (vendido em dinheiro)</span><span className="mono">{BRL(resumo.dinheiro)}</span></div>
            <div className="flex justify-between"><span>Total incluído no período</span><span className="mono text-success">+{BRL(totalIncluido)}</span></div>
            <div className="flex justify-between"><span>Total retirado no período</span><span className="mono text-warning">-{BRL(totalRetirado)}</span></div>
            <div className="flex justify-between text-sm font-semibold text-foreground border-t border-border pt-1">
              <span>Dinheiro líquido (com inclusões e retiradas)</span><span className="mono text-primary">{BRL(dinheiroLiquido)}</span>
            </div>
          </div>

          <div className="border-t border-border pt-2 space-y-2">
            <div className="grid grid-cols-2 gap-2">
              {([
                { key: "retirada", label: "➖ Retirada" },
                { key: "inclusao", label: "➕ Inclusão" },
              ] as const).map((o) => (
                <button key={o.key} type="button" onClick={() => setNovoTipo(o.key)}
                  className={`h-9 rounded-md text-sm border ${novoTipo === o.key
                    ? (o.key === "inclusao" ? "bg-success text-white border-success" : "bg-primary text-primary-foreground border-primary")
                    : "bg-card border-border text-muted-foreground"}`}>
                  {o.label}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground">
              {incluindo
                ? "Inclusão: dinheiro colocado no caixa (ex.: troco, reforço). Soma no dinheiro líquido."
                : "Retirada: dinheiro tirado do caixa (ex.: compra de insumos). Subtrai do dinheiro líquido."}
            </p>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-muted-foreground">Data</label>
                <div className="mt-1"><DatePickerBR value={novaData} onChange={setNovaData} /></div>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Valor (R$)</label>
                <BufferedNumberInput value={novoValor} placeholder="0,00" className="mt-1 w-full h-10" onChange={setNovoValor} />
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">{incluindo ? "De onde veio / para que foi a inclusão?" : "Para que foi a retirada?"}</label>
              <Input value={novoMotivo} onChange={(e) => setNovoMotivo(e.target.value)}
                placeholder={incluindo ? "Ex: troco para o caixa, reforço, etc." : "Ex: compra de insumos, troco, etc."} className="mt-1" />
            </div>
            <Button onClick={addMovimento} className="w-full">{incluindo ? "Lançar inclusão" : "Lançar retirada"}</Button>
          </div>

          {movDinheiro.length > 0 && (
            <div className="space-y-1.5">
              {movDinheiro.map((r) => {
                const inc = ehInclusao(r);
                return (
                  <div key={r.id} className="flex items-center justify-between text-xs bg-background border border-border/60 rounded-md p-2">
                    <div>
                      <div className="font-medium text-foreground">
                        <span className={inc ? "text-success" : "text-warning"}>{inc ? "+" : "-"}{BRL(r.valor)}</span>{" "}
                        <span className="text-muted-foreground font-normal">— {r.motivo}</span>
                      </div>
                      <div className="text-muted-foreground">{formatDateBR(r.date)} · {inc ? "Inclusão" : "Retirada"}</div>
                    </div>
                    <button onClick={() => dispatch({ type: "REMOVE_RETIRADA", id: r.id })} className="text-muted-foreground hover:text-destructive"
                      aria-label={inc ? "Excluir inclusão" : "Excluir retirada"}>
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Maquininhas: bruto x líquido */}
        <div className="bg-card border border-border rounded-xl p-3 space-y-3">
          <h2 className="text-sm font-semibold">💳 Cartão — bruto x líquido (já abatendo taxa e pagamentos)</h2>
          <p className="text-[11px] text-muted-foreground -mt-2">Escreva no campo o nome do banco/maquininha (ex.: Stone, Cielo). Esse nome aparece em todo o app e nos relatórios.</p>
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Input
                value={taxas.nome1 ?? ""}
                placeholder="Maquininha 1"
                maxLength={30}
                onChange={(e) => dispatch({ type: "SET_TAXAS_MAQUININHA", patch: { nome1: e.target.value } })}
                className="h-9 text-sm flex-1 min-w-0"
                aria-label="Nome da maquininha 1 (ex.: banco)"
              />
              <div className="flex items-center gap-1.5">
                <BufferedNumberInput
                  value={taxas.maq1} decimal className="w-16 text-center" placeholder="0"
                  onChange={(n) => dispatch({ type: "SET_TAXAS_MAQUININHA", patch: { maq1: n } })}
                />
                <span className="text-xs text-muted-foreground">% taxa</span>
              </div>
            </div>
            <div className="text-xs text-muted-foreground space-y-0.5">
              <div className="flex justify-between"><span>Bruto: {BRL(resumo.maq1Bruto)}</span><span>Após taxa: {BRL(maq1AposTaxa)}</span></div>
              <div className="flex justify-between"><span>Pagamentos lançados: <span className="text-warning">-{BRL(totalPagoMaq1)}</span></span>
                <span>Líquido: <span className="text-primary font-medium">{BRL(maq1Liquido)}</span></span></div>
            </div>
          </div>
          <div className="space-y-2 border-t border-border pt-2">
            <div className="flex items-center justify-between gap-2">
              <Input
                value={taxas.nome2 ?? ""}
                placeholder="Maquininha 2"
                maxLength={30}
                onChange={(e) => dispatch({ type: "SET_TAXAS_MAQUININHA", patch: { nome2: e.target.value } })}
                className="h-9 text-sm flex-1 min-w-0"
                aria-label="Nome da maquininha 2 (ex.: banco)"
              />
              <div className="flex items-center gap-1.5">
                <BufferedNumberInput
                  value={taxas.maq2} decimal className="w-16 text-center" placeholder="0"
                  onChange={(n) => dispatch({ type: "SET_TAXAS_MAQUININHA", patch: { maq2: n } })}
                />
                <span className="text-xs text-muted-foreground">% taxa</span>
              </div>
            </div>
            <div className="text-xs text-muted-foreground space-y-0.5">
              <div className="flex justify-between"><span>Bruto: {BRL(resumo.maq2Bruto)}</span><span>Após taxa: {BRL(maq2AposTaxa)}</span></div>
              <div className="flex justify-between"><span>Pagamentos lançados: <span className="text-warning">-{BRL(totalPagoMaq2)}</span></span>
                <span>Líquido: <span className="text-primary font-medium">{BRL(maq2Liquido)}</span></span></div>
            </div>
          </div>

          {/* Pagamentos feitos com o saldo das maquininhas (abatem o líquido delas) */}
          <div className="border-t border-border pt-2 space-y-2">
            <h3 className="text-sm font-semibold">Lançar pagamento pela maquininha</h3>
            <div className="grid grid-cols-2 gap-2">
              {(["maq1", "maq2"] as const).map((m) => (
                <button key={m} type="button" onClick={() => setCartaoMaq(m)}
                  className={`h-9 rounded-md text-sm border ${cartaoMaq === m ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-muted-foreground"}`}>
                  {nomeMaq(m)}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-muted-foreground">Data</label>
                <div className="mt-1"><DatePickerBR value={cartaoData} onChange={setCartaoData} /></div>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Valor (R$)</label>
                <BufferedNumberInput value={cartaoValor} placeholder="0,00" className="mt-1 w-full h-10" onChange={setCartaoValor} />
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Para que foi o pagamento?</label>
              <Input value={cartaoMotivo} onChange={(e) => setCartaoMotivo(e.target.value)} placeholder="Ex: pagamento de fornecedor, diária, etc." className="mt-1" />
            </div>
            <Button onClick={addPagamentoCartao} className="w-full">Lançar pagamento</Button>

            {[...pagamentosMaq1, ...pagamentosMaq2].length > 0 && (
              <div className="space-y-1.5">
                {[...pagamentosMaq1, ...pagamentosMaq2].sort((a, b) => b.date.localeCompare(a.date)).map((r) => (
                  <div key={r.id} className="flex items-center justify-between text-xs bg-background border border-border/60 rounded-md p-2">
                    <div>
                      <div className="font-medium text-foreground">{BRL(r.valor)} <span className="text-muted-foreground font-normal">— {r.motivo}</span></div>
                      <div className="text-muted-foreground">{formatDateBR(r.date)} · {nomeMaq(r.origem as "maq1" | "maq2")}</div>
                    </div>
                    <button onClick={() => dispatch({ type: "REMOVE_RETIRADA", id: r.id })} className="text-muted-foreground hover:text-destructive">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Total geral líquido */}
        <div className="bg-card border border-primary/40 rounded-xl p-3 flex justify-between items-center">
          <span className="text-sm font-semibold">Total líquido do período</span>
          <span className="mono text-primary text-lg font-semibold">{BRL(totalLiquidoGeral)}</span>
        </div>
      </div>

      <BottomNav />
    </Shell>
  );
}
