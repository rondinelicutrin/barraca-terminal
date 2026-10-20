// Cálculos do dashboard de gestão (menu Gestão): tudo é derivado do histórico de turnos fechados,
// dos pontos (consumo) e das retiradas/pagamentos — nada é gravado, só calculado a partir do que já existe.
import {
  getAllProducts, esperadoTurno, arrecadadoTurno, resumoPagamentos, valorConsumoPonto, nomeMaquina,
  type State, type Turno, type ShiftKey,
} from "@/lib/store";
import { EXCLUIR_DO_TOTAL_PASTEL } from "@/lib/products";

export const TURNOS: ShiftKey[] = ["manha", "tarde", "noite"];
export const TOLERANCIA = 0.5; // mesma tolerância do status OK/Falta

export interface LinhaTurno {
  t: Turno;
  nome: string;
  arrec: number;
  esp: number;
  diff: number; // arrecadado − esperado (negativo = faltou dinheiro)
}

export interface PorFuncionario {
  username: string;
  nome: string;
  vendas: number;
  turnos: number;
  media: number;
  saldo: number;   // soma das diferenças (positivas e negativas)
  perdas: number;  // soma só das faltas
}

export interface PorTurnoTipo {
  shift: ShiftKey;
  arrec: number;
  esp: number;
  turnos: number;
  media: number;
  perdas: number;
  sobraUn: number;
  sobraValor: number;
}

export interface PorPeriodo {
  key: string;      // dia (AAAA-MM-DD), mês (AAAA-MM) ou ano (AAAA)
  arrec: number;
  esp: number;
  perdas: number;   // soma das faltas (valor positivo)
  sobras: number;   // soma das diferenças a mais
  turnos: number;
}

export interface ConsumoFuncionario {
  username: string;
  nome: string;
  valor: number;    // valor descontado do funcionário (já com regras de desconto/limite)
  unidades: number;
  registros: number;
}

export type ModoAgrupar = "dia" | "mes" | "ano";

const nomeDe = (state: State, username: string) =>
  state.funcionarios.find((f) => f.username === username)?.nome ?? username;

export function addDias(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + n);
  const p = (x: number) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function diasEntre(from: string, to: string): number {
  const a = new Date(from + "T00:00:00").getTime();
  const b = new Date(to + "T00:00:00").getTime();
  return Math.round((b - a) / 86400000) + 1;
}

export function linhasDoPeriodo(state: State, from: string, to: string): LinhaTurno[] {
  const products = getAllProducts(state);
  return state.historico
    .filter((t) => t.date >= from && t.date <= to)
    .map((t) => {
      const arrec = arrecadadoTurno(t);
      const esp = esperadoTurno(t, products);
      return { t, nome: nomeDe(state, t.employee), arrec, esp, diff: arrec - esp };
    })
    .sort((a, b) => a.t.date.localeCompare(b.t.date) || TURNOS.indexOf(a.t.shift) - TURNOS.indexOf(b.t.shift));
}

export function totaisGerais(linhas: LinhaTurno[]) {
  let bruto = 0, esperado = 0, perdas = 0, sobras = 0;
  for (const l of linhas) {
    bruto += l.arrec;
    esperado += l.esp;
    if (l.diff < -TOLERANCIA) perdas += -l.diff;
    else if (l.diff > TOLERANCIA) sobras += l.diff;
  }
  return {
    bruto, esperado, perdas, sobras,
    saldo: bruto - esperado,
    turnos: linhas.length,
    media: linhas.length ? bruto / linhas.length : 0,
  };
}

