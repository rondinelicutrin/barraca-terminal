import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Shell, TopBar, BottomNav } from "@/components/Shell";
import { useStore, getAllProducts, esperadoTurno, arrecadadoTurno, realMaq, nomeMaquina } from "@/lib/store";
import { BRL, formatDateBR, todayISO } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { DatePickerBR } from "@/components/ui/date-picker-br";
import { baixarExcel } from "@/lib/excel";
import { gerarRelatorioPdf } from "@/lib/pdf";
import { baixarCsv } from "@/lib/csv";
import { useFiltro } from "@/lib/filtros";

export const Route = createFileRoute("/owner/caixa-diario")({
  component: CaixaDiario,
  head: () => ({ meta: [{ title: "Caixa final diário — Barraca Terminal" }, { name: "description", content: "Resumo do caixa somando todos os turnos de cada dia." }] }),
});

function daysAgoISO(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

interface LinhaDia {
  date: string;
  malote: number;
  pix: number;
  maq1: number;
  maq2: number;
  esperado: number;
  arrecadado: number;
  turnos: number;
}

function CaixaDiario() {
  const { state } = useStore();
  const nomeM1 = nomeMaquina(state.taxasMaquininha, "maq1");
  const nomeM2 = nomeMaquina(state.taxasMaquininha, "maq2");
  const nav = useNavigate();
  const products = getAllProducts(state);
  const [from, setFrom] = useFiltro("caixa.from", daysAgoISO(7));
  const [to, setTo] = useFiltro("caixa.to", todayISO());

  const linhas = useMemo<LinhaDia[]>(() => {
    const porDia = new Map<string, LinhaDia>();
    for (const t of state.historico) {
      if (t.date < from || t.date > to) continue;
      const cur = porDia.get(t.date) ?? {
        date: t.date, malote: 0, pix: 0, maq1: 0, maq2: 0, esperado: 0, arrecadado: 0, turnos: 0,
      };
      cur.malote += t.caixa.dinheiroMalote || 0;
      cur.pix += t.caixa.pix || 0;
      cur.maq1 += realMaq(t.caixa.maq1, t.shift);
      cur.maq2 += t.caixa.maq2Ativa ? realMaq(t.caixa.maq2, t.shift) : 0;
      cur.esperado += esperadoTurno(t, products);
      cur.arrecadado += arrecadadoTurno(t);
      cur.turnos += 1;
      porDia.set(t.date, cur);
    }
    return Array.from(porDia.values()).sort((a, b) => a.date.localeCompare(b.date));
  }, [state.historico, from, to, products]);

  const totalGeral = useMemo(() => linhas.reduce((s, l) => ({
    malote: s.malote + l.malote,
    pix: s.pix + l.pix,
    maq1: s.maq1 + l.maq1,
    maq2: s.maq2 + l.maq2,
    esperado: s.esperado + l.esperado,
    arrecadado: s.arrecadado + l.arrecadado,
  }), { malote: 0, pix: 0, maq1: 0, maq2: 0, esperado: 0, arrecadado: 0 }), [linhas]);

  const baixar = () => {
    if (linhas.length === 0) { alert("Nenhum turno fechado no período selecionado."); return; }
    const rows = linhas.map((l) => ({
      Data: formatDateBR(l.date),
      "Turnos fechados": l.turnos,
      "Dinheiro Malote (R$)": Number(l.malote.toFixed(2)),
      "Pix manual (R$)": Number(l.pix.toFixed(2)),
      [`${nomeM1} (R$)`]: Number(l.maq1.toFixed(2)),
      [`${nomeM2} (R$)`]: Number(l.maq2.toFixed(2)),
      "Esperado (R$)": Number(l.esperado.toFixed(2)),
      "Arrecadado (R$)": Number(l.arrecadado.toFixed(2)),
    }));
    rows.push({
      Data: "TOTAL",
      "Turnos fechados": linhas.reduce((s, l) => s + l.turnos, 0),
      "Dinheiro Malote (R$)": Number(totalGeral.malote.toFixed(2)),
      "Pix manual (R$)": Number(totalGeral.pix.toFixed(2)),
      [`${nomeM1} (R$)`]: Number(totalGeral.maq1.toFixed(2)),
      [`${nomeM2} (R$)`]: Number(totalGeral.maq2.toFixed(2)),
      "Esperado (R$)": Number(totalGeral.esperado.toFixed(2)),
      "Arrecadado (R$)": Number(totalGeral.arrecadado.toFixed(2)),
    });
    baixarExcel(`caixa-final-diario-${from}-a-${to}.xlsx`, [{ name: "Caixa diário", rows }]);
  };

  const baixarPdf = () => {
    if (linhas.length === 0) { alert("Nenhum turno fechado no período selecionado."); return; }
    gerarRelatorioPdf({
      filename: `caixa-final-diario-${from}-a-${to}.pdf`,
      title: "Caixa final diário",
      subtitle: `${formatDateBR(from)} a ${formatDateBR(to)}`,
      sections: [{
        columns: ["Data", "Turnos", "Malote", "Pix", nomeM1, nomeM2, "Esperado", "Arrecadado"],
        rows: linhas.map((l) => [
          formatDateBR(l.date), String(l.turnos),
          `R$${l.malote.toFixed(2)}`, `R$${l.pix.toFixed(2)}`, `R$${l.maq1.toFixed(2)}`, `R$${l.maq2.toFixed(2)}`,
          `R$${l.esperado.toFixed(2)}`, `R$${l.arrecadado.toFixed(2)}`,
        ]),
        totalRow: [
          "TOTAL", String(linhas.reduce((s, l) => s + l.turnos, 0)),
          `R$${totalGeral.malote.toFixed(2)}`, `R$${totalGeral.pix.toFixed(2)}`, `R$${totalGeral.maq1.toFixed(2)}`,
          `R$${totalGeral.maq2.toFixed(2)}`, `R$${totalGeral.esperado.toFixed(2)}`, `R$${totalGeral.arrecadado.toFixed(2)}`,
        ],
      }],
    });
  };

  const baixarCsvArquivo = () => {
    if (linhas.length === 0) { alert("Nenhum turno fechado no período selecionado."); return; }
    const rows: (string | number)[][] = linhas.map((l) => [
      formatDateBR(l.date), l.turnos, l.malote.toFixed(2), l.pix.toFixed(2), l.maq1.toFixed(2), l.maq2.toFixed(2),
      l.esperado.toFixed(2), l.arrecadado.toFixed(2),
    ]);
    rows.push([
      "TOTAL", linhas.reduce((s, l) => s + l.turnos, 0), totalGeral.malote.toFixed(2), totalGeral.pix.toFixed(2),
      totalGeral.maq1.toFixed(2), totalGeral.maq2.toFixed(2), totalGeral.esperado.toFixed(2), totalGeral.arrecadado.toFixed(2),
    ]);
    baixarCsv(
      `caixa-final-diario-${from}-a-${to}.csv`,
      ["Data", "Turnos", "Malote (R$)", "Pix (R$)", `${nomeM1} (R$)`, `${nomeM2} (R$)`, "Esperado (R$)", "Arrecadado (R$)"],
      rows,
    );
  };

  return (
    <Shell>
      <TopBar title="Caixa final diário" right={<button onClick={() => nav({ to: "/owner" })} className="text-xs text-muted-foreground">Voltar</button>} />
      <div className="p-3 space-y-3">
        <div className="bg-card border border-border rounded-xl p-3 grid grid-cols-2 gap-2">
          <div>
            <label className="text-xs text-muted-foreground">De</label>
            <div className="mt-1"><DatePickerBR value={from} onChange={setFrom} /></div>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Até</label>
            <div className="mt-1"><DatePickerBR value={to} onChange={setTo} /></div>
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Soma manhã + tarde + noite de cada dia: dinheiro malote, pix manual, maquininha 1, maquininha 2, esperado
          e arrecadado — para você ter a visão do dia inteiro de trabalho.
        </p>
        <Button className="w-full" onClick={baixar}>📊 Baixar Excel (.xlsx)</Button>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="secondary" onClick={baixarPdf}>📄 PDF (imprimir)</Button>
          <Button variant="secondary" onClick={baixarCsvArquivo}>📊 CSV</Button>
        </div>
      </div>

      <div className="p-3 space-y-2">
        {linhas.length === 0 && <div className="text-sm text-muted-foreground">Nenhum turno fechado no período selecionado.</div>}
        {linhas.map((l) => {
          const diff = l.arrecadado - l.esperado;
          return (
            <div key={l.date} className="bg-card border border-border rounded-lg p-3">
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium">{formatDateBR(l.date)}</div>
                <div className="text-xs text-muted-foreground">{l.turnos} turno(s)</div>
              </div>
              <div className="text-xs text-muted-foreground mono mt-1 grid grid-cols-2 gap-x-2 gap-y-0.5">
                <span>Malote: {BRL(l.malote)}</span>
                <span>Pix: {BRL(l.pix)}</span>
                <span>{nomeM1}: {BRL(l.maq1)}</span>
                <span>{nomeM2}: {BRL(l.maq2)}</span>
                <span>Esperado: {BRL(l.esperado)}</span>
                <span>Arrecadado: {BRL(l.arrecadado)}</span>
              </div>
              <div className={`text-xs mono mt-1 font-medium ${Math.abs(diff) < 0.5 ? "text-success" : diff > 0 ? "text-warning" : "text-destructive"}`}>
                Diferença do dia: {BRL(diff)}
              </div>
            </div>
          );
        })}
        {linhas.length > 0 && (
          <div className="bg-card border border-primary/40 rounded-lg p-3 mt-2">
            <div className="text-sm font-semibold mb-1">Total do período</div>
            <div className="text-xs text-muted-foreground mono grid grid-cols-2 gap-x-2 gap-y-0.5">
              <span>Malote: {BRL(totalGeral.malote)}</span>
              <span>Pix: {BRL(totalGeral.pix)}</span>
              <span>{nomeM1}: {BRL(totalGeral.maq1)}</span>
              <span>{nomeM2}: {BRL(totalGeral.maq2)}</span>
              <span>Esperado: {BRL(totalGeral.esperado)}</span>
              <span className="text-primary font-semibold">Arrecadado: {BRL(totalGeral.arrecadado)}</span>
            </div>
          </div>
        )}
      </div>
      <BottomNav />
    </Shell>
  );
}
