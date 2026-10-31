// Folha de pagamento (semanal, de segunda a domingo — o pagamento é feito na segunda seguinte).
// Tudo aqui é calculado a partir dos pontos, do consumo e dos ajustes da semana; nada é gravado.
import {
  getAllProducts, valoresConsumoPonto, ehSoConsumo,
  type State, type Funcionario, type Ponto,
} from "@/lib/store";
import { formatDateBR, todayISO } from "@/lib/format";

// ---- Semanas (segunda a domingo) ----
const isoDe = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

export function somarDias(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + n);
  return isoDe(d);
}

// Segunda-feira da semana da data informada
export function inicioSemana(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  const diaSemana = (d.getDay() + 6) % 7; // segunda = 0 ... domingo = 6
  return somarDias(iso, -diaSemana);
}

export const fimSemana = (inicio: string) => somarDias(inicio, 6);

// Semana a pagar: a última semana completa (na segunda-feira, é a semana que terminou ontem)
export const semanaPassada = (hoje = todayISO()) => somarDias(inicioSemana(hoje), -7);

export const rotuloSemana = (inicio: string) =>
  `${formatDateBR(inicio).slice(0, 5)} a ${formatDateBR(fimSemana(inicio))}`;

// Segundas-feiras das semanas que começam dentro do período
export function semanasDoPeriodo(from: string, to: string): string[] {
  const out: string[] = [];
  let s = inicioSemana(from);
  if (s < from) s = somarDias(s, 7);
  for (; s <= to; s = somarDias(s, 7)) out.push(s);
  return out;
}

export function horasEntre(entrada: string, saida: string): number {
  if (!entrada || !saida) return 0;
  const [h1, m1] = entrada.split(":").map(Number);
  const [h2, m2] = saida.split(":").map(Number);
  let mins = h2 * 60 + m2 - (h1 * 60 + m1);
  if (mins < 0) mins += 24 * 60; // atravessa meia-noite
  return mins / 60;
}

// ---- Ajustes da semana (adicional/desconto só daquela semana, lançados no fechamento semanal) ----
export const chaveAjuste = (username: string, semana: string) => `${username}|${semana}`;

export interface ItemConsumoDetalhe { productId: string; nome: string; qty: number; valor: number }
export interface ConsumoDoDia { date: string; pontoId: string; itens: ItemConsumoDetalhe[]; subtotal: number }
export interface DiaTrabalhado {
  pontoId: string; date: string; entrada: string; saida: string; horas: number;
  transporte: number; refeicao: number; temConsumo: boolean;
}

export interface Folha {
  horas: number;
  diasTrabalhados: number;
  dias: DiaTrabalhado[];
  valorHoras: number;
  valorDiarias: number;
  bruto: number;          // horas + diárias
  transp: number;
  ref: number;
  consumo: number;
  consumoDetalhe: ConsumoDoDia[];
  consumoPorProduto: { nome: string; qty: number; valor: number }[];
  semanasTrabalhadas: number;
  descontoFixo: number;   // desconto fixo do cadastro × semanas trabalhadas
  adicionalFixo: number;  // adicional fixo do cadastro × semanas trabalhadas
  descontoSemana: number; // lançado no fechamento semanal
  adicionalSemana: number;
  observacoes: string[];
  desconto: number;       // total (fixo + semana)
  adicional: number;      // total (fixo + semana)
  liquido: number;        // valor a receber
}

