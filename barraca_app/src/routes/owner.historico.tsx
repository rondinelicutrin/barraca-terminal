import { createFileRoute, Link } from "@tanstack/react-router";
import { Fragment, useMemo } from "react";
import { Shell, TopBar, BottomNav } from "@/components/Shell";
import { useStore, getAllProducts, esperadoTurno, arrecadadoTurno, statusTurno, ordenarTurnos, veResultadoCaixa } from "@/lib/store";
import { BRL, formatDateBR, shiftLabel } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { gerarRelatorioPdf } from "@/lib/pdf";
import { baixarCsv } from "@/lib/csv";
import { paresCompensados, resumoPerdaReal, periodosPerdaReal } from "@/lib/perda-real";

export const Route = createFileRoute("/owner/historico")({
  component: Historico,
  head: () => ({ meta: [{ title: "Histórico — Barraca Terminal" }, { name: "description", content: "Todos os turnos fechados." }] }),
});

function Historico() {
  const { state, dispatch } = useStore();
  const products = getAllProducts(state);
  const ordenados = ordenarTurnos(state.historico);
  // Perda real (só dono/administrador): pares de turnos que se compensam e o total real por período
  const veReal = veResultadoCaixa(state.currentUser);
  const { parDe } = useMemo(() => paresCompensados(state.historico, products), [state.historico, products]);
  const resumos = useMemo(() => periodosPerdaReal().map((p) => ({ ...p, ...resumoPerdaReal(state.historico, products, p.de, p.ate) })),
    [state.historico, products]);
  const PER: Record<string, string> = { manha: "Manhã", tarde: "Tarde", noite: "Noite" };
  const rot = (t: { date: string; shift: string }) => `${formatDateBR(t.date).slice(0, 5)} ${PER[t.shift] ?? t.shift}`;
  const sinal = (v: number) => `${v > 0.005 ? "+" : ""}${BRL(v)}`;
  const cor = (v: number) => (Math.abs(v) < 0.5 ? "text-success" : v > 0 ? "text-warning" : "text-destructive");

  const excluirTurno = (id: string, rotulo: string, emAndamento: boolean) => {
    const ok = confirm(
      `EXCLUIR ${emAndamento ? "O TURNO EM ANDAMENTO" : "O FECHAMENTO"} ${rotulo}?\n\n` +
      `O funcionário poderá abrir o turno de novo e refazer. Os dados lançados nele (produtos, caixa) serão apagados` +
      `${emAndamento ? "" : ", e o estoque volta ao que era na abertura dele (se for o mais recente)"}.\n\n` +
      `OS PONTOS E CONSUMOS JÁ REGISTRADOS NO MENU PONTO NÃO SÃO APAGADOS.\n\nEsta ação não pode ser desfeita.`
    );
    if (ok) dispatch({ type: "DELETE_TURNO", id });
  };

  const baixarPdf = () => {
    if (state.historico.length === 0) { alert("Nenhum turno no histórico."); return; }
    gerarRelatorioPdf({
      filename: `historico-turnos.pdf`,
      title: "Histórico de turnos",
      sections: [{
        columns: ["Data", "Turno", "Funcionário", "Status", "Arrecadado", "Esperado", "Diferença", "Consumo"],
        rows: ordenados.map((t) => [
          formatDateBR(t.date), shiftLabel(t.shift), t.employee,
          statusTurno(t, products) === "ok" ? "OK" : "Falta",
          `R$ ${arrecadadoTurno(t).toFixed(2)}`, `R$ ${esperadoTurno(t, products).toFixed(2)}`,
          `R$ ${(arrecadadoTurno(t) - esperadoTurno(t, products)).toFixed(2)}`,
          String(Object.values(t.items).reduce((s, it) => s + (it.consumo || 0), 0)),
        ]),
      }],
    });
  };

  const baixarCsvArquivo = () => {
    if (state.historico.length === 0) { alert("Nenhum turno no histórico."); return; }
    baixarCsv(
      `historico-turnos.csv`,
      ["Data", "Turno", "Funcionário", "Status", "Arrecadado", "Esperado", "Diferença", "Consumo"],
      ordenados.map((t) => [
        formatDateBR(t.date), shiftLabel(t.shift), t.employee,
        statusTurno(t, products) === "ok" ? "OK" : "Falta",
        arrecadadoTurno(t).toFixed(2), esperadoTurno(t, products).toFixed(2),
        (arrecadadoTurno(t) - esperadoTurno(t, products)).toFixed(2),
        Object.values(t.items).reduce((s, it) => s + (it.consumo || 0), 0),
      ]),
    );
  };

  return (
    <Shell>
      <TopBar
        title="Histórico"
        right={
          <div className="flex items-center gap-3">
            <Link to="/owner/produtos" search={{ tab: "consumo" }} className="text-xs text-primary">👥 Consumo</Link>
            <Link to="/owner/sobras" className="text-xs text-primary">📄 Sobras</Link>
          </div>
        }
      />
      <div className="p-3 grid grid-cols-2 gap-2">
        <Button variant="secondary" onClick={baixarPdf}>📄 PDF</Button>
        <Button variant="secondary" onClick={baixarCsvArquivo}>📊 CSV</Button>
      </div>
      <div className="p-3 pt-0 space-y-2">
        {veReal && state.historico.length > 0 && (
          <div className="bg-card border border-primary/40 rounded-lg p-3 space-y-1.5" id="perda-real">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-semibold">🔎 Perda real</div>
              <span className="text-[10px] text-muted-foreground border border-border rounded-full px-2">só dono/adm</span>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Soma das diferenças dos turnos: os erros de contagem na troca de turno (sobra em um, falta no seguinte) se anulam
              e fica só o que você realmente ganhou ou perdeu.
            </p>
            {resumos.map((r) => (
              <div key={r.rotulo} className="flex items-baseline justify-between gap-2 text-xs">
                <span>{r.rotulo} <span className="text-muted-foreground">({r.turnos} turnos · sobras {BRL(r.sobras)} · faltas {BRL(-r.faltas)})</span></span>
                <span className={`mono font-semibold text-sm shrink-0 ${cor(r.real)}`}>{sinal(r.real)}</span>
              </div>
            ))}
          </div>
        )}
        {state.turnoAtivo && (
          <div className="bg-card border border-primary/40 rounded-lg p-3">
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium">
                🟢 {formatDateBR(state.turnoAtivo.date)} · {shiftLabel(state.turnoAtivo.shift)}
              </div>
              <div className="flex gap-2 items-center">
                <span className="text-xs px-2 py-0.5 rounded-full bg-primary/20 text-primary">Em andamento</span>
                <Link to="/owner/turno/$id" params={{ id: state.turnoAtivo.id }} className="inline-flex shrink-0 items-center justify-center h-9 w-9 text-muted-foreground hover:text-primary text-sm">✏️</Link>
                <button
                  type="button"
                  title="Excluir turno"
                  aria-label="Excluir turno em andamento"
                  onClick={() => excluirTurno(state.turnoAtivo!.id, `${formatDateBR(state.turnoAtivo!.date)} · ${shiftLabel(state.turnoAtivo!.shift)}`, true)}
                  className="inline-flex shrink-0 items-center justify-center h-9 w-9 text-muted-foreground hover:text-destructive text-sm">🗑</button>
              </div>
            </div>
            <div className="text-xs text-muted-foreground mono mt-1">{state.turnoAtivo.employee}</div>
          </div>
        )}
        {state.historico.length === 0 && !state.turnoAtivo && <div className="text-sm text-muted-foreground">Nenhum turno fechado ainda.</div>}
        {ordenados.map((t) => {
          const par = veReal ? parDe.get(t.id) : undefined;
          const arrec = arrecadadoTurno(t);
          const esp = esperadoTurno(t, products);
          const status = statusTurno(t, products);
          const diff = arrec - esp;
          const consumoTotal = Object.values(t.items).reduce((s, it) => s + (it.consumo || 0), 0);
          return (
            <Fragment key={t.id}>
            <div className="bg-card border border-border rounded-lg p-3">
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium">{formatDateBR(t.date)} · {shiftLabel(t.shift)}</div>
                <div className="flex gap-2 items-center">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${status === "ok" ? "bg-success/20 text-success" : "bg-destructive/20 text-destructive"}`}>
                    {status === "ok" ? "OK" : "Falta"}
                  </span>
                  {t.editado && <span className="text-[10px] text-muted-foreground">editado</span>}
                  <Link to="/owner/turno/$id" params={{ id: t.id }} className="inline-flex shrink-0 items-center justify-center h-9 w-9 text-muted-foreground hover:text-primary text-sm">✏️</Link>
                  <button
                    type="button"
                    title="Excluir fechamento"
                    aria-label="Excluir fechamento"
                    onClick={() => excluirTurno(t.id, `${formatDateBR(t.date)} · ${shiftLabel(t.shift)}`, false)}
                    className="inline-flex shrink-0 items-center justify-center h-9 w-9 text-muted-foreground hover:text-destructive text-sm">🗑</button>
                </div>
              </div>
              <div className="text-xs text-muted-foreground mono mt-1">
                {t.employee} · Arr {BRL(arrec)} · Esp {BRL(esp)} · Cons {consumoTotal}
              </div>
              <div className="text-xs mono mt-0.5">
                <span className="text-muted-foreground">Diferença: </span>
                <span className={`font-semibold ${Math.abs(diff) < 0.5 ? "text-success" : diff > 0 ? "text-warning" : "text-destructive"}`}>
                  {diff > 0.005 ? "+" : ""}{BRL(diff)}
                </span>
                <span className="text-muted-foreground">{Math.abs(diff) < 0.5 ? " · conferido" : diff > 0 ? " · sobrou" : " · faltou"}</span>
              </div>
            </div>
            {/* Lista do mais novo para o mais antigo: o quadro do par fica entre os dois turnos */}
            {par && par.depois.id === t.id && (
              <div className="bg-warning/10 border border-warning/40 rounded-lg p-2.5 space-y-0.5 text-xs">
                <div className="font-semibold text-warning">🔎 Provável erro de contagem entre {rot(par.antes)} e {rot(par.depois)}</div>
                <div className="flex justify-between gap-2"><span>{rot(par.antes)} + {rot(par.depois)}</span><span className="mono whitespace-nowrap">{sinal(par.difAntes)} {par.difDepois < 0 ? "−" : "+"} {BRL(Math.abs(par.difDepois))}</span></div>
                <div className="flex justify-between gap-2 font-semibold"><span>Perda real dos dois turnos</span><span className={`mono whitespace-nowrap ${cor(par.real)}`}>{sinal(par.real)}</span></div>
                <div className="text-[10px] text-muted-foreground">🔒 Visível só para dono e administrador</div>
              </div>
            )}
            </Fragment>
          );
        })}
      </div>
      <BottomNav />
    </Shell>
  );
}
