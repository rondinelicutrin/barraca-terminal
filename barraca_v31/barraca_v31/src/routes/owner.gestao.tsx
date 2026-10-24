import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  ResponsiveContainer, BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, ReferenceLine,
} from "recharts";
import { Shell, TopBar, BottomNav } from "@/components/Shell";
import { useStore } from "@/lib/store";
import { BRL, formatDateBR, shiftLabel, todayISO } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { DatePickerBR } from "@/components/ui/date-picker-br";
import { gerarRelatorioPdf, type PdfSection } from "@/lib/pdf";
import { baixarCsv } from "@/lib/csv";
import {
  TURNOS, linhasDoPeriodo, totaisGerais, liquidoDoPeriodo, porFuncionario, porTipoTurno, matrizFuncTurno,
  agruparPor, sobrasPorProduto, consumoPorFuncionario, faturamentoJanelas, rotuloPeriodo, addDias, diasEntre,
  type ModoAgrupar,
} from "@/lib/gestao";
import { useFiltro } from "@/lib/filtros";

export const Route = createFileRoute("/owner/gestao")({
  component: GestaoPage,
  head: () => ({ meta: [{ title: "Gestão — Barraca Terminal" }, { name: "description", content: "Dashboard de gestão: faturamento, funcionários, turnos, perdas, sobras e consumo." }] }),
});

// Cores fixas (legíveis nos temas claro e escuro)
const COR = { verde: "#22c55e", ambar: "#f59e0b", vermelho: "#ef4444", azul: "#3b82f6", roxo: "#a855f7", cinza: "#9ca3af" };
const COR_TURNO: Record<string, string> = { manha: COR.ambar, tarde: COR.azul, noite: COR.roxo };
const PIZZA = [COR.verde, COR.azul, COR.roxo, COR.ambar, "#06b6d4", "#ec4899"];

type Aba = "resumo" | "funcionarios" | "turnos" | "perdas" | "sobras" | "consumo";
const ABAS: { key: Aba; label: string }[] = [
  { key: "resumo", label: "Resumo" },
  { key: "funcionarios", label: "Funcionários" },
  { key: "turnos", label: "Turnos" },
  { key: "perdas", label: "Perdas" },
  { key: "sobras", label: "Sobras" },
  { key: "consumo", label: "Consumo" },
];

const brlCurto = (n: number) => `R$${Math.round(n).toLocaleString("pt-BR")}`;
const f2 = (n: number) => n.toFixed(2);

