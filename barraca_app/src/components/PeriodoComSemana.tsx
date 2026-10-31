import { DatePickerBR } from "@/components/ui/date-picker-br";
import { SemanaPicker } from "@/components/SemanaPicker";
import { inicioSemana, fimSemana } from "@/lib/folha";
import { todayISO } from "@/lib/format";

// Período De/Até com o atalho "7 dias (seg a dom)": os pagamentos são semanais, então a semana sempre vai
// de segunda a domingo. Com uma semana inteira selecionada, aparecem as setas ◀ ▶ para trocar de semana.
export const ehSemanaInteira = (from: string, to: string) => from === inicioSemana(from) && to === fimSemana(from);

export function BotaoSeteDias({ from, to, onChange, className = "" }: {
  from: string; to: string; onChange: (from: string, to: string) => void; className?: string;
}) {
  const ativo = ehSemanaInteira(from, to);
  return (
    <button type="button" onClick={() => { const s = inicioSemana(todayISO()); onChange(s, fimSemana(s)); }}
      className={`px-3 h-9 rounded-full text-xs border ${ativo ? "bg-primary text-primary-foreground border-primary" : "bg-background border-border text-muted-foreground hover:text-primary"} ${className}`}>
      📅 7 dias (seg a dom)
    </button>
  );
}

export function NavegarSemana({ from, to, onChange }: { from: string; to: string; onChange: (from: string, to: string) => void }) {
  if (!ehSemanaInteira(from, to)) return null;
  return <SemanaPicker inicio={from} onChange={(s) => onChange(s, fimSemana(s))} />;
}

export function PeriodoComSemana({ from, to, setFrom, setTo }: {
  from: string; to: string; setFrom: (v: string) => void; setTo: (v: string) => void;
}) {
  const mudar = (f: string, t: string) => { setFrom(f); setTo(t); };
  return (
    <div className="space-y-2">
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
      <BotaoSeteDias from={from} to={to} onChange={mudar} />
      <NavegarSemana from={from} to={to} onChange={mudar} />
    </div>
  );
}
