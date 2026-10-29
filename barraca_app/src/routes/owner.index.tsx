import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Shell, TopBar, BottomNav } from "@/components/Shell";
import { useStore, getAllProducts, esperadoTurno, arrecadadoTurno, statusTurno, vendeu, ordenarTurnos } from "@/lib/store";
import { BRL, formatDateBR, shiftLabel, todayISO } from "@/lib/format";
import { DatePickerBR } from "@/components/ui/date-picker-br";
import { Button } from "@/components/ui/button";
import { gerarRelatorioPdf } from "@/lib/pdf";
import { baixarCsv } from "@/lib/csv";
import { Link as RLink } from "@tanstack/react-router";
import { useFiltro } from "@/lib/filtros";
import { SemanaPicker } from "@/components/SemanaPicker";
import { inicioSemana, fimSemana, semanaPassada } from "@/lib/folha";

export const Route = createFileRoute("/owner/")({
  component: Dashboard,
  head: () => ({ meta: [{ title: "Painel — Barraca Terminal" }, { name: "description", content: "Painel do dono: métricas e turnos." }] }),
});

function Dashboard() {
  const { state } = useStore();
  const products = getAllProducts(state);
  const [from, setFrom] = useFiltro("painel.from", () => {
    const d = new Date(); d.setDate(d.getDate() - 7);
    return d.toISOString().slice(0, 10);
  });
  const [to, setTo] = useFiltro("painel.to", todayISO());
  // "semana": segunda a domingo (os pagamentos são semanais); "periodo": De/Até livres
  const [modo, setModo] = useFiltro<"semana" | "periodo">("painel.modo", "periodo");
  const irParaSemana = (segunda: string) => { setFrom(segunda); setTo(fimSemana(segunda)); };
  const escolherModo = (m: "semana" | "periodo") => {
    setModo(m);
    if (m === "semana" && !(from === inicioSemana(from) && to === fimSemana(from))) irParaSemana(semanaPassada());
  };

  const filtered = useMemo(() =>
    ordenarTurnos(state.historico.filter((t) => t.date >= from && t.date <= to)),
    [state.historico, from, to]);

  const totals = useMemo(() => {
    let arrec = 0, esp = 0, pasteis = 0;
    for (const t of filtered) {
      arrec += arrecadadoTurno(t);
      esp += esperadoTurno(t, products);
      for (const p of products) {
        if (p.category !== "pastel") continue;
        const it = t.items[p.id]; if (!it) continue;
        const v = vendeu(it); if (v) pasteis += v;
      }
    }
    return { arrec, esp, pasteis, avg: filtered.length ? arrec / filtered.length : 0 };
  }, [filtered, products]);

  const topPasteis = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const t of filtered) {
      for (const p of products) {
        if (p.category !== "pastel") continue;
        const it = t.items[p.id]; if (!it) continue;
        const v = vendeu(it); if (v) counts[p.id] = (counts[p.id] || 0) + v;
      }
    }
    return Object.entries(counts)
      .map(([id, n]) => ({ p: products.find((x) => x.id === id)!, n }))
      .sort((a, b) => b.n - a.n).slice(0, 8);
  }, [filtered, products]);

  const baixarPdf = () => {
    if (filtered.length === 0) { alert("Nenhum turno no período selecionado."); return; }
    gerarRelatorioPdf({
      filename: `painel-${from}-a-${to}.pdf`,
      title: "Painel — turnos do período",
      subtitle: `${formatDateBR(from)} a ${formatDateBR(to)}`,
      sections: [{
        columns: ["Data", "Turno", "Funcionário", "Status", "Arrecadado", "Esperado", "Diferença"],
        rows: filtered.map((t) => [
          formatDateBR(t.date), shiftLabel(t.shift), t.employee,
          statusTurno(t, products) === "ok" ? "OK" : "Falta",
          `R$ ${arrecadadoTurno(t).toFixed(2)}`, `R$ ${esperadoTurno(t, products).toFixed(2)}`,
          `R$ ${(arrecadadoTurno(t) - esperadoTurno(t, products)).toFixed(2)}`,
        ]),
        totalRow: ["", "", "", "Total", `R$ ${totals.arrec.toFixed(2)}`, `R$ ${totals.esp.toFixed(2)}`, `R$ ${(totals.arrec - totals.esp).toFixed(2)}`],
      }],
    });
  };

  const baixarCsvArquivo = () => {
    if (filtered.length === 0) { alert("Nenhum turno no período selecionado."); return; }
    baixarCsv(
      `painel-${from}-a-${to}.csv`,
      ["Data", "Turno", "Funcionário", "Status", "Arrecadado", "Esperado", "Diferença"],
      filtered.map((t) => [
        formatDateBR(t.date), shiftLabel(t.shift), t.employee,
        statusTurno(t, products) === "ok" ? "OK" : "Falta",
        arrecadadoTurno(t).toFixed(2), esperadoTurno(t, products).toFixed(2),
        (arrecadadoTurno(t) - esperadoTurno(t, products)).toFixed(2),
      ]),
    );
  };

  return (
    <Shell>
      <TopBar title="Painel · Dono"
        right={
          <div className="flex items-center gap-2.5 flex-wrap justify-end">
            <Link to="/owner/gestao" className="text-xs text-primary">📈 Gestão</Link>
            <Link to="/owner/produtos" search={{ tab: "consumo" }} className="text-xs text-primary">👥 Consumo</Link>
            <Link to="/owner/pagamentos" className="text-xs text-primary">💳 Pagamentos</Link>
            <Link to="/owner/caixa-diario" className="text-xs text-primary">💰 Caixa diário</Link>
            <Link to="/owner/historico" className="text-xs text-primary">Ver tudo →</Link>
          </div>
        } />
      <div className="p-3 space-y-3">
        <div className="bg-card border border-border rounded-xl p-3 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            {([["periodo", "📅 De / Até"], ["semana", "🗓️ Por semana (seg a dom)"]] as const).map(([m, rotulo]) => (
              <button key={m} type="button" onClick={() => escolherModo(m)}
                className={`h-9 rounded-md text-xs border ${modo === m ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-muted-foreground"}`}>
                {rotulo}
              </button>
            ))}
          </div>
          {modo === "semana" ? (
            <SemanaPicker inicio={inicioSemana(from)} onChange={irParaSemana} />
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-muted-foreground">De</label>
                <div className="mt-1">
                  <DatePickerBR value={from} onChange={setFrom} />
                </div>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Até</label>
                <div className="mt-1">
                  <DatePickerBR value={to} onChange={setTo} />
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Button variant="secondary" onClick={baixarPdf}>📄 PDF</Button>
          <Button variant="secondary" onClick={baixarCsvArquivo}>📊 CSV</Button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Metric label="Arrecadado" value={BRL(totals.arrec)} />
          <Metric label="Turnos" value={String(filtered.length)} />
          <Metric label="Pastéis" value={String(totals.pasteis)} />
          <Metric label="Média/turno" value={BRL(totals.avg)} />
        </div>

        <RLink to="/ponto" className="hidden" />

        <div className="bg-card border border-border rounded-xl p-3">
          <h2 className="text-sm font-semibold mb-2">Top 8 pastéis</h2>
          {topPasteis.length === 0 ? (
            <div className="text-xs text-muted-foreground">Sem dados no período.</div>
          ) : (
            <ol className="space-y-1">
              {topPasteis.map((r, i) => (
                <li key={r.p.id} className="flex justify-between text-sm">
                  <span><span className="text-muted-foreground mono w-6 inline-block">{i + 1}.</span>{r.p.name}</span>
                  <span className="mono font-semibold text-primary">{r.n}</span>
                </li>
              ))}
            </ol>
          )}
        </div>

        <div>
          <h2 className="text-sm font-semibold mb-2">Turnos recentes</h2>
          <div className="space-y-2">
            {filtered.slice(0, 10).map((t) => {
              const arrec = arrecadadoTurno(t);
              const diff = arrec - esperadoTurno(t, products);
              const status = statusTurno(t, products);
              return (
                <div key={t.id} className="bg-card border border-border rounded-lg p-3 flex items-center justify-between">
                  <div>
                    <div className="text-sm">{formatDateBR(t.date)} · {shiftLabel(t.shift)}</div>
                    <div className="text-xs text-muted-foreground mono">{t.employee} · {BRL(arrec)}</div>
                    <div className="text-xs mono">
                      <span className="text-muted-foreground">Diferença: </span>
                      <span className={`font-semibold ${Math.abs(diff) < 0.5 ? "text-success" : diff > 0 ? "text-warning" : "text-destructive"}`}>
                        {diff > 0.005 ? "+" : ""}{BRL(diff)}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${status === "ok" ? "bg-success/20 text-success" : "bg-destructive/20 text-destructive"}`}>
                      {status === "ok" ? "OK" : "Falta"}
                    </span>
                    {t.editado && <span className="text-[10px] text-muted-foreground">editado</span>}
                    <Link to="/owner/turno/$id" params={{ id: t.id }} className="text-muted-foreground hover:text-primary">✏️</Link>
                  </div>
                </div>
              );
            })}
            {filtered.length === 0 && <div className="text-xs text-muted-foreground">Nenhum turno no período.</div>}
          </div>
        </div>
      </div>
      <BottomNav />
    </Shell>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-card border border-border rounded-xl p-3">
      <div className="text-[11px] text-muted-foreground uppercase tracking-wide">{label}</div>
      <div className="mono text-lg font-semibold mt-1 text-primary">{value}</div>
    </div>
  );
}
