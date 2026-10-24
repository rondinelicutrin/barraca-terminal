import { useEffect, useState, useSyncExternalStore } from "react";
import { assinarFila, estadoFila, processar, limparRecusados } from "@/lib/fila";

// Faixa no topo de todas as telas: mostra se há lançamentos guardados no aparelho esperando a internet
// (eles são enviados sozinhos quando a conexão volta) ou se o servidor recusou algum.
export function AvisoEnvio() {
  const e = useSyncExternalStore(assinarFila, estadoFila, estadoFila);
  const [mostrarOk, setMostrarOk] = useState(false);
  useEffect(() => {
    if (!e.ultimoEnvioOk) return;
    setMostrarOk(true);
    const t = setTimeout(() => setMostrarOk(false), 4000);
    return () => clearTimeout(t);
  }, [e.ultimoEnvioOk]);

  if (e.recusados.length > 0) {
    return (
      <div role="alert" className="px-4 py-2 text-xs bg-destructive/15 text-destructive border-b border-destructive/40 flex items-center gap-2">
        <span className="flex-1">❌ {e.recusados.length} lançamento(s) recusado(s) pelo servidor. Avise o administrador.</span>
        <button type="button" className="underline min-h-9 px-1" onClick={() => {
          alert(e.recusados.map((r) => `• ${new Date(r.quando).toLocaleString("pt-BR")} (${r.tipo}): ${r.erro}`).join("\n"));
          limparRecusados();
        }}>Ver</button>
      </div>
    );
  }
  if (e.pendentes > 0) {
    return (
      <div role="status" className="px-4 py-2 text-xs bg-warning/15 text-warning border-b border-warning/40 flex items-center gap-2">
        <span className="flex-1">
          ⚠️ {e.pendentes} lançamento(s) guardado(s) neste aparelho, aguardando internet. Serão enviados sozinhos —
          não apague os dados do navegador.
        </span>
        <button type="button" className="underline min-h-9 px-1 shrink-0" disabled={e.enviando} onClick={() => void processar()}>
          {e.enviando ? "Enviando..." : "Tentar agora"}
        </button>
      </div>
    );
  }
  if (!e.online) {
    return (
      <div role="status" className="px-4 py-2 text-xs bg-muted text-muted-foreground border-b border-border">
        📵 Sem internet. Pode continuar lançando: fica guardado no aparelho e é enviado quando a conexão voltar.
      </div>
    );
  }
  if (mostrarOk) {
    return (
      <div role="status" className="px-4 py-1.5 text-xs bg-success/15 text-success border-b border-success/40">
        ✓ Tudo enviado para o servidor.
      </div>
    );
  }
  return null;
}
