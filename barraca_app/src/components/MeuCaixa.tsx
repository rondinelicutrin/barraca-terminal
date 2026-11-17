import { useNavigate } from "@tanstack/react-router";
import { useStore } from "@/lib/store";
import { meuCaixa, INICIO_MEU_CAIXA } from "@/lib/gestao";
import { BRL, formatDateBR } from "@/lib/format";

const PERIODO_NOME: Record<string, string> = { manha: "Manhã", tarde: "Tarde", noite: "Noite" };

// Dinheiro físico do dono: tudo o que veio nos malotes (desde 26/10/2026) + inclusões − retiradas de dinheiro.
// Atualiza na hora a cada retirada/inclusão lançada em Pagamentos e a cada turno fechado.
export function MeuCaixa({ comAtalho = true }: { comAtalho?: boolean }) {
  const { state } = useStore();
  const nav = useNavigate();
  const c = meuCaixa(state);
  return (
    <div className="bg-card border border-primary/40 rounded-xl p-3 space-y-1.5 text-xs" id="meu-caixa">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">💵 Meu caixa (dinheiro físico)</h2>
        <span className="mono text-lg font-bold text-primary">{BRL(c.saldo)}</span>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Dinheiro que veio nos malotes desde {formatDateBR(INICIO_MEU_CAIXA)} (o valor conferido no saco, quando conferido),
        mais as inclusões e menos as retiradas de dinheiro lançadas em Pagamentos.
      </p>
      <div className="flex justify-between gap-2"><span>Malotes recebidos ({c.turnos} turnos fechados)</span><span className="mono">{BRL(c.malotes)}</span></div>
      <div className="flex justify-between gap-2"><span>+ Inclusões</span><span className="mono text-success">+{BRL(c.incluido)}</span></div>
      <div className="flex justify-between gap-2"><span>− Retiradas (saídas e ajustes)</span><span className="mono text-warning">-{BRL(c.retirado)}</span></div>
      <div className="flex justify-between gap-2 border-t border-border pt-1.5 text-sm font-semibold">
        <span>= Meu caixa</span><span className="mono text-primary">{BRL(c.saldo)}</span>
      </div>
      {c.aberto && (
        <p className="text-[11px] text-muted-foreground">
          O turno {formatDateBR(c.aberto.date).slice(0, 5)} {PERIODO_NOME[c.aberto.shift] ?? c.aberto.shift} está aberto: o malote dele entra quando for fechado.
        </p>
      )}
      {c.ultimos.length > 0 && (
        <div className="pt-1 space-y-0.5">
          <div className="text-[11px] text-muted-foreground">Últimas retiradas e inclusões:</div>
          {c.ultimos.map((r) => (
            <div key={r.id} className="flex justify-between gap-2 text-[11px]">
              <span className="truncate">{formatDateBR(r.date).slice(0, 5)} · {r.motivo}</span>
              <span className={`mono shrink-0 ${r.tipo === "inclusao" ? "text-success" : "text-warning"}`}>{r.tipo === "inclusao" ? "+" : "-"}{BRL(r.valor)}</span>
            </div>
          ))}
        </div>
      )}
      {comAtalho && (
        <button type="button" onClick={() => nav({ to: "/owner/pagamentos" })} className="text-[11px] text-primary hover:underline pt-1">
          Lançar uma saída, inclusão ou ajuste de contagem → Pagamentos
        </button>
      )}
    </div>
  );
}