function GestaoPage() {
  const { state } = useStore();
  const nav = useNavigate();
  const hoje = todayISO();
  const [from, setFrom] = useFiltro("gestao.from", addDias(hoje, -29));
  const [to, setTo] = useFiltro("gestao.to", hoje);
  const [aba, setAba] = useFiltro<Aba>("gestao.aba", "resumo");
  const [modo, setModo] = useFiltro<ModoAgrupar>("gestao.modo", "dia");

  const preset = (p: "hoje" | "7" | "mes" | "ano" | "tudo") => {
    if (p === "hoje") { setFrom(hoje); setTo(hoje); }
    else if (p === "7") { setFrom(addDias(hoje, -6)); setTo(hoje); }
    else if (p === "mes") { setFrom(hoje.slice(0, 7) + "-01"); setTo(hoje); }
    else if (p === "ano") { setFrom(hoje.slice(0, 4) + "-01-01"); setTo(hoje); }
    else {
      const datas = state.historico.map((t) => t.date).sort();
      setFrom(datas[0] ?? hoje); setTo(hoje);
    }
  };

  const linhas = useMemo(() => linhasDoPeriodo(state, from, to), [state, from, to]);
  const tot = useMemo(() => totaisGerais(linhas), [linhas]);
  const liq = useMemo(() => liquidoDoPeriodo(state, from, to), [state, from, to]);
  const funcs = useMemo(() => porFuncionario(linhas), [linhas]);
  const tiposTurno = useMemo(() => porTipoTurno(state, linhas), [state, linhas]);
  const matriz = useMemo(() => matrizFuncTurno(linhas), [linhas]);
  const grupos = useMemo(() => agruparPor(linhas, modo), [linhas, modo]);
  const sobrasProd = useMemo(() => sobrasPorProduto(state, linhas), [state, linhas]);
  const consumo = useMemo(() => consumoPorFuncionario(state, from, to), [state, from, to]);
  const janelas = useMemo(() => faturamentoJanelas(state, hoje), [state, hoje]);

  // Período anterior, do mesmo tamanho, para comparar
  const anterior = useMemo(() => {
    const dias = diasEntre(from, to);
    const pTo = addDias(from, -1);
    const pFrom = addDias(pTo, -(dias - 1));
    return totaisGerais(linhasDoPeriodo(state, pFrom, pTo));
  }, [state, from, to]);
  const variacao = anterior.bruto > 0 ? ((tot.bruto - anterior.bruto) / anterior.bruto) * 100 : null;

  const porDia = useMemo(() => agruparPor(linhas, "dia").map((g) => ({ dia: rotuloPeriodo(g.key), Arrecadado: g.arrec, Esperado: g.esp })), [linhas]);
  const nomeTurno = (s: string) => shiftLabel(s);
  const rotuloGrupo = (key: string) => (modo === "dia" ? formatDateBR(key) : modo === "mes" ? rotuloPeriodo(key) : key);

  const semDados = linhas.length === 0;

  // ───── Exportação: PDF (com gráficos de barras) e CSV, com o que está selecionado no período ─────
  type Secao = { titulo: string; colunas: string[]; linhas: (string | number)[][]; barras?: { label: string; value: number; valueText: string }[]; total?: (string | number)[] };
  const montarSecoes = (): Secao[] => {
    const s: Secao[] = [];
    s.push({
      titulo: "Resumo do período",
      colunas: ["Indicador", "Valor"],
      linhas: [
        ["Caixa total bruto", BRL(liq.bruto)],
        ["Taxas das maquininhas", BRL(liq.taxasCartao)],
        ["Inclusões de dinheiro", BRL(liq.inclusoes)],
        ["Retiradas de dinheiro", BRL(liq.retiradas)],
        ["Pagamentos pelas maquininhas", BRL(liq.pagoMaq1 + liq.pagoMaq2)],
        ["Caixa total líquido", BRL(liq.liquido)],
        ["Arrecadado nos turnos", BRL(tot.bruto)],
        ["Esperado nos turnos", BRL(tot.esperado)],
        ["Perdido em faltas de caixa", BRL(tot.perdas)],
        ["Sobras de caixa (a mais)", BRL(tot.sobras)],
        ["Turnos fechados", tot.turnos],
        ["Média por turno", BRL(tot.media)],
      ],
    });
    s.push({
      titulo: "Faturamento fixo (até hoje)",
      colunas: ["Janela", "Faturamento"],
      linhas: [["Hoje", BRL(janelas.hoje)], ["Semana (seg. a hoje)", BRL(janelas.semana)], ["Mês", BRL(janelas.mes)], ["Ano", BRL(janelas.ano)]],
    });
    s.push({
      titulo: "Faturamento por forma de pagamento",
      colunas: ["Forma", "Valor"],
      linhas: liq.formas.map((f) => [f.nome, BRL(f.valor)]),
      barras: liq.formas.map((f) => ({ label: f.nome, value: f.valor, valueText: BRL(f.valor) })),
    });
    s.push({
      titulo: "Vendas por funcionário (turnos que fechou)",
      colunas: ["Funcionário", "Turnos", "Vendas", "Média/turno"],
      linhas: funcs.map((f) => [f.nome, f.turnos, BRL(f.vendas), BRL(f.media)]),
      barras: funcs.map((f) => ({ label: f.nome, value: f.vendas, valueText: BRL(f.vendas) })),
    });
    s.push({
      titulo: "Caixa por turno (manhã / tarde / noite)",
      colunas: ["Turno", "Turnos", "Arrecadado", "Média", "Faltas"],
      linhas: tiposTurno.map((t) => [nomeTurno(t.shift), t.turnos, BRL(t.arrec), BRL(t.media), BRL(t.perdas)]),
      barras: tiposTurno.map((t) => ({ label: nomeTurno(t.shift), value: t.arrec, valueText: BRL(t.arrec) })),
    });
    s.push({
      titulo: "Funcionários × turnos (arrecadado)",
      colunas: ["Funcionário", "Manhã", "Tarde", "Noite"],
      linhas: matriz.map((m) => [m.nome, ...TURNOS.map((t) => `${BRL(m.por[t].arrec)} (${m.por[t].n})`)]),
    });
    s.push({
      titulo: "Diferença de caixa por funcionário (− falta / + sobra)",
      colunas: ["Funcionário", "Saldo", "Faltas"],
      linhas: funcs.map((f) => [f.nome, BRL(f.saldo), BRL(f.perdas)]),
      barras: funcs.map((f) => ({ label: f.nome, value: f.saldo, valueText: BRL(f.saldo) })),
    });
    for (const m of ["dia", "mes", "ano"] as ModoAgrupar[]) {
      const g = agruparPor(linhas, m);
      s.push({
        titulo: `Perdas por diferença de caixa — por ${m === "dia" ? "dia" : m === "mes" ? "mês" : "ano"}`,
        colunas: [m === "dia" ? "Dia" : m === "mes" ? "Mês" : "Ano", "Turnos", "Arrecadado", "Esperado", "Perdido", "A mais"],
        linhas: g.map((x) => [m === "dia" ? formatDateBR(x.key) : m === "mes" ? rotuloPeriodo(x.key) : x.key, x.turnos, BRL(x.arrec), BRL(x.esp), BRL(x.perdas), BRL(x.sobras)]),
        total: ["TOTAL", tot.turnos, BRL(tot.bruto), BRL(tot.esperado), BRL(tot.perdas), BRL(tot.sobras)],
      });
    }
    s.push({
      titulo: "Sobras por turno (unidades e valor)",
      colunas: ["Turno", "Sobra (un)", "Sobra (R$)"],
      linhas: tiposTurno.map((t) => [nomeTurno(t.shift), t.sobraUn, BRL(t.sobraValor)]),
      barras: tiposTurno.map((t) => ({ label: nomeTurno(t.shift), value: t.sobraUn, valueText: `${t.sobraUn} un` })),
    });
    s.push({
      titulo: "Produtos que mais sobram",
      colunas: ["Produto", "Sobra (un)"],
      linhas: sobrasProd.map((p) => [p.nome, p.un]),
      barras: sobrasProd.map((p) => ({ label: p.nome, value: p.un, valueText: `${p.un} un` })),
    });
    s.push({
      titulo: "Consumo por funcionário (valor descontado)",
      colunas: ["Funcionário", "Registros", "Unidades", "Valor"],
      linhas: consumo.map((c) => [c.nome, c.registros, c.unidades, BRL(c.valor)]),
      barras: consumo.map((c) => ({ label: c.nome, value: c.valor, valueText: BRL(c.valor) })),
    });
    return s;
  };

  const baixarPdf = () => {
    if (semDados) { alert("Nenhum turno fechado no período selecionado."); return; }
    const secoes: PdfSection[] = [];
    for (const sec of montarSecoes()) {
      if (sec.barras && sec.barras.length > 0) {
        secoes.push({ heading: sec.titulo, columns: [], rows: [], bars: sec.barras });
      }
      secoes.push({
        heading: sec.barras ? undefined : sec.titulo,
        columns: sec.colunas,
        rows: sec.linhas.map((l) => l.map(String)),
        totalRow: sec.total?.map(String),
      });
    }
    gerarRelatorioPdf({
      filename: `gestao-${from}-a-${to}.pdf`,
      title: "Gestão — visão geral da barraca",
      subtitle: [`Período: ${formatDateBR(from)} a ${formatDateBR(to)}`, `Gerado em ${formatDateBR(hoje)}`],
      sections: secoes,
    });
  };

  const baixarCsvArquivo = () => {
    if (semDados) { alert("Nenhum turno fechado no período selecionado."); return; }
    const out: (string | number)[][] = [["GESTÃO — VISÃO GERAL DA BARRACA"], [`Período: ${formatDateBR(from)} a ${formatDateBR(to)}`], []];
    for (const sec of montarSecoes()) {
      out.push([sec.titulo.toUpperCase()]);
      out.push(sec.colunas);
      for (const l of sec.linhas) out.push(l);
      if (sec.total) out.push(sec.total);
      out.push([]);
    }
    baixarCsv(`gestao-${from}-a-${to}.csv`, [], out);
  };

  return (
    <Shell>
      <TopBar title="Gestão" right={<button onClick={() => nav({ to: "/owner" })} className="text-xs text-muted-foreground">Voltar</button>} />

      <div className="p-3 space-y-3">
        {/* Período */}
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
          <div className="flex gap-1.5 flex-wrap">
            {([["hoje", "Hoje"], ["7", "7 dias"], ["mes", "Este mês"], ["ano", "Este ano"], ["tudo", "Tudo"]] as const).map(([k, l]) => (
              <button key={k} onClick={() => preset(k)} className="px-3 h-9 rounded-full text-xs bg-background border border-border text-muted-foreground hover:text-primary">{l}</button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Button variant="secondary" onClick={baixarPdf}>📄 PDF (impressão)</Button>
          <Button variant="secondary" onClick={baixarCsvArquivo}>📊 CSV</Button>
        </div>

        {/* Abas */}
        <div className="flex gap-1 overflow-x-auto pb-1">
          {ABAS.map((a) => (
            <button key={a.key} onClick={() => setAba(a.key)}
              className={`px-3 h-8 rounded-full text-xs whitespace-nowrap ${aba === a.key ? "bg-primary text-primary-foreground" : "bg-card border border-border text-muted-foreground"}`}>
              {a.label}
            </button>
          ))}
        </div>

        {semDados && aba !== "consumo" && (
          <div className="bg-card border border-border rounded-xl p-4 text-sm text-muted-foreground text-center">
            Nenhum turno fechado neste período. Ajuste as datas acima.
          </div>
        )}

        {/* ───────── RESUMO ───────── */}
        {aba === "resumo" && !semDados && (
          <>
            <div className="grid grid-cols-2 gap-2">
              <Kpi label="Caixa total bruto" value={BRL(liq.bruto)} destaque />
              <Kpi label="Caixa total líquido" value={BRL(liq.liquido)} destaque cor="text-success"
                dica={`${liq.inclusoes > 0 ? `+ inclusões ${BRL(liq.inclusoes)} ` : ""}− taxas ${BRL(liq.taxasCartao)} − retiradas ${BRL(liq.retiradas)} − pagtos maq. ${BRL(liq.pagoMaq1 + liq.pagoMaq2)}`} />
              <Kpi label="Turnos fechados" value={String(tot.turnos)} dica={`média ${BRL(tot.media)}/turno`} />
              <Kpi label="Perdido em faltas" value={BRL(tot.perdas)} cor="text-destructive" dica={`a mais: ${BRL(tot.sobras)}`} />
            </div>
            {variacao != null && (
              <div className="text-xs text-muted-foreground bg-card border border-border rounded-lg p-2">
                Comparado ao período anterior (mesmo tamanho): arrecadado{" "}
                <span className={variacao >= 0 ? "text-success font-semibold" : "text-destructive font-semibold"}>
                  {variacao >= 0 ? "▲" : "▼"} {Math.abs(variacao).toFixed(1)}%
                </span>{" "}({BRL(anterior.bruto)} antes).
              </div>
            )}

            <Card titulo="Faturamento (até hoje)">
              <div className="grid grid-cols-2 gap-2">
                <Mini label="Hoje" value={BRL(janelas.hoje)} />
                <Mini label="Semana" value={BRL(janelas.semana)} />
                <Mini label="Mês" value={BRL(janelas.mes)} />
                <Mini label="Ano" value={BRL(janelas.ano)} />
              </div>
            </Card>

            <Card titulo="Arrecadado × esperado por dia">
              <Grafico altura={230}>
                <LineChart data={porDia} margin={{ top: 5, right: 8, left: -10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#88888833" />
                  <XAxis dataKey="dia" tick={{ fill: COR.cinza, fontSize: 10 }} />
                  <YAxis tick={{ fill: COR.cinza, fontSize: 10 }} tickFormatter={brlCurto} />
                  <Tooltip formatter={(v) => BRL(Number(v))} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line type="monotone" dataKey="Arrecadado" stroke={COR.verde} strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="Esperado" stroke={COR.azul} strokeWidth={2} strokeDasharray="4 3" dot={false} />
                </LineChart>
              </Grafico>
            </Card>

            <Card titulo="Por forma de pagamento">
              {liq.formas.length === 0 ? <Vazio /> : (
                <>
                  <Grafico altura={210}>
                    <PieChart>
                      <Pie data={liq.formas} dataKey="valor" nameKey="nome" innerRadius={45} outerRadius={80} paddingAngle={2}>
                        {liq.formas.map((_, i) => <Cell key={i} fill={PIZZA[i % PIZZA.length]} />)}
                      </Pie>
                      <Tooltip formatter={(v) => BRL(Number(v))} />
                    </PieChart>
                  </Grafico>
                  <div className="space-y-1 mt-1">
                    {liq.formas.map((f, i) => (
                      <div key={f.nome} className="flex justify-between text-xs">
                        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: PIZZA[i % PIZZA.length] }} />{f.nome}</span>
                        <span className="mono">{BRL(f.valor)} <span className="text-muted-foreground">({liq.bruto > 0 ? ((f.valor / liq.bruto) * 100).toFixed(0) : 0}%)</span></span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </Card>
          </>
        )}

        {/* ───────── FUNCIONÁRIOS ───────── */}
        {aba === "funcionarios" && !semDados && (
          <>
            <Card titulo="Vendas por funcionário (turnos que fechou)">
              <Grafico altura={Math.max(160, funcs.length * 40 + 40)}>
                <BarChart data={funcs.map((f) => ({ nome: f.nome, Vendas: f.vendas }))} layout="vertical" margin={{ top: 5, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#88888833" />
                  <XAxis type="number" tick={{ fill: COR.cinza, fontSize: 10 }} tickFormatter={brlCurto} />
                  <YAxis type="category" dataKey="nome" width={70} tick={{ fill: COR.cinza, fontSize: 11 }} />
                  <Tooltip formatter={(v) => BRL(Number(v))} />
                  <Bar dataKey="Vendas" fill={COR.verde} radius={[0, 4, 4, 0]} />
                </BarChart>
              </Grafico>
            </Card>

            <Card titulo="Diferença de caixa por funcionário">
              <p className="text-[11px] text-muted-foreground mb-1">Negativo = faltou dinheiro no caixa; positivo = sobrou.</p>
              <Grafico altura={Math.max(160, funcs.length * 40 + 40)}>
                <BarChart data={funcs.map((f) => ({ nome: f.nome, Saldo: Number(f.saldo.toFixed(2)) }))} layout="vertical" margin={{ top: 5, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#88888833" />
                  <XAxis type="number" tick={{ fill: COR.cinza, fontSize: 10 }} tickFormatter={brlCurto} />
                  <YAxis type="category" dataKey="nome" width={70} tick={{ fill: COR.cinza, fontSize: 11 }} />
                  <Tooltip formatter={(v) => BRL(Number(v))} />
                  <ReferenceLine x={0} stroke={COR.cinza} />
                  <Bar dataKey="Saldo" radius={[0, 4, 4, 0]}>
                    {funcs.map((f, i) => <Cell key={i} fill={f.saldo < 0 ? COR.vermelho : COR.verde} />)}
                  </Bar>
                </BarChart>
              </Grafico>
            </Card>

            <Card titulo="Comparar funcionários por turno">
              <Grafico altura={240}>
                <BarChart data={matriz.map((m) => ({ nome: m.nome, Manhã: m.por.manha.arrec, Tarde: m.por.tarde.arrec, Noite: m.por.noite.arrec }))} margin={{ top: 5, right: 8, left: -10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#88888833" />
                  <XAxis dataKey="nome" tick={{ fill: COR.cinza, fontSize: 10 }} />
                  <YAxis tick={{ fill: COR.cinza, fontSize: 10 }} tickFormatter={brlCurto} />
                  <Tooltip formatter={(v) => BRL(Number(v))} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="Manhã" fill={COR_TURNO.manha} radius={[3, 3, 0, 0]} />
                  <Bar dataKey="Tarde" fill={COR_TURNO.tarde} radius={[3, 3, 0, 0]} />
                  <Bar dataKey="Noite" fill={COR_TURNO.noite} radius={[3, 3, 0, 0]} />
                </BarChart>
              </Grafico>
            </Card>

            <Card titulo="Quadro por funcionário">
              <Tabela
                cab={["Funcionário", "Turnos", "Vendas", "Média", "Saldo"]}
                linhas={funcs.map((f) => [f.nome, String(f.turnos), BRL(f.vendas), BRL(f.media), <span key="s" className={f.saldo < -TOL ? "text-destructive" : "text-success"}>{BRL(f.saldo)}</span>])}
              />
            </Card>
          </>
        )}

        {/* ───────── TURNOS ───────── */}
        {aba === "turnos" && !semDados && (
          <>
            <Card titulo="Caixa por turno (total arrecadado)">
              <Grafico altura={210}>
                <BarChart data={tiposTurno.map((t) => ({ turno: nomeTurno(t.shift), Arrecadado: t.arrec, Média: t.media, key: t.shift }))} margin={{ top: 5, right: 8, left: -10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#88888833" />
                  <XAxis dataKey="turno" tick={{ fill: COR.cinza, fontSize: 11 }} />
                  <YAxis tick={{ fill: COR.cinza, fontSize: 10 }} tickFormatter={brlCurto} />
                  <Tooltip formatter={(v) => BRL(Number(v))} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="Arrecadado" radius={[4, 4, 0, 0]}>
                    {tiposTurno.map((t) => <Cell key={t.shift} fill={COR_TURNO[t.shift]} />)}
                  </Bar>
                  <Bar dataKey="Média" fill={COR.cinza} radius={[4, 4, 0, 0]} />
                </BarChart>
              </Grafico>
              <Tabela
                cab={["Turno", "Turnos", "Arrecadado", "Média", "Faltas"]}
                linhas={tiposTurno.map((t) => [nomeTurno(t.shift), String(t.turnos), BRL(t.arrec), BRL(t.media), BRL(t.perdas)])}
              />
            </Card>

            <Card titulo="Funcionário × turno (arrecadado e nº de turnos)">
              <Tabela
                cab={["Funcionário", "Manhã", "Tarde", "Noite"]}
                linhas={matriz.map((m) => [m.nome, ...TURNOS.map((t) => `${BRL(m.por[t].arrec)} (${m.por[t].n})`)])}
              />
            </Card>

            <Card titulo="Turnos do período">
              <Tabela
                cab={["Data", "Turno", "Func.", "Arrec.", "Dif."]}
                linhas={linhas.slice().reverse().slice(0, 40).map((l) => [
                  formatDateBR(l.t.date), nomeTurno(l.t.shift), l.nome, BRL(l.arrec),
                  <span key="d" className={l.diff < -TOL ? "text-destructive" : l.diff > TOL ? "text-warning" : "text-success"}>{BRL(l.diff)}</span>,
                ])}
              />
              {linhas.length > 40 && <p className="text-[11px] text-muted-foreground mt-1">Mostrando os 40 mais recentes — o PDF/CSV traz o período completo agrupado.</p>}
            </Card>
          </>
        )}

        {/* ───────── PERDAS ───────── */}
        {aba === "perdas" && !semDados && (
          <>
            <div className="grid grid-cols-2 gap-2">
              <Kpi label="Perdido em faltas" value={BRL(tot.perdas)} cor="text-destructive" destaque />
              <Kpi label="Sobras de caixa" value={BRL(tot.sobras)} cor="text-success" dica="a mais que o esperado" />
            </div>
            <div className="flex gap-1.5">
              {(["dia", "mes", "ano"] as ModoAgrupar[]).map((m) => (
                <button key={m} onClick={() => setModo(m)}
                  className={`px-3 h-8 rounded-full text-xs ${modo === m ? "bg-primary text-primary-foreground" : "bg-card border border-border text-muted-foreground"}`}>
                  Por {m === "dia" ? "dia" : m === "mes" ? "mês" : "ano"}
                </button>
              ))}
            </div>
            <Card titulo={`Quanto perdi com diferenças de caixa — por ${modo === "dia" ? "dia" : modo === "mes" ? "mês" : "ano"}`}>
              <Grafico altura={230}>
                <BarChart data={grupos.map((g) => ({ periodo: modo === "dia" ? rotuloPeriodo(g.key) : rotuloGrupo(g.key), Perdido: Number(g.perdas.toFixed(2)), "A mais": Number(g.sobras.toFixed(2)) }))} margin={{ top: 5, right: 8, left: -10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#88888833" />
                  <XAxis dataKey="periodo" tick={{ fill: COR.cinza, fontSize: 10 }} />
                  <YAxis tick={{ fill: COR.cinza, fontSize: 10 }} tickFormatter={brlCurto} />
                  <Tooltip formatter={(v) => BRL(Number(v))} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="Perdido" fill={COR.vermelho} radius={[3, 3, 0, 0]} />
                  <Bar dataKey="A mais" fill={COR.verde} radius={[3, 3, 0, 0]} />
                </BarChart>
              </Grafico>
              <Tabela
                cab={[modo === "dia" ? "Dia" : modo === "mes" ? "Mês" : "Ano", "Turnos", "Perdido", "A mais"]}
                linhas={grupos.slice().reverse().map((g) => [rotuloGrupo(g.key), String(g.turnos), <span key="p" className={g.perdas > 0 ? "text-destructive" : ""}>{BRL(g.perdas)}</span>, BRL(g.sobras)])}
              />
            </Card>
            <Card titulo="Perdas por funcionário">
              <Tabela
                cab={["Funcionário", "Turnos", "Perdido", "Saldo"]}
                linhas={funcs.slice().sort((a, b) => b.perdas - a.perdas).map((f) => [f.nome, String(f.turnos), BRL(f.perdas), BRL(f.saldo)])}
              />
            </Card>
          </>
        )}

        {/* ───────── SOBRAS ───────── */}
        {aba === "sobras" && !semDados && (
          <>
            <Card titulo="Comparativo de sobras por turno (unidades)">
              <Grafico altura={200}>
                <BarChart data={tiposTurno.map((t) => ({ turno: nomeTurno(t.shift), Sobra: t.sobraUn }))} margin={{ top: 5, right: 8, left: -10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#88888833" />
                  <XAxis dataKey="turno" tick={{ fill: COR.cinza, fontSize: 11 }} />
                  <YAxis tick={{ fill: COR.cinza, fontSize: 10 }} />
                  <Tooltip />
                  <Bar dataKey="Sobra" radius={[4, 4, 0, 0]}>
                    {tiposTurno.map((t) => <Cell key={t.shift} fill={COR_TURNO[t.shift]} />)}
                  </Bar>
                </BarChart>
              </Grafico>
              <Tabela
                cab={["Turno", "Turnos", "Sobra (un)", "Sobra (R$)"]}
                linhas={tiposTurno.map((t) => [nomeTurno(t.shift), String(t.turnos), String(t.sobraUn), BRL(t.sobraValor)])}
              />
              <p className="text-[11px] text-muted-foreground mt-1">Soma das sobras registradas ao fechar os turnos (sem casquinhas). Valor ao preço do turno.</p>
            </Card>
            <Card titulo="Produtos que mais sobram">
              {sobrasProd.length === 0 ? <Vazio /> : (
                <Grafico altura={Math.max(160, sobrasProd.length * 30 + 40)}>
                  <BarChart data={sobrasProd.map((p) => ({ nome: p.nome, Sobra: p.un }))} layout="vertical" margin={{ top: 5, right: 12, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#88888833" />
                    <XAxis type="number" tick={{ fill: COR.cinza, fontSize: 10 }} />
                    <YAxis type="category" dataKey="nome" width={95} tick={{ fill: COR.cinza, fontSize: 10 }} />
                    <Tooltip />
                    <Bar dataKey="Sobra" fill={COR.ambar} radius={[0, 4, 4, 0]} />
                  </BarChart>
                </Grafico>
              )}
            </Card>
          </>
        )}

        {/* ───────── CONSUMO ───────── */}
        {aba === "consumo" && (
          <>
            <Card titulo="Consumo por funcionário (valor descontado)">
              {consumo.length === 0 ? <Vazio texto="Nenhum consumo registrado no período." /> : (
                <>
                  <Grafico altura={Math.max(160, consumo.length * 40 + 40)}>
                    <BarChart data={consumo.map((c) => ({ nome: c.nome, Valor: Number(c.valor.toFixed(2)) }))} layout="vertical" margin={{ top: 5, right: 12, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#88888833" />
                      <XAxis type="number" tick={{ fill: COR.cinza, fontSize: 10 }} tickFormatter={brlCurto} />
                      <YAxis type="category" dataKey="nome" width={70} tick={{ fill: COR.cinza, fontSize: 11 }} />
                      <Tooltip formatter={(v) => BRL(Number(v))} />
                      <Bar dataKey="Valor" fill={COR.roxo} radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </Grafico>
                  <Tabela
                    cab={["Funcionário", "Registros", "Unidades", "Valor"]}
                    linhas={consumo.map((c) => [c.nome, String(c.registros), String(c.unidades), BRL(c.valor)])}
                  />
                  <div className="flex justify-between text-sm font-semibold border-t border-border pt-2 mt-2">
                    <span>Total do período</span>
                    <span className="mono text-primary">{BRL(consumo.reduce((s, c) => s + c.valor, 0))}</span>
                  </div>
                </>
              )}
            </Card>
          </>
        )}
      </div>
      <BottomNav />
    </Shell>
  );
}

const TOL = 0.5;

function Kpi({ label, value, dica, cor, destaque }: { label: string; value: string; dica?: string; cor?: string; destaque?: boolean }) {
  return (
    <div className={`bg-card border rounded-xl p-3 ${destaque ? "border-primary/40" : "border-border"}`}>
      <div className="text-[11px] text-muted-foreground uppercase tracking-wide">{label}</div>
      <div className={`mono text-lg font-semibold mt-1 ${cor ?? "text-primary"}`}>{value}</div>
      {dica && <div className="text-[10px] text-muted-foreground mt-0.5 leading-tight">{dica}</div>}
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-background border border-border/60 rounded-lg p-2">
      <div className="text-[10px] text-muted-foreground uppercase">{label}</div>
      <div className="mono text-sm font-semibold">{value}</div>
    </div>
  );
}

function Card({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="bg-card border border-border rounded-xl p-3">
      <h2 className="text-sm font-semibold mb-2">{titulo}</h2>
      {children}
    </div>
  );
}

function Grafico({ altura, children }: { altura: number; children: React.ReactElement }) {
  return (
    <div style={{ width: "100%", height: altura }}>
      <ResponsiveContainer width="100%" height="100%">{children}</ResponsiveContainer>
    </div>
  );
}

function Vazio({ texto = "Sem dados no período." }: { texto?: string }) {
  return <div className="text-xs text-muted-foreground">{texto}</div>;
}

function Tabela({ cab, linhas }: { cab: string[]; linhas: React.ReactNode[][] }) {
  return (
    <div className="overflow-x-auto mt-2">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-[10px] text-muted-foreground uppercase">
            {cab.map((c, i) => <th key={i} className={`pb-1 font-normal ${i > 0 ? "text-right" : ""}`}>{c}</th>)}
          </tr>
        </thead>
        <tbody>
          {linhas.map((l, i) => (
            <tr key={i} className="border-t border-border/50">
              {l.map((c, j) => <td key={j} className={`py-1 ${j > 0 ? "text-right mono" : ""}`}>{c}</td>)}
            </tr>
          ))}
          {linhas.length === 0 && <tr><td colSpan={cab.length} className="py-2 text-muted-foreground">Sem dados.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
