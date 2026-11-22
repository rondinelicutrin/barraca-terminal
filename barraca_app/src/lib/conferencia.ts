// Conferência das contagens antes de fechar o turno (versão 68):
// 1) venda fora do normal: compara o vendido de cada produto com o normal daquele período (manhã/tarde/noite)
//    nas últimas 4 semanas;
// A) recontagem obrigatória quando o caixa não bate (diferença acima de R$ 30): pede para recontar os
//    produtos mais suspeitos, sem mostrar valores (fechamento às cegas);
// B) chegada fora do normal: pede para confirmar a quantidade digitando de novo.
import { vendeu, getAllProducts, esperadoTurno, arrecadadoTurno, type State, type Turno } from "@/lib/store";
import { somarDias } from "@/lib/folha";

export const LIMITE_RECONTAGEM = 30; // R$
const JANELA_DIAS = 28;
const MIN_AMOSTRAS = 3;

function amostras(state: State, t: Turno, pid: string, campo: "vendido" | "chegada"): number[] {
  const de = somarDias(t.date, -JANELA_DIAS);
  const out: number[] = [];
  for (const h of state.historico) {
    if (h.id === t.id || !h.closedAt || h.shift !== t.shift || h.date < de || h.date >= t.date) continue;
    const it = h.items[pid];
    if (!it) continue;
    out.push(campo === "vendido" ? (vendeu(it) ?? 0) : (it.chegada ?? 0));
  }
  return out;
}

function percentil(v: number[], q: number) {
  const s = [...v].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))];
}

export interface ForaDoNormal { pid: string; nome: string; vendido: number; normalDe: number; normalAte: number }

// Produtos que venderam muito acima do normal deste período (sinal de sobra contada a menos ou chegada errada)
export function vendasForaDoNormal(state: State, t: Turno): ForaDoNormal[] {
  const out: ForaDoNormal[] = [];
  for (const p of getAllProducts(state)) {
    const it = t.items[p.id];
    if (!it || it.sobra == null || !p.saleable) continue;
    const vendido = vendeu(it) ?? 0;
    const am = amostras(state, t, p.id, "vendido");
    if (am.length < MIN_AMOSTRAS) continue;
    const p80 = percentil(am, 0.8);
    if (vendido > Math.max(p80 * 1.6, p80 + 3)) {
      out.push({ pid: p.id, nome: p.name, vendido, normalDe: percentil(am, 0.2), normalAte: p80 });
    }
  }
  return out.sort((a, b) => (b.vendido - b.normalAte) - (a.vendido - a.normalAte));
}

// Chegada fora do normal neste período: produto que nunca recebe nesse período, ou quantidade bem acima
export function chegadaForaDoNormal(state: State, t: Turno, pid: string, n: number): { nunca: boolean; normalAte: number } | null {
  if (!(n > 0)) return null;
  const am = amostras(state, t, pid, "chegada");
  if (am.length < MIN_AMOSTRAS) return null;
  const comChegada = am.filter((x) => x > 0);
  if (comChegada.length === 0) return { nunca: true, normalAte: 0 };
  const p80 = percentil(comChegada, 0.8);
  return n > Math.max(p80 * 1.6, p80 + 6) ? { nunca: false, normalAte: p80 } : null;
}

// Diferença do caixa (arrecadado − esperado), com os preços atuais, como no fechamento
export const diferencaDoTurno = (state: State, t: Turno) => arrecadadoTurno(t) - esperadoTurno(t, getAllProducts(state), true);

// Produtos para recontar: primeiro os fora do normal; depois os que mais pesam no valor vendido
export function produtosParaRecontar(state: State, t: Turno, max = 6): string[] {
  const lista = vendasForaDoNormal(state, t).map((f) => f.pid);
  const pesos = getAllProducts(state)
    .filter((p) => p.saleable && t.items[p.id] && t.items[p.id].sobra != null && !lista.includes(p.id))
    .map((p) => ({ pid: p.id, peso: (vendeu(t.items[p.id]) ?? 0) * p.price }))
    .filter((x) => x.peso > 0)
    .sort((a, b) => b.peso - a.peso);
  for (const x of pesos) { if (lista.length >= max) break; lista.push(x.pid); }
  return lista.slice(0, max);
}

export const jaRecontado = (t: Turno) => !!t.caixa.camposPreenchidos?.recontagem;