// Bruto x líquido do período, usando a mesma regra do menu Pagamentos:
// líquido = dinheiro (− retiradas) + moedas + pix + voucher + cada maquininha (− taxa − pagamentos).
export function liquidoDoPeriodo(state: State, from: string, to: string) {
  const r = resumoPagamentos(state.historico, from, to);
  const doPeriodo = state.retiradas.filter((x) => x.date >= from && x.date <= to);
  const soma = (o: string) => doPeriodo.filter((x) => (x.origem ?? "dinheiro") === o).reduce((s, x) => s + x.valor, 0);
  const retiradas = soma("dinheiro");
  const pagoMaq1 = soma("maq1");
  const pagoMaq2 = soma("maq2");
  const taxas = state.taxasMaquininha;
  const taxaMaq1 = r.maq1Bruto * (taxas.maq1 / 100);
  const taxaMaq2 = r.maq2Bruto * (taxas.maq2 / 100);
  const dinheiroLiq = Math.max(0, r.dinheiro - retiradas);
  const liquido =
    dinheiroLiq + r.moedas + r.pix + r.voucher +
    (r.maq1Bruto - taxaMaq1 - pagoMaq1) + (r.maq2Bruto - taxaMaq2 - pagoMaq2);
  const bruto = r.dinheiro + r.moedas + r.pix + r.voucher + r.maq1Bruto + r.maq2Bruto;
  const cartaoBruto = r.maq1Bruto + r.maq2Bruto;
  return {
    resumo: r, bruto, liquido, retiradas, pagoMaq1, pagoMaq2,
    taxasCartao: taxaMaq1 + taxaMaq2, cartaoBruto,
    formas: [
      { nome: "Dinheiro", valor: r.dinheiro },
      { nome: "Moedas", valor: r.moedas },
      { nome: "Pix", valor: r.pix },
      { nome: "Voucher", valor: r.voucher },
      { nome: nomeMaquina(state.taxasMaquininha, "maq1"), valor: r.maq1Bruto },
      { nome: nomeMaquina(state.taxasMaquininha, "maq2"), valor: r.maq2Bruto },
    ].filter((f) => f.valor > 0),
  };
}

export function porFuncionario(linhas: LinhaTurno[]): PorFuncionario[] {
  const m = new Map<string, PorFuncionario>();
  for (const l of linhas) {
    const cur = m.get(l.t.employee) ?? { username: l.t.employee, nome: l.nome, vendas: 0, turnos: 0, media: 0, saldo: 0, perdas: 0 };
    cur.vendas += l.arrec;
    cur.turnos += 1;
    cur.saldo += l.diff;
    if (l.diff < -TOLERANCIA) cur.perdas += -l.diff;
    m.set(l.t.employee, cur);
  }
  return [...m.values()].map((f) => ({ ...f, media: f.turnos ? f.vendas / f.turnos : 0 })).sort((a, b) => b.vendas - a.vendas);
}

// Sobra (unidades e R$) de um turno: só produtos vendáveis, sem casquinha crua/frita (mesma regra do total de pastéis).
function sobraDoTurno(state: State, t: Turno) {
  let un = 0, valor = 0;
  for (const p of getAllProducts(state)) {
    if (!p.saleable || EXCLUIR_DO_TOTAL_PASTEL.has(p.id)) continue;
    const s = t.items[p.id]?.sobra;
    if (s == null || s <= 0) continue;
    un += s;
    valor += s * (t.precosSnapshot[p.id] ?? p.price);
  }
  return { un, valor };
}

export function porTipoTurno(state: State, linhas: LinhaTurno[]): PorTurnoTipo[] {
  return TURNOS.map((shift) => {
    const ls = linhas.filter((l) => l.t.shift === shift);
    let sobraUn = 0, sobraValor = 0, perdas = 0, arrec = 0, esp = 0;
    for (const l of ls) {
      const s = sobraDoTurno(state, l.t);
      sobraUn += s.un; sobraValor += s.valor;
      arrec += l.arrec; esp += l.esp;
      if (l.diff < -TOLERANCIA) perdas += -l.diff;
    }
    return { shift, arrec, esp, turnos: ls.length, media: ls.length ? arrec / ls.length : 0, perdas, sobraUn, sobraValor };
  });
}

