import { createFileRoute, Link } from "@tanstack/react-router";
import { Shell, TopBar, BottomNav } from "@/components/Shell";
import { useStore, getAllProducts, esperadoTurno, arrecadadoTurno, statusTurno, ordenarTurnos } from "@/lib/store";
import { BRL, formatDateBR, shiftLabel } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { gerarRelatorioPdf } from "@/lib/pdf";
import { baixarCsv } from "@/lib/csv";

export const Route = createFileRoute("/owner/historico")({
  component: Historico,
  head: () => ({ meta: [{ title: "Histórico — Barraca Terminal" }, { name: "description", content: "Todos os turnos fechados." }] }),
});

function Historico() {
  const { state, dispatch } = useStore();
  const products = getAllProducts(state);
  const ordenados = ordenarTurnos(state.historico);

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
          const arrec = arrecadadoTurno(t);
          const esp = esperadoTurno(t, products);
          const status = statusTurno(t, products);
          const diff = arrec - esp;
          const consumoTotal = Object.values(t.items).reduce((s, it) => s + (it.consumo || 0), 0);
          return (
            <div key={t.id} className="bg-card border border-border rounded-lg p-3">
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
          );
        })}
      </div>
      <BottomNav />
    </Shell>
  );
}
