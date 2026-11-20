// Perda real (só dono/administrador): a diferença de um turno pode estar "inflada" por um erro de contagem na
// troca de turno — ex.: a Manhã conta pastel a mais (aparece SOBRA) e a Tarde herda o que não existe (aparece
// FALTA). Somando os dois, sobra só o que realmente se perdeu. Aqui: pares de turnos seguidos que se compensam
// e o total real (soma das diferenças) por período.
import { esperadoTurno, arrecadadoTurno, type Turno } from "@/lib/store";
import type { Product } from "@/lib/products";
import { inicioSemana, fimSemana, semanaPassada, somarDias } from "@/lib/folha";
import { todayISO } from "@/lib/format";

const ORDEM: Record<string, number> = { manha: 0, tarde: 1, noite: 2 };
const cronologico = (a: Turno, b: Turno) => a.date.localeCompare(b.date) || (ORDEM[a.shift] ?? 9) - (ORDEM[b.shift] ?? 9);

export const diferencaTurno = (t: Turno, products: Product[]) => arrecadadoTurno(t) - esperadoTurno(t, products);

export interface ParCompensado { antes: Turno; depois: Turno; difAntes: number; difDepois: number; real: number }

// Par = dois turnos seguidos com diferenças de sinais opostos (≥ R$ 10 cada) que quase se anulam: a soma é no
// máximo metade da maior delas. É o padrão de erro de contagem na passagem de turno.
export function paresCompensados(historico: Turno[], products: Product[]) {
  const ts = [...historico].sort(cronologico);
  const dif = new Map(ts.map((t) => [t.id, diferencaTurno(t, products)]));
  const pares: ParCompensado[] = [];
  const parDe = new Map<string, ParCompensado>();
  for (let i = 0; i + 1 < ts.length; i++) {
    const a = ts[i], b = ts[i + 1];
    if (parDe.has(a.id)) continue;
    const da = dif.get(a.id)!, db = dif.get(b.id)!;
    if (Math.abs(da) < 10 || Math.abs(db) < 10 || Math.sign(da) === Math.sign(db)) continue;
    if (Math.abs(da + db) > Math.max(Math.abs(da), Math.abs(db)) / 2) continue;
    const par = { antes: a, depois: b, difAntes: da, difDepois: db, real: da + db };
    pares.push(par); parDe.set(a.id, par); parDe.set(b.id, par);
  }
  return { dif, pares, parDe };
}

// Total real de um período = soma das diferenças dos turnos (erros de contagem entre turnos se anulam)
export function resumoPerdaReal(historico: Turno[], products: Product[], de: string, ate: string) {
  const ts = historico.filter((t) => t.date >= de && t.date <= ate);
  let sobras = 0, faltas = 0;
  for (const t of ts) { const d = diferencaTurno(t, products); if (d > 0) sobras += d; else faltas += d; }
  return { turnos: ts.length, sobras, faltas, real: sobras + faltas };
}

export function periodosPerdaReal(hoje = todayISO()) {
  const seg = inicioSemana(hoje), passada = semanaPassada(hoje);
  const ontem = somarDias(hoje, -1);
  return [
    { rotulo: "Hoje", de: hoje, ate: hoje },
    { rotulo: "Ontem", de: ontem, ate: ontem },
    { rotulo: "Esta semana", de: seg, ate: fimSemana(seg) },
    { rotulo: "Semana passada", de: passada, ate: fimSemana(passada) },
    { rotulo: "Este mês", de: hoje.slice(0, 8) + "01", ate: hoje.slice(0, 8) + "31" },
  ];
}
