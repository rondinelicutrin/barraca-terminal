import { Button } from "@/components/ui/button";
import { somarDias, semanaPassada, rotuloSemana, inicioSemana } from "@/lib/folha";
import { todayISO } from "@/lib/format";

// Escolha de semana (segunda a domingo) para a folha: ◀ anterior · semana passada · próxima ▶
export function SemanaPicker({ inicio, onChange }: { inicio: string; onChange: (segunda: string) => void }) {
  const passada = semanaPassada();
  const atual = inicioSemana(todayISO());
  const legenda = inicio === passada ? "semana passada (a pagar)" : inicio === atual ? "semana atual (em andamento)" : "";
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <Button type="button" variant="secondary" className="h-10 px-3" aria-label="Semana anterior"
          onClick={() => onChange(somarDias(inicio, -7))}>◀</Button>
        <div className="flex-1 text-center">
          <div className="text-sm font-semibold mono">{rotuloSemana(inicio)}</div>
          <div className="text-[11px] text-muted-foreground">seg a dom{legenda ? ` · ${legenda}` : ""}</div>
        </div>
        <Button type="button" variant="secondary" className="h-10 px-3" aria-label="Próxima semana"
          onClick={() => onChange(somarDias(inicio, 7))}>▶</Button>
      </div>
      {inicio !== passada && (
        <button type="button" className="w-full text-xs text-primary" onClick={() => onChange(passada)}>
          Voltar para a semana passada (a pagar)
        </button>
      )}
    </div>
  );
}
