import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Shell, TopBar, BottomNav } from "@/components/Shell";
import { useStore, getAllProducts, type Turno, type ShiftKey, type ShiftItem } from "@/lib/store";
import { EXCLUIR_DO_TOTAL_PASTEL } from "@/lib/products";
import { formatDateBR, todayISO } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { DatePickerBR } from "@/components/ui/date-picker-br";
import { gerarRelatorioPdf, type PdfSection } from "@/lib/pdf";
import { useFiltro } from "@/lib/filtros";

export const Route = createFileRoute("/owner/sobras")({
  component: SobrasPage,
  head: () => ({ meta: [{ title: "Sobras — Barraca Terminal" }, { name: "description", content: "Relatório de sobras por período, para baixar em PDF." }] }),
});

function daysAgoISO(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

const PERIODOS: { key: ShiftKey; label: string }[] = [
  { key: "manha", label: "Manhã" },
  { key: "tarde", label: "Tarde" },
  { key: "noite", label: "Noite" },
];

function totalPasteis(turno: Turno, products: ReturnType<typeof getAllProducts>): number {
  return products
    .filter((p) => p.category === "pastel" && !EXCLUIR_DO_TOTAL_PASTEL.has(p.id))
    .reduce((s, p) => s + (turno.items[p.id]?.sobra ?? 0), 0);
}

function SobrasPage() {
  const { state } = useStore();
  const nav = useNavigate();
  const [from, setFrom] = useFiltro("sobras.from", daysAgoISO(7));
  const [to, setTo]     = useFiltro("sobras.to", todayISO());

  const products = useMemo(() => getAllProducts(state), [state]);

  const turnosNoPeriodo = useMemo(() => {
    return state.historico
      .filter((t) => t.date >= from && t.date <= to)
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [state.historico, from, to]);

  const baixarPdf = () => {
    const sections: PdfSection[] = [];
    for (const { key, label } of PERIODOS) {
      const turnos = turnosNoPeriodo.filter((t) => t.shift === key);
      for (const t of turnos) {
        const linhasPastel = products
          .filter((p) => p.category === "pastel")
          .map((p) => ({ p, item: t.items[p.id] }))
          .filter(({ item }) => item && item.sobra != null);
        const linhasOutros = products
          .filter((p) => p.category !== "pastel")
          .map((p) => ({ p, item: t.items[p.id] }))
          .filter(({ item }) => item && item.sobra != null);
        if (linhasPastel.length === 0 && linhasOutros.length === 0) continue;

        const fmtSobra = (p: (typeof products)[number], sobra: number) =>
          p.decimal ? sobra.toLocaleString("pt-BR") : String(sobra);

        const rows: string[][] = [];
        for (const { p, item } of linhasPastel) rows.push([p.name, fmtSobra(p, item!.sobra as number)]);
        if (linhasPastel.length > 0) {
          rows.push(["Total de pastéis", String(totalPasteis(t, products))]);
        }
        for (const { p, item } of linhasOutros) rows.push([p.name, fmtSobra(p, item!.sobra as number)]);

        sections.push({
          heading: `${label} · ${formatDateBR(t.date)} · ${t.employee}`,
          columns: ["Produto", "Sobra"],
          rows,
        });
      }
    }
    if (sections.length === 0) {
      alert("Nenhum dado de sobra no período selecionado.");
      return;
    }
    gerarRelatorioPdf({
      filename: `sobras-${from}-a-${to}.pdf`,
      title: "Relatório de sobras",
      subtitle: `${formatDateBR(from)} a ${formatDateBR(to)}`,
      sections,
    });
  };

  return (
    <Shell>
      <TopBar title="Sobras (PDF)" right={<button onClick={() => nav({ to: "/owner/historico" })} className="text-xs text-muted-foreground">Voltar</button>} />

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
          {turnosNoPeriodo.length} fechamento(s) no período, agrupados por manhã/tarde/noite.
        </p>
        <Button className="w-full" onClick={baixarPdf}>📄 Baixar PDF</Button>
      </div>

      <div className="p-3 space-y-5">
        {turnosNoPeriodo.length === 0 && (
          <div className="text-sm text-muted-foreground">Nenhum fechamento no período selecionado.</div>
        )}

        {PERIODOS.map(({ key, label }) => {
          const turnos = turnosNoPeriodo.filter((t) => t.shift === key);
          if (turnos.length === 0) return null;
          return (
            <div key={key} className="space-y-2">
              <h2 className="text-sm font-semibold text-primary">{label}</h2>
              <div className="space-y-3">
                {turnos.map((t) => (
                  <SobraTurnoCard key={t.id} turno={t} products={products} />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <BottomNav />
    </Shell>
  );
}

function SobraTurnoCard({ turno, products }: { turno: Turno; products: ReturnType<typeof getAllProducts> }) {
  const linhasPastel = products
    .filter((p) => p.category === "pastel")
    .map((p) => ({ p, item: turno.items[p.id] }))
    .filter(({ item }) => item && item.sobra != null);
  const linhasOutros = products
    .filter((p) => p.category !== "pastel")
    .map((p) => ({ p, item: turno.items[p.id] }))
    .filter(({ item }) => item && item.sobra != null);
  const total = totalPasteis(turno, products);

  const linha = (p: (typeof products)[number], item: ShiftItem) => (
    <tr key={p.id} className="border-t border-border/50">
      <td className="py-1">{p.name}</td>
      <td className="py-1 text-right mono">
        {p.decimal ? (item.sobra as number).toLocaleString("pt-BR") : item.sobra}
      </td>
    </tr>
  );

  return (
    <div className="bg-card border border-border rounded-xl p-3">
      <div className="text-sm font-semibold mb-2">
        {formatDateBR(turno.date)}{" "}
        <span className="text-muted-foreground font-normal">— {turno.employee}</span>
      </div>
      {linhasPastel.length === 0 && linhasOutros.length === 0 ? (
        <div className="text-xs text-muted-foreground">Sem dados de sobra registrados.</div>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] text-muted-foreground uppercase">
              <th className="pb-1 font-normal">Produto</th>
              <th className="pb-1 font-normal text-right">Sobra</th>
            </tr>
          </thead>
          <tbody>
            {linhasPastel.map(({ p, item }) => linha(p, item))}
            {linhasPastel.length > 0 && (
              <tr className="border-t border-border font-semibold">
                <td className="py-1">Total de pastéis</td>
                <td className="py-1 text-right mono text-primary">{total}</td>
              </tr>
            )}
            {linhasOutros.map(({ p, item }) => linha(p, item))}
          </tbody>
        </table>
      )}
    </div>
  );
}