// Matriz funcionário × turno (manhã/tarde/noite): total arrecadado e quantidade de turnos.
export function matrizFuncTurno(linhas: LinhaTurno[]) {
  const m = new Map<string, { username: string; nome: string; por: Record<ShiftKey, { arrec: number; n: number }> }>();
  for (const l of linhas) {
    const cur = m.get(l.t.employee) ?? {
      username: l.t.employee, nome: l.nome,
      por: { manha: { arrec: 0, n: 0 }, tarde: { arrec: 0, n: 0 }, noite: { arrec: 0, n: 0 } },
    };
    cur.por[l.t.shift].arrec += l.arrec;
    cur.por[l.t.shift].n += 1;
    m.set(l.t.employee, cur);
  }
  return [...m.values()].sort((a, b) => a.nome.localeCompare(b.nome));
}

export function agruparPor(linhas: LinhaTurno[], modo: ModoAgrupar): PorPeriodo[] {
  const m = new Map<string, PorPeriodo>();
  for (const l of linhas) {
    const key = modo === "dia" ? l.t.date : modo === "mes" ? l.t.date.slice(0, 7) : l.t.date.slice(0, 4);
    const cur = m.get(key) ?? { key, arrec: 0, esp: 0, perdas: 0, sobras: 0, turnos: 0 };
    cur.arrec += l.arrec; cur.esp += l.esp; cur.turnos += 1;
    if (l.diff < -TOLERANCIA) cur.perdas += -l.diff;
    else if (l.diff > TOLERANCIA) cur.sobras += l.diff;
    m.set(key, cur);
  }
  return [...m.values()].sort((a, b) => a.key.localeCompare(b.key));
}

// Sobras de produto no período: quais produtos mais sobram (unidades), para planejar compras.
export function sobrasPorProduto(state: State, linhas: LinhaTurno[], limite = 10) {
  const soma: Record<string, number> = {};
  for (const l of linhas) {
    for (const [pid, it] of Object.entries(l.t.items)) {
      if (it.sobra != null && it.sobra > 0) soma[pid] = (soma[pid] ?? 0) + it.sobra;
    }
  }
  const prods = getAllProducts(state);
  return Object.entries(soma)
    .map(([pid, un]) => ({ nome: prods.find((p) => p.id === pid)?.name ?? pid, un, pid }))
    .filter((x) => !EXCLUIR_DO_TOTAL_PASTEL.has(x.pid) && prods.find((p) => p.id === x.pid)?.saleable)
    .sort((a, b) => b.un - a.un)
    .slice(0, limite);
}

export function consumoPorFuncionario(state: State, from: string, to: string): ConsumoFuncionario[] {
  const m = new Map<string, ConsumoFuncionario>();
  for (const p of state.pontos) {
    if (p.date < from || p.date > to || p.consumo.length === 0) continue;
    const cur = m.get(p.employeeUsername) ?? { username: p.employeeUsername, nome: nomeDe(state, p.employeeUsername), valor: 0, unidades: 0, registros: 0 };
    cur.valor += valorConsumoPonto(state, p.employeeUsername, p.consumo);
    cur.unidades += p.consumo.reduce((s, c) => s + c.qty, 0);
    cur.registros += 1;
    m.set(p.employeeUsername, cur);
  }
  return [...m.values()].sort((a, b) => b.valor - a.valor);
}

// Faturamento (arrecadado) de janelas fixas — independente do período escolhido na tela.
export function faturamentoJanelas(state: State, hojeISO: string) {
  const d = new Date(hojeISO + "T00:00:00");
  const diaSemana = (d.getDay() + 6) % 7; // segunda = 0
  const inicioSemana = addDias(hojeISO, -diaSemana);
  const inicioMes = hojeISO.slice(0, 7) + "-01";
  const inicioAno = hojeISO.slice(0, 4) + "-01-01";
  const soma = (de: string) => {
    let v = 0;
    for (const t of state.historico) if (t.date >= de && t.date <= hojeISO) v += arrecadadoTurno(t);
    return v;
  };
  return { hoje: soma(hojeISO), semana: soma(inicioSemana), mes: soma(inicioMes), ano: soma(inicioAno) };
}

export function rotuloPeriodo(key: string): string {
  const p = key.split("-");
  if (p.length === 3) return `${p[2]}/${p[1]}`;
  if (p.length === 2) return `${p[1]}/${p[0]}`;
  return key;
}