// Valor a receber: horas + diárias + transporte + refeição + adicionais − consumo − descontos.
// "meus" = pontos do funcionário no período (from..to).
export function calcularFolha(state: State, f: Funcionario, meus: Ponto[], from?: string, to?: string): Folha {
  const produtos = getAllProducts(state);
  const nomeProduto = (id: string) => produtos.find((p) => p.id === id)?.name ?? id;
  let horas = 0, transp = 0, ref = 0, consumo = 0;
  const diasSet = new Set<string>();
  const semanasSet = new Set<string>();
  const dias: DiaTrabalhado[] = [];
  const consumoDetalhe: ConsumoDoDia[] = [];
  const porProduto = new Map<string, { nome: string; qty: number; valor: number }>();

  for (const p of [...meus].sort((a, b) => a.date.localeCompare(b.date) || a.entrada.localeCompare(b.entrada))) {
    if (!ehSoConsumo(p)) {
      const h = horasEntre(p.entrada, p.saida);
      horas += h;
      transp += p.transporte;
      ref += p.refeicao;
      diasSet.add(p.date);
      semanasSet.add(inicioSemana(p.date));
      dias.push({
        pontoId: p.id, date: p.date, entrada: p.entrada, saida: p.saida, horas: h,
        transporte: p.transporte, refeicao: p.refeicao, temConsumo: p.consumo.length > 0,
      });
    }
    if (p.consumo.length > 0) {
      const valores = valoresConsumoPonto(state, f.username, p.consumo);
      const itens = p.consumo.map((c) => ({ productId: c.productId, nome: nomeProduto(c.productId), qty: c.qty, valor: valores[c.productId] ?? 0 }));
      const subtotal = itens.reduce((s, i) => s + i.valor, 0);
      consumo += subtotal;
      consumoDetalhe.push({ date: p.date, pontoId: p.id, itens, subtotal });
      for (const i of itens) {
        const cur = porProduto.get(i.productId) ?? { nome: i.nome, qty: 0, valor: 0 };
        cur.qty += i.qty; cur.valor += i.valor;
        porProduto.set(i.productId, cur);
      }
    }
  }

  // Ajustes da semana: soma os das semanas que começam dentro do período
  let descontoSemana = 0, adicionalSemana = 0;
  const observacoes: string[] = [];
  if (from && to) {
    for (const s of semanasDoPeriodo(from, to)) {
      const a = state.ajustesFolha[chaveAjuste(f.username, s)];
      if (!a) continue;
      descontoSemana += a.desconto || 0;
      adicionalSemana += a.adicional || 0;
      if (a.observacao?.trim()) observacoes.push(a.observacao.trim());
    }
  }

  const diasTrabalhados = diasSet.size;
  const semanasTrabalhadas = semanasSet.size;
  const valorHoras = horas * f.taxaHora;
  const valorDiarias = diasTrabalhados * (f.valorDiaria ?? 0);
  const bruto = valorHoras + valorDiarias;
  const descontoFixo = (f.desconto ?? 0) * semanasTrabalhadas;
  const adicionalFixo = (f.adicional ?? 0) * semanasTrabalhadas;
  const desconto = descontoFixo + descontoSemana;
  const adicional = adicionalFixo + adicionalSemana;
  const liquido = Math.max(0, bruto + transp + ref + adicional - consumo - desconto);
  return {
    horas, diasTrabalhados, dias, valorHoras, valorDiarias, bruto, transp, ref, consumo, consumoDetalhe,
    consumoPorProduto: [...porProduto.values()].sort((a, b) => b.valor - a.valor || b.qty - a.qty),
    semanasTrabalhadas, descontoFixo, adicionalFixo, descontoSemana, adicionalSemana, observacoes,
    desconto, adicional, liquido,
  };
}

export const pontosDoPeriodo = (state: State, username: string, from: string, to: string) =>
  state.pontos.filter((p) => p.employeeUsername === username && p.date >= from && p.date <= to);

// Conferência da folha: consumo que saiu do estoque dos turnos (coluna Consumo do turno) mas não está
// no registro de ponto de nenhum funcionário — ou seja, não é descontado de ninguém na folha.
// Acontece quando o consumo é lançado direto no turno ou quando o lançamento no Ponto não foi salvo.
export interface ConsumoSemDono { date: string; produto: string; noTurno: number; naFolha: number }

export function consumoSemDono(state: State, from: string, to: string): ConsumoSemDono[] {
  const produtos = getAllProducts(state);
  const chave = (date: string, pid: string) => `${date}|${pid}`;
  const noTurno: Record<string, number> = {};
  for (const t of [...state.historico, ...(state.turnoAtivo ? [state.turnoAtivo] : [])]) {
    if (t.date < from || t.date > to) continue;
    for (const [pid, it] of Object.entries(t.items)) {
      if ((it.consumo || 0) > 0) noTurno[chave(t.date, pid)] = (noTurno[chave(t.date, pid)] ?? 0) + it.consumo;
    }
  }
  const naFolha: Record<string, number> = {};
  for (const p of state.pontos) {
    if (p.date < from || p.date > to) continue;
    for (const c of p.consumo) naFolha[chave(p.date, c.productId)] = (naFolha[chave(p.date, c.productId)] ?? 0) + c.qty;
  }
  return Object.entries(noTurno)
    .filter(([k, q]) => q > (naFolha[k] ?? 0) + 1e-9)
    .map(([k, q]) => {
      const [date, pid] = k.split("|");
      return { date, produto: produtos.find((p) => p.id === pid)?.name ?? pid, noTurno: q, naFolha: naFolha[k] ?? 0 };
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.produto.localeCompare(b.produto));
}
