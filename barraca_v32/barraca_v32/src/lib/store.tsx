import { createContext, useContext, useEffect, useReducer, useRef, type ReactNode } from "react";
import { DEFAULT_PRODUCTS, type Product } from "./products";
import { todayISO } from "./format";
import { supabase } from "./supabase";
import { enviar, processar, registrarExecutor, pendentesDoTipo } from "./fila";

export type ShiftKey = "manha" | "tarde" | "noite";

export interface ShiftItem {
  entrada: number;
  chegada: number | null; // null = not filled yet (obrigatório preencher antes de fechar o turno)
  sobra: number | null; // null = not filled
  consumo: number;
  consumoEst?: number; // gelo only
  descarte: number;
}

export interface MaquininhaState {
  base: number;
  display: number; // shown/typed
  // noite only:
  ate00?: number;
  apos00?: number;
}

export interface Caixa {
  // Dinheiro final = todo o dinheiro contado no caixa ao fim do turno
  dinheiroFinal: number;
  // Malote = parte do dinheiro final enviada ao dono (subtração)
  dinheiroMalote: number;
  // Moedas inicial (referência do turno anterior) e final
  moedasInicial: number;  // herdado do turno anterior (readonly)
  moedasFinal: number;    // contado ao fim
  pix: number;
  voucher: number;
  maq1: MaquininhaState;
  maq2Ativa: boolean;
  maq2: MaquininhaState;
  caixaFimPrev: number; // referência: dinheiroFinal do turno anterior
  // preenchimento obrigatório rastreado
  camposPreenchidos: Record<string, boolean>;
}

export interface Turno {
  id: string;
  date: string; // YYYY-MM-DD
  shift: ShiftKey;
  employee: string;
  outrosFuncionarios?: string[]; // usernames de colegas que também trabalharam neste turno
  items: Record<string, ShiftItem>;
  caixa: Caixa;
  createdAt: number;
  closedAt?: number;
  editado?: boolean;
  precosSnapshot: Record<string, number>;
}

export interface Funcionario {
  id: string;
  nome: string;
  username: string;
  // Só existe antes de rodar o seguranca_login.sql (depois o app não lê mais a senha do banco)
  password?: string;
  taxaHora: number; // R$/hora
  role: "employee" | "owner"; // "owner" = administrador, também acessa o Painel
  ativo?: boolean; // false = desativado: não entra no app e não aparece nas listas de trabalho (histórico é mantido)
  // Overrides pessoais (se ausentes, usa os valores padrão gerais em configGeral)
  transporteIda?: number;
  transporteVolta?: number;
  refeicao?: number;
  // Ajustes manuais de folha, lançados pelo dono
  valorDiaria?: number; // valor fixo por diária trabalhada (opcional, além/no lugar da taxa por hora)
  desconto?: number;    // desconto fixo a aplicar no valor a receber
  adicional?: number;   // valor adicional/bônus a aplicar no valor a receber
}

export interface PontoConsumoItem { productId: string; qty: number; }
export interface Ponto {
  id: string;
  employeeUsername: string;
  date: string;
  entrada: string; // HH:MM
  saida: string;
  transporte: number;
  refeicao: number;
  colegas: string[];
  consumo: PontoConsumoItem[];
}

// Registro que guarda só o consumo da pessoa (sem bater ponto): entrada = saída e sem transporte/refeição.
// Não conta como ponto (horas, diária, fechamento do turno), mas o consumo entra normalmente no desconto.
export function ehSoConsumo(p: Pick<Ponto, "entrada" | "saida" | "transporte" | "refeicao">): boolean {
  return p.entrada.slice(0, 5) === p.saida.slice(0, 5) && p.transporte === 0 && p.refeicao === 0;
}

// Usuário comparado sem espaços nas pontas e sem diferença de maiúsculas/minúsculas
export const normalizarUsuario = (u: string) => u.trim().toLowerCase();

export interface User {
  role: "owner" | "employee";
  username: string;
  nome?: string;
}

export interface ConfigGeral {
  transporteIda: number;
  transporteVolta: number;
  refeicao: number;
}

export interface DescontoConfig {
  percentual: number; // 0-100: percentual de desconto sobre o preço cheio
  limite?: number;    // quantidade máxima por registro de consumo com esse desconto (opcional)
}

export interface Retirada {
  id: string;
  date: string;   // YYYY-MM-DD
  valor: number;
  motivo: string;
  criadoEm: number;
  // De onde saiu o valor: caixa em dinheiro (padrão) ou saldo de uma das maquininhas de cartão
  origem?: "dinheiro" | "maq1" | "maq2";
  // "inclusao" = dinheiro colocado no caixa (soma); ausente/"retirada" = dinheiro tirado do caixa (subtrai).
  // Inclusão só existe para dinheiro.
  tipo?: "retirada" | "inclusao";
}

export const ehInclusao = (r: Pick<Retirada, "tipo">) => r.tipo === "inclusao";

// Movimentos de dinheiro do caixa (só origem "dinheiro"): total retirado e total incluído
export function movimentosDinheiro(lista: Retirada[]): { retirado: number; incluido: number } {
  let retirado = 0, incluido = 0;
  for (const r of lista) {
    if ((r.origem ?? "dinheiro") !== "dinheiro") continue;
    if (ehInclusao(r)) incluido += r.valor;
    else retirado += r.valor;
  }
  return { retirado, incluido };
}

// Adicional/desconto de UMA semana de um funcionário (lançado no fechamento semanal da folha)
export interface AjusteFolha {
  adicional: number;
  desconto: number;
  observacao?: string;
}

export interface TaxasMaquininha {
  maq1: number; // percentual cobrado pela maquininha 1 (taxa da operadora)
  maq2: number;
  nome1?: string; // nome escolhido pelo dono (ex.: nome do banco); vazio = "Maquininha 1"
  nome2?: string;
}

// Nome de exibição da maquininha (o dono pode trocar para o nome do banco em Pagamentos)
export function nomeMaquina(t: TaxasMaquininha, which: "maq1" | "maq2"): string {
  const n = (which === "maq1" ? t.nome1 : t.nome2)?.trim();
  return n ? n : which === "maq1" ? "Maquininha 1" : "Maquininha 2";
}

export interface State {
  turnoAtivo: Turno | null;
  historico: Turno[];
  precos: Record<string, number>;
  bebidas: Product[]; // extra drinks added by owner
  funcionarios: Funcionario[];
  pontos: Ponto[];
  currentUser: User | null;
  removedProductIds: string[]; // removed drinks
  estoqueQtd: Record<string, number>;     // quantidade em estoque definida pelo dono
  estoqueMinimo: Record<string, number>;  // limite mínimo p/ alerta de estoque baixo
  configGeral: ConfigGeral; // valores padrão de transporte/refeição, controlados pelo dono
  selectedDate: string; // data selecionada, compartilhada entre os menus Turno e Ponto
  // Desconto de consumo por funcionário e por produto: username -> productId -> config.
  // Quando não há entrada aqui, usa o padrão (grátis se freeForEmployee, senão 50%).
  descontosPorFuncionario: Record<string, Record<string, DescontoConfig>>;
  retiradas: Retirada[]; // retiradas de dinheiro do caixa (com motivo)
  taxasMaquininha: TaxasMaquininha; // percentual cobrado por cada maquininha
  ajustesFolha: Record<string, AjusteFolha>; // "username|segunda-feira da semana" -> ajuste da semana
  // true depois que o login e os dados guardados no navegador foram lidos. Até lá as telas não
  // redirecionam ninguém — antes, recarregar a página (F5) jogava o usuário para o login/Painel.
  hidratado?: boolean;
}

const STORAGE_KEY = "barraca_v7";

const initialState = (): State => {
  const precos: Record<string, number> = {};
  DEFAULT_PRODUCTS.forEach((p) => (precos[p.id] = p.price));
  return {
    turnoAtivo: null,
    historico: [],
    precos,
    bebidas: [],
    funcionarios: [],
    pontos: [],
    currentUser: null,
    removedProductIds: [],
    estoqueQtd: {},
    estoqueMinimo: {},
    configGeral: { transporteIda: 0, transporteVolta: 0, refeicao: 15 },
    selectedDate: todayISO(),
    descontosPorFuncionario: {},
    retiradas: [],
    taxasMaquininha: { maq1: 0, maq2: 0 },
    ajustesFolha: {},
  };
};

type Action =
  | { type: "HYDRATE"; state: State | null }
  | { type: "LOGIN"; user: User }
  | { type: "LOGOUT" }
  | { type: "START_SHIFT"; shift: ShiftKey; date: string; employee: string; outrosFuncionarios?: string[] }
  | { type: "UPDATE_ITEM"; productId: string; patch: Partial<ShiftItem> }
  | { type: "SYNC_TURNO_ITEMS"; products: Product[] }
  | { type: "UPDATE_CAIXA"; patch: Partial<Caixa> }
  | { type: "UPDATE_MAQ"; which: "maq1" | "maq2"; patch: Partial<MaquininhaState> }
  | { type: "CLOSE_SHIFT" }
  | { type: "DISCARD_SHIFT" }
  | { type: "DELETE_TURNO"; id: string }
  | { type: "EDIT_HIST"; id: string; turno: Turno }
  | { type: "EDIT_ATIVO"; turno: Turno }
  | { type: "ADD_FUNC"; f: Funcionario }
  | { type: "REMOVE_FUNC"; id: string }
  | { type: "UPDATE_FUNC"; id: string; patch: Partial<Funcionario> }
  | { type: "SET_FUNCIONARIOS"; funcionarios: Funcionario[] }
  | { type: "SET_TURNOS_FROM_DB"; turnoAtivo: Turno | null; historico: Turno[] }
  | { type: "SET_PONTOS_FROM_DB"; pontos: Ponto[] }
  | { type: "SET_RETIRADAS_FROM_DB"; retiradas: Retirada[] }
  | { type: "SET_DESCONTOS_FROM_DB"; descontos: Record<string, Record<string, DescontoConfig>> }
  | { type: "SET_CONFIG_FROM_DB"; configGeral: ConfigGeral; taxasMaquininha: TaxasMaquininha }
  | {
      type: "SET_PRODUTOS_FROM_DB";
      precos: Record<string, number>;
      bebidas: Product[];
      removedProductIds?: string[]; // ausente = banco ainda sem a coluna "ativo"
      estoqueQtd: Record<string, number>;
      estoqueMinimo: Record<string, number>;
    }
  | { type: "ADD_PONTO"; p: Ponto }
  | { type: "REMOVE_PONTO"; id: string }
  | { type: "UPDATE_PONTO"; id: string; patch: Partial<Pick<Ponto, "date" | "entrada" | "saida" | "transporte" | "refeicao">> }
  | { type: "UPDATE_PONTO_CONSUMO"; pontoId: string; productId: string; qty: number }
  | { type: "SET_PRICE"; productId: string; price: number }
  | { type: "SET_ESTOQUE_QTD"; productId: string; qtd: number }
  | { type: "SET_ESTOQUE_MINIMO"; productId: string; minimo: number }
  | { type: "SET_CONFIG_GERAL"; patch: Partial<ConfigGeral> }
  | { type: "SET_SELECTED_DATE"; date: string }
  | { type: "SET_DESCONTO_FUNCIONARIO"; username: string; productId: string; patch: Partial<DescontoConfig> }
  | { type: "REMOVE_DESCONTO_FUNCIONARIO"; username: string; productId: string }
  | { type: "ADD_RETIRADA"; r: Retirada }
  | { type: "REMOVE_RETIRADA"; id: string }
  | { type: "SET_TAXAS_MAQUININHA"; patch: Partial<TaxasMaquininha> }
  | { type: "SET_AJUSTE_FOLHA"; username: string; semana: string; patch: Partial<AjusteFolha> }
  | { type: "SET_AJUSTES_FOLHA_FROM_DB"; ajustes: Record<string, AjusteFolha> }
  | { type: "ADD_PRODUCT"; b: Product }
  | { type: "REMOVE_PRODUCT"; productId: string };

function persist(s: State) {
  try {
    const { hidratado: _h, ...salvar } = s;
    // Senha nunca fica guardada no navegador
    const funcionarios = s.funcionarios.map(({ password: _p, ...f }) => f);
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...salvar, funcionarios }));
  } catch {}
}

// ---- Conversão entre o formato do app (camelCase) e o formato das tabelas no Supabase (snake_case) ----
function funcionarioFromRow(row: any): Funcionario {
  return {
    id: row.id,
    nome: row.nome,
    username: row.username,
    password: row.password,
    taxaHora: row.taxa_hora,
    role: row.role === "owner" ? "owner" : "employee",
    ativo: row.ativo !== false,
    transporteIda: row.transporte_ida ?? undefined,
    transporteVolta: row.transporte_volta ?? undefined,
    refeicao: row.refeicao ?? undefined,
    valorDiaria: row.valor_diaria ?? undefined,
    desconto: row.desconto ?? undefined,
    adicional: row.adicional ?? undefined,
  };
}

const COLUNAS_FUNCIONARIO =
  "id,nome,username,taxa_hora,role,ativo,transporte_ida,transporte_volta,refeicao,valor_diaria,desconto,adicional,created_at";

// Envia para o Supabase o que mudou nos funcionários. Roda "em segundo plano": a tela já foi
// atualizada na hora (não espera a internet); se der erro de conexão, avisa no console.
async function sincronizarFuncionario(a: Action) {
  try {
    if (a.type === "ADD_FUNC") {
      const { error } = await supabase.from("funcionarios").insert({
        id: a.f.id,
        nome: a.f.nome,
        username: a.f.username,
        password: a.f.password, // o banco criptografa (seguranca_login.sql)
        taxa_hora: a.f.taxaHora,
        role: a.f.role,
        transporte_ida: a.f.transporteIda ?? null,
        transporte_volta: a.f.transporteVolta ?? null,
        refeicao: a.f.refeicao ?? null,
        valor_diaria: a.f.valorDiaria ?? null,
        desconto: a.f.desconto ?? null,
        adicional: a.f.adicional ?? null,
      });
      // 23505 = já existe: o envio anterior chegou ao banco antes da internet cair (é um reenvio)
      if (error && error.code !== "23505") throw error;
    } else if (a.type === "UPDATE_FUNC") {
      const patch: Record<string, unknown> = {};
      if ("nome" in a.patch) patch.nome = a.patch.nome;
      if ("username" in a.patch) patch.username = a.patch.username;
      if ("password" in a.patch) patch.password = a.patch.password;
      if ("taxaHora" in a.patch) patch.taxa_hora = a.patch.taxaHora;
      if ("role" in a.patch) patch.role = a.patch.role;
      if ("ativo" in a.patch) patch.ativo = a.patch.ativo !== false;
      if ("transporteIda" in a.patch) patch.transporte_ida = a.patch.transporteIda ?? null;
      if ("transporteVolta" in a.patch) patch.transporte_volta = a.patch.transporteVolta ?? null;
      if ("refeicao" in a.patch) patch.refeicao = a.patch.refeicao ?? null;
      if ("valorDiaria" in a.patch) patch.valor_diaria = a.patch.valorDiaria ?? null;
      if ("desconto" in a.patch) patch.desconto = a.patch.desconto ?? null;
      if ("adicional" in a.patch) patch.adicional = a.patch.adicional ?? null;
      if (Object.keys(patch).length > 0) {
        const { error } = await supabase.from("funcionarios").update(patch).eq("id", a.id);
        if (error) throw error;
      }
    } else if (a.type === "REMOVE_FUNC") {
      const { error } = await supabase.from("funcionarios").delete().eq("id", a.id);
      if (error) throw error;
    }
  } catch (e) {
    if (a.type === "UPDATE_FUNC" && "ativo" in a.patch && String((e as any)?.message ?? "").includes("ativo")) {
      alert("Para ativar/desativar funcionários o banco precisa da coluna 'ativo'. Rode o arquivo adicionar_ativo.sql no SQL Editor do Supabase (até lá a mudança vale só neste aparelho).");
    }
    throw e; // a fila decide: sem internet → reenvia; recusado pelo servidor → avisa na tela
  }
}

// Busca linhas de uma tabela filha em lotes de ids e com paginação (.range), porque o Supabase/PostgREST
// devolve no máximo 1000 linhas por requisição — sem isso, itens de turnos antigos eram descartados em silêncio.
async function buscarEmLotes(tabela: string, coluna: string, ids: string[]): Promise<any[]> {
  const out: any[] = [];
  const LOTE = 10, PAG = 1000;
  for (let i = 0; i < ids.length; i += LOTE) {
    const parte = ids.slice(i, i + LOTE);
    for (let de = 0; ; de += PAG) {
      const { data, error } = await supabase.from(tabela).select("*").in(coluna, parte)
        .order(coluna, { ascending: true }).range(de, de + PAG - 1);
      if (error) {
        // eslint-disable-next-line no-console
        console.error(`Falha ao carregar ${tabela}:`, error);
        break;
      }
      out.push(...(data ?? []));
      if (!data || data.length < PAG) break;
    }
  }
  return out;
}

// ---- Conversão de Turno (app) <-> tabelas "turnos" e "turno_itens" (Supabase) ----
function shiftItemFromRow(row: any): ShiftItem {
  return {
    entrada: row.entrada,
    chegada: row.chegada,
    sobra: row.sobra,
    consumo: row.consumo,
    consumoEst: row.consumo_est ?? undefined,
    descarte: row.descarte,
  };
}

function itemToRow(turnoId: string, productId: string, it: ShiftItem) {
  return {
    turno_id: turnoId,
    product_id: productId,
    entrada: it.entrada,
    chegada: it.chegada,
    sobra: it.sobra,
    consumo: it.consumo,
    consumo_est: it.consumoEst ?? null,
    descarte: it.descarte,
  };
}

function caixaFromRow(row: any): Caixa {
  return {
    dinheiroFinal: row.dinheiro_final,
    dinheiroMalote: row.dinheiro_malote,
    moedasInicial: row.moedas_inicial,
    moedasFinal: row.moedas_final,
    pix: row.pix,
    voucher: row.voucher,
    maq1: { base: row.maq1_base, display: row.maq1_display, ate00: row.maq1_ate00 ?? undefined, apos00: row.maq1_apos00 ?? undefined },
    maq2Ativa: row.maq2_ativa,
    maq2: { base: row.maq2_base, display: row.maq2_display, ate00: row.maq2_ate00 ?? undefined, apos00: row.maq2_apos00 ?? undefined },
    caixaFimPrev: row.caixa_fim_prev,
    camposPreenchidos: row.campos_preenchidos ?? {},
  };
}

function turnoFromRow(row: any, items: Record<string, ShiftItem>): Turno {
  return {
    id: row.id,
    date: row.date,
    shift: row.shift,
    employee: row.employee_username,
    outrosFuncionarios: row.outros_funcionarios ?? [],
    items,
    caixa: caixaFromRow(row),
    createdAt: new Date(row.created_at).getTime(),
    closedAt: row.closed_at ? new Date(row.closed_at).getTime() : undefined,
    editado: row.editado ?? false,
    precosSnapshot: row.precos_snapshot ?? {},
  };
}

function turnoToRow(t: Turno) {
  const c = t.caixa;
  return {
    id: t.id,
    date: t.date,
    shift: t.shift,
    employee_username: t.employee,
    outros_funcionarios: t.outrosFuncionarios ?? [],
    dinheiro_final: c.dinheiroFinal,
    dinheiro_malote: c.dinheiroMalote,
    moedas_inicial: c.moedasInicial,
    moedas_final: c.moedasFinal,
    pix: c.pix,
    voucher: c.voucher,
    caixa_fim_prev: c.caixaFimPrev,
    maq1_base: c.maq1.base,
    maq1_display: c.maq1.display,
    maq1_ate00: c.maq1.ate00 ?? null,
    maq1_apos00: c.maq1.apos00 ?? null,
    maq2_ativa: c.maq2Ativa,
    maq2_base: c.maq2.base,
    maq2_display: c.maq2.display,
    maq2_ate00: c.maq2.ate00 ?? null,
    maq2_apos00: c.maq2.apos00 ?? null,
    campos_preenchidos: c.camposPreenchidos,
    precos_snapshot: t.precosSnapshot,
    closed_at: t.closedAt ? new Date(t.closedAt).toISOString() : null,
    editado: t.editado ?? false,
  };
}

// Salva o turno inteiro (caixa + todos os itens) no Supabase. Essa função é a mesma tanto para
// turno aberto (vai sendo chamada aos poucos, com um pequeno atraso) quanto para turno fechado
// ou corrigido pelo dono (chamada na hora).
async function sincronizarTurnoCompleto(t: Turno) {
  try {
    const { error: errTurno } = await supabase.from("turnos").upsert(turnoToRow(t), { onConflict: "id" });
    if (errTurno) throw errTurno;
    const itemRows = Object.entries(t.items).map(([productId, it]) => itemToRow(t.id, productId, it));
    if (itemRows.length > 0) {
      // onConflict explícito: turno_itens tem chave composta (turno_id + product_id)
      const { error: errItens } = await supabase
        .from("turno_itens")
        .upsert(itemRows, { onConflict: "turno_id,product_id" });
      if (errItens) throw errItens;
    }
  } catch (e) {
    throw e; // a fila decide: sem internet → reenvia; recusado pelo servidor → avisa na tela
  }
}

// Remove um turno do Supabase (usado quando o funcionário descarta o turno sem fechar).
// Os itens do turno somem junto, automaticamente (configurado no banco).
async function excluirTurnoSupabase(turnoId: string) {
  try {
    const { error } = await supabase.from("turnos").delete().eq("id", turnoId);
    if (error) throw error;
  } catch (e) {
    throw e; // a fila decide: sem internet → reenvia; recusado pelo servidor → avisa na tela
  }
}

// ---- Conversão de Ponto (app) <-> tabelas "pontos" e "ponto_consumo" (Supabase) ----
function pontoFromRow(row: any, consumo: PontoConsumoItem[]): Ponto {
  return {
    id: row.id,
    employeeUsername: row.employee_username,
    date: row.date,
    entrada: String(row.entrada).slice(0, 5), // o banco guarda "18:00:00"; o app usa "18:00"
    saida: String(row.saida).slice(0, 5),
    transporte: row.transporte,
    refeicao: row.refeicao,
    colegas: row.colegas ?? [],
    consumo,
  };
}

// Ponto e seu consumo mudam pouco (um lançamento por dia, raramente editado depois), então
// aqui sincronizamos na hora, sem atraso — diferente do turno, que muda a cada tecla digitada.
async function sincronizarPonto(a: Action) {
  try {
    if (a.type === "ADD_PONTO") {
      // upsert (e não insert): se a internet cair no meio e o envio for repetido, não duplica nem dá erro
      const { error: errPonto } = await supabase.from("pontos").upsert({
        id: a.p.id,
        employee_username: a.p.employeeUsername,
        date: a.p.date,
        entrada: a.p.entrada,
        saida: a.p.saida,
        transporte: a.p.transporte,
        refeicao: a.p.refeicao,
        colegas: a.p.colegas,
      }, { onConflict: "id" });
      if (errPonto) throw errPonto;
      if (a.p.consumo.length > 0) {
        const rows = a.p.consumo.map((c) => ({ ponto_id: a.p.id, product_id: c.productId, qty: c.qty }));
        const { error: errConsumo } = await supabase.from("ponto_consumo").upsert(rows, { onConflict: "ponto_id,product_id" });
        if (errConsumo) throw errConsumo;
      }
    } else if (a.type === "UPDATE_PONTO") {
      // Correção feita pelo dono (folha semanal): data, horários, transporte e refeição
      const row: Record<string, unknown> = {};
      if (a.patch.date !== undefined) row.date = a.patch.date;
      if (a.patch.entrada !== undefined) row.entrada = a.patch.entrada;
      if (a.patch.saida !== undefined) row.saida = a.patch.saida;
      if (a.patch.transporte !== undefined) row.transporte = a.patch.transporte;
      if (a.patch.refeicao !== undefined) row.refeicao = a.patch.refeicao;
      const { error } = await supabase.from("pontos").update(row).eq("id", a.id);
      if (error) throw error;
    } else if (a.type === "REMOVE_PONTO") {
      // ponto_consumo some junto (on delete cascade, configurado no banco)
      const { error } = await supabase.from("pontos").delete().eq("id", a.id);
      if (error) throw error;
    } else if (a.type === "UPDATE_PONTO_CONSUMO") {
      if (a.qty > 0) {
        const { error } = await supabase
          .from("ponto_consumo")
          .upsert({ ponto_id: a.pontoId, product_id: a.productId, qty: a.qty }, { onConflict: "ponto_id,product_id" });
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("ponto_consumo")
          .delete().eq("ponto_id", a.pontoId).eq("product_id", a.productId);
        if (error) throw error;
      }
    }
  } catch (e) {
    throw e; // a fila decide: sem internet → reenvia; recusado pelo servidor → avisa na tela
  }
}

function reducer(s: State, a: Action): State {
  let n: State;
  switch (a.type) {
    case "HYDRATE": {
      if (!a.state) return { ...s, hidratado: true }; // nada salvo neste aparelho
      // Migração defensiva: preenche campos novos que podem não existir em saves antigos
      const migrated = { ...a.state, hidratado: true };
      if (!migrated.estoqueQtd) migrated.estoqueQtd = {};
      if (!migrated.estoqueMinimo) migrated.estoqueMinimo = {};
      if (!migrated.configGeral) migrated.configGeral = { transporteIda: 0, transporteVolta: 0, refeicao: 15 };
      if (!migrated.selectedDate) migrated.selectedDate = todayISO();
      if (!migrated.descontosPorFuncionario) migrated.descontosPorFuncionario = {};
      if (!migrated.retiradas) migrated.retiradas = [];
      if (!migrated.taxasMaquininha) migrated.taxasMaquininha = { maq1: 0, maq2: 0 };
      if (!migrated.ajustesFolha) migrated.ajustesFolha = {};
      if (migrated.turnoAtivo) {
        const c = migrated.turnoAtivo.caixa as any;
        if (c.dinheiro !== undefined && c.dinheiroFinal === undefined) {
          // Converte estrutura antiga para nova
          c.dinheiroFinal  = c.dinheiro ?? 0;
          c.dinheiroMalote = 0;
          c.moedasInicial  = 0;
          c.moedasFinal    = c.moedas ?? 0;
          c.voucher        = c.voucher ?? 0;
          c.camposPreenchidos = {};
          delete c.dinheiro;
          delete c.moedas;
          delete c.caixaFim;
        }
        if (!c.camposPreenchidos) c.camposPreenchidos = {};
        if (c.voucher === undefined) c.voucher = 0;
        if (c.moedasInicial === undefined) c.moedasInicial = 0;
        if (c.moedasFinal === undefined) c.moedasFinal = 0;
        if (c.dinheiroFinal === undefined) c.dinheiroFinal = 0;
        if (c.dinheiroMalote === undefined) c.dinheiroMalote = 0;
      }
      return migrated;
    }
    case "LOGIN":
      n = { ...s, currentUser: a.user }; break;
    case "LOGOUT":
      n = { ...s, currentUser: null }; break;
    case "START_SHIFT": {
      const items: Record<string, ShiftItem> = {};
      const allProds = getAllProducts(s);
      const entradaDe = entradaHerdada(s, a.date, a.shift);
      allProds.forEach((p) => {
        items[p.id] = {
          entrada: entradaDe(p.id),
          chegada: null,
          sobra: null,
          consumo: 0,
          consumoEst: p.special ? 0 : undefined,
          descarte: 0,
        };
      });
      const caixaFimPrev = previousCaixaFim(s, a.shift, a.date);
      const bases = previousMaqBases(s, a.shift, a.date);
      const moedasInicial = previousMoedasFinal(s, a.shift, a.date);
      const turno: Turno = {
        id: crypto.randomUUID(),
        date: a.date,
        shift: a.shift,
        employee: a.employee,
        outrosFuncionarios: a.outrosFuncionarios ?? [],
        items,
        caixa: {
          dinheiroFinal: 0,
          dinheiroMalote: 0,
          moedasInicial,
          moedasFinal: 0,
          pix: 0,
          voucher: 0,
          maq1: { base: bases.maq1, display: 0, ate00: 0, apos00: 0 },
          maq2Ativa: false,
          maq2: { base: bases.maq2, display: 0, ate00: 0, apos00: 0 },
          caixaFimPrev,
          camposPreenchidos: {},
        },
        createdAt: Date.now(),
        precosSnapshot: { ...s.precos },
      };
      n = { ...s, turnoAtivo: turno }; break;
    }
    case "UPDATE_ITEM": {
      if (!s.turnoAtivo) return s;
      const items = { ...s.turnoAtivo.items };
      items[a.productId] = { ...items[a.productId], ...a.patch };
      n = { ...s, turnoAtivo: { ...s.turnoAtivo, items } };
      break;
    }
    case "SYNC_TURNO_ITEMS": {
      // Garante que todo produto do catálogo atual tenha uma entrada no turno em andamento —
      // necessário quando um produto novo é cadastrado enquanto o turno já estava aberto.
      if (!s.turnoAtivo) return s;
      const items = { ...s.turnoAtivo.items };
      let changed = false;
      const entradaDe = entradaHerdada(s, s.turnoAtivo.date, s.turnoAtivo.shift);
      for (const p of a.products) {
        if (!items[p.id]) {
          items[p.id] = {
            entrada: entradaDe(p.id),
            chegada: null,
            sobra: null,
            consumo: 0,
            descarte: 0,
            consumoEst: p.special ? 0 : undefined,
          };
          changed = true;
        }
      }
      if (!changed) return s;
      n = { ...s, turnoAtivo: { ...s.turnoAtivo, items } };
      break;
    }
    case "UPDATE_CAIXA": {
      if (!s.turnoAtivo) return s;
      n = { ...s, turnoAtivo: { ...s.turnoAtivo, caixa: { ...s.turnoAtivo.caixa, ...a.patch } } };
      break;
    }
    case "UPDATE_MAQ": {
      if (!s.turnoAtivo) return s;
      const cur = s.turnoAtivo.caixa[a.which];
      const upd = { ...cur, ...a.patch };
      n = { ...s, turnoAtivo: { ...s.turnoAtivo, caixa: { ...s.turnoAtivo.caixa, [a.which]: upd } } };
      break;
    }
    case "CLOSE_SHIFT": {
      if (!s.turnoAtivo) return s;
      const closed: Turno = { ...s.turnoAtivo, closedAt: Date.now() };
      n = {
        ...s,
        turnoAtivo: null,
        historico: [closed, ...s.historico],
        estoqueQtd: syncEstoqueFromTurno(s.estoqueQtd, closed),
      };
      break;
    }
    case "DISCARD_SHIFT":
      n = { ...s, turnoAtivo: null }; break;
    case "DELETE_TURNO": {
      // Dono exclui um fechamento (ou o turno em andamento) para o funcionário poder abrir de novo
      // e refazer. A quantidade em estoque volta ao que era na abertura desse turno, para que a
      // "Entrada" do novo turno saia certa — mas só quando é o turno mais recente; se houver
      // turnos posteriores, o estoque atual já reflete eles e não é mexido.
      const ativo = s.turnoAtivo && s.turnoAtivo.id === a.id ? s.turnoAtivo : null;
      const fechado = s.historico.find((t) => t.id === a.id) ?? null;
      const alvo = ativo ?? fechado;
      if (!alvo) return s;
      const maisRecente = ativo
        ? true
        : !s.turnoAtivo && s.historico.every((t) => t.id === a.id || (t.closedAt ?? 0) <= (fechado!.closedAt ?? 0));
      const restante = s.historico.filter((t) => t.id !== a.id);
      let estoqueQtd = s.estoqueQtd;
      if (maisRecente && (fechado || ativo?.editado)) {
        estoqueQtd = { ...s.estoqueQtd };
        for (const [pid, it] of Object.entries(alvo.items)) estoqueQtd[pid] = it.entrada;
        // O que sobrou no histórico (período anterior) manda: assim a entrada do turno refeito
        // vem sempre da última sobra real, mesmo que a entrada do turno apagado estivesse errada/zerada.
        for (const [pid, qtd] of Object.entries(sobrasDoHistorico(restante))) estoqueQtd[pid] = qtd;
      }
      n = {
        ...s,
        turnoAtivo: ativo ? null : s.turnoAtivo,
        historico: restante,
        estoqueQtd,
      };
      break;
    }
    case "EDIT_HIST": {
      const historico = s.historico.map((t) => (t.id === a.id ? { ...a.turno, editado: true } : t));
      n = {
        ...s,
        historico,
        // Controle total do dono: qualquer correção feita aqui (em qualquer turno, não só o mais
        // recente) atualiza imediatamente a quantidade em estoque atual — usada como entrada dos
        // próximos turnos — para que fechamentos e contagens futuras já saiam corretos.
        estoqueQtd: syncEstoqueFromTurno(s.estoqueQtd, a.turno),
      };
      break;
    }
    case "EDIT_ATIVO": {
      if (!s.turnoAtivo || s.turnoAtivo.id !== a.turno.id) return s;
      n = {
        ...s,
        turnoAtivo: { ...a.turno, editado: true },
        // Correção do turno em andamento também já atualiza a quantidade em estoque atual
        estoqueQtd: syncEstoqueFromTurno(s.estoqueQtd, a.turno),
      };
      break;
    }
    case "ADD_FUNC":
      n = { ...s, funcionarios: [...s.funcionarios, a.f] }; break;
    case "REMOVE_FUNC":
      n = { ...s, funcionarios: s.funcionarios.filter((f) => f.id !== a.id) }; break;
    case "UPDATE_FUNC":
      n = { ...s, funcionarios: s.funcionarios.map((f) => f.id === a.id ? { ...f, ...a.patch } : f) }; break;
    case "SET_FUNCIONARIOS":
      n = { ...s, funcionarios: a.funcionarios }; break;
    case "SET_TURNOS_FROM_DB": {
      // Aparelho novo / navegador limpo: o estoque atual não existe aqui. Completa o que falta com a
      // última sobra de cada produto no histórico vindo do banco (não mexe no que já existe).
      const doHist = sobrasDoHistorico(a.historico);
      const estoqueQtd = { ...s.estoqueQtd };
      for (const [pid, qtd] of Object.entries(doHist)) {
        if (estoqueQtd[pid] === undefined) estoqueQtd[pid] = qtd;
      }
      n = { ...s, turnoAtivo: a.turnoAtivo, historico: a.historico, estoqueQtd }; break;
    }
    case "SET_PONTOS_FROM_DB": {
      // Mantém pontos lançados aqui que ainda não chegaram ao banco (ex.: bateu o ponto enquanto a
      // lista ainda carregava) — antes eles sumiam e o fechamento do turno reclamava do ponto.
      const idsDb = new Set(a.pontos.map((p) => p.id));
      const soLocais = s.pontos.filter((p) => !idsDb.has(p.id));
      n = { ...s, pontos: [...soLocais, ...a.pontos] }; break;
    }
    case "SET_RETIRADAS_FROM_DB":
      n = { ...s, retiradas: a.retiradas }; break;
    case "SET_DESCONTOS_FROM_DB":
      n = { ...s, descontosPorFuncionario: a.descontos }; break;
    case "SET_CONFIG_FROM_DB":
      n = {
        ...s,
        configGeral: a.configGeral,
        // os nomes escolhidos neste aparelho valem se o banco ainda não tem as colunas dos nomes
        taxasMaquininha: {
          ...a.taxasMaquininha,
          nome1: a.taxasMaquininha.nome1 ?? s.taxasMaquininha.nome1,
          nome2: a.taxasMaquininha.nome2 ?? s.taxasMaquininha.nome2,
        },
      };
      break;
    case "SET_PRODUTOS_FROM_DB": {
      // O banco manda nos preços, produtos cadastrados e estoque — assim todos os aparelhos ficam iguais.
      // Produtos cadastrados só neste aparelho (ainda não enviados) são mantidos.
      const idsDb = new Set(a.bebidas.map((b) => b.id));
      const soLocais = s.bebidas.filter((b) => !idsDb.has(b.id));
      const removidos = a.removedProductIds
        ? Array.from(new Set([...a.removedProductIds, ...s.removedProductIds]))
        : s.removedProductIds;
      n = {
        ...s,
        precos: { ...s.precos, ...a.precos },
        bebidas: [...a.bebidas, ...soLocais],
        removedProductIds: removidos,
        estoqueQtd: { ...s.estoqueQtd, ...a.estoqueQtd },
        estoqueMinimo: { ...s.estoqueMinimo, ...a.estoqueMinimo },
      };
      break;
    }
    case "ADD_PONTO":
      n = { ...s, pontos: [a.p, ...s.pontos] }; break;
    case "REMOVE_PONTO":
      n = { ...s, pontos: s.pontos.filter((p) => p.id !== a.id) }; break;
    case "UPDATE_PONTO":
      n = { ...s, pontos: s.pontos.map((p) => (p.id === a.id ? { ...p, ...a.patch } : p)) }; break;
    case "UPDATE_PONTO_CONSUMO": {
      n = {
        ...s,
        pontos: s.pontos.map((p) => {
          if (p.id !== a.pontoId) return p;
          const others = p.consumo.filter((c) => c.productId !== a.productId);
          const consumo = a.qty > 0 ? [...others, { productId: a.productId, qty: a.qty }] : others;
          return { ...p, consumo };
        }),
      };
      break;
    }
    case "SET_PRICE":
      n = { ...s, precos: { ...s.precos, [a.productId]: a.price } }; break;
    case "SET_ESTOQUE_QTD":
      n = { ...s, estoqueQtd: { ...s.estoqueQtd, [a.productId]: a.qtd } }; break;
    case "SET_ESTOQUE_MINIMO":
      n = { ...s, estoqueMinimo: { ...s.estoqueMinimo, [a.productId]: a.minimo } }; break;
    case "SET_CONFIG_GERAL":
      n = { ...s, configGeral: { ...s.configGeral, ...a.patch } }; break;
    case "SET_SELECTED_DATE":
      n = { ...s, selectedDate: a.date }; break;
    case "SET_DESCONTO_FUNCIONARIO": {
      const doFunc = s.descontosPorFuncionario[a.username] ?? {};
      const atual = doFunc[a.productId] ?? { percentual: 50 };
      n = {
        ...s,
        descontosPorFuncionario: {
          ...s.descontosPorFuncionario,
          [a.username]: { ...doFunc, [a.productId]: { ...atual, ...a.patch } },
        },
      };
      break;
    }
    case "REMOVE_DESCONTO_FUNCIONARIO": {
      const doFunc = { ...(s.descontosPorFuncionario[a.username] ?? {}) };
      delete doFunc[a.productId];
      n = { ...s, descontosPorFuncionario: { ...s.descontosPorFuncionario, [a.username]: doFunc } };
      break;
    }
    case "ADD_RETIRADA":
      n = { ...s, retiradas: [a.r, ...s.retiradas] }; break;
    case "REMOVE_RETIRADA":
      n = { ...s, retiradas: s.retiradas.filter((r) => r.id !== a.id) }; break;
    case "SET_TAXAS_MAQUININHA":
      n = { ...s, taxasMaquininha: { ...s.taxasMaquininha, ...a.patch } }; break;
    case "SET_AJUSTE_FOLHA": {
      const k = `${a.username}|${a.semana}`;
      const atual = s.ajustesFolha[k] ?? { adicional: 0, desconto: 0 };
      n = { ...s, ajustesFolha: { ...s.ajustesFolha, [k]: { ...atual, ...a.patch } } };
      break;
    }
    case "SET_AJUSTES_FOLHA_FROM_DB":
      // Mantém os ajustes feitos aqui que ainda não chegaram ao banco; o banco vale para o resto
      n = { ...s, ajustesFolha: { ...s.ajustesFolha, ...a.ajustes } }; break;
    case "ADD_PRODUCT":
      n = { ...s, bebidas: [...s.bebidas, a.b], precos: { ...s.precos, [a.b.id]: a.b.price } }; break;
    case "REMOVE_PRODUCT":
      n = { ...s, removedProductIds: [...s.removedProductIds, a.productId] }; break;
    default:
      return s;
  }
  persist(n);
  return n;
}

const ORDEM_TURNO: Record<string, number> = { manha: 0, tarde: 1, noite: 2 };

// Ordem de exibição dos fechamentos: data mais recente primeiro e, dentro do mesmo dia,
// Manhã → Tarde → Noite.
export function ordenarTurnos<T extends { date: string; shift: string }>(lista: T[]): T[] {
  return [...lista].sort((a, b) => b.date.localeCompare(a.date) || (ORDEM_TURNO[a.shift] ?? 9) - (ORDEM_TURNO[b.shift] ?? 9));
}

export function getAllProducts(s: State): Product[] {
  const all = [...DEFAULT_PRODUCTS, ...s.bebidas].filter((p) => !s.removedProductIds.includes(p.id));
  return all.map((p) => ({ ...p, price: s.precos[p.id] ?? p.price }));
}

// Percentual de desconto de consumo para um funcionário+produto específico. Sem configuração
// própria: 100% (grátis) para itens freeForEmployee, senão 50% (padrão histórico do sistema).
export function descontoPercentual(s: State, username: string, product: Product): number {
  const cfg = s.descontosPorFuncionario[username]?.[product.id];
  if (cfg) return cfg.percentual;
  return product.freeForEmployee ? 100 : 50;
}

export function limiteDescontoFuncionario(s: State, username: string, productId: string): number | undefined {
  return s.descontosPorFuncionario[username]?.[productId]?.limite;
}

// Valor a descontar do funcionário por "qty" unidades de "product". Respeita o percentual e o
// limite de unidades com desconto configurados para aquele funcionário+produto — unidades além
// do limite são cobradas pelo preço cheio.
export function valorConsumoFuncionario(s: State, username: string, product: Product, qty: number): number {
  if (qty <= 0) return 0;
  const pct = descontoPercentual(s, username, product);
  const limite = limiteDescontoFuncionario(s, username, product.id);
  if (limite != null && qty > limite) {
    const comDesconto = limite * product.price * (1 - pct / 100);
    const semDesconto = (qty - limite) * product.price;
    return comDesconto + semDesconto;
  }
  return qty * product.price * (1 - pct / 100);
}

// Limite de unidades com desconto de uma CATEGORIA (pastel, caldo, bebida...) para o funcionário:
// é o MAIOR limite definido entre os produtos daquela categoria. Esse total vale para a categoria
// inteira (somando todos os sabores) — passou dele, o excedente é pago a 100%.
// Sem nenhum limite definido na categoria = sem limite (todas as unidades com desconto).
export function limiteCategoriaFuncionario(s: State, username: string, category: string): number | undefined {
  let maior: number | undefined;
  for (const p of getAllProducts(s)) {
    if (p.category !== category) continue;
    const l = s.descontosPorFuncionario[username]?.[p.id]?.limite;
    if (l != null && (maior == null || l > maior)) maior = l;
  }
  return maior;
}

// Valor a descontar do funcionário por UM lançamento de consumo (um ponto), item a item.
// Aplica o limite por categoria: as primeiras unidades (na ordem lançada) até o limite da
// categoria têm o desconto configurado; as demais da mesma categoria pagam 100% do preço —
// inclusive a água (grátis só dentro do limite). Sem limite na categoria: vale o desconto em tudo
// (e a água continua grátis).
export function valoresConsumoPonto(
  s: State, username: string, itens: { productId: string; qty: number }[],
): Record<string, number> {
  const produtos = getAllProducts(s);
  const restante: Record<string, number> = {};
  const out: Record<string, number> = {};
  for (const it of itens) {
    const p = produtos.find((x) => x.id === it.productId);
    if (!p || it.qty <= 0) { out[it.productId] = out[it.productId] ?? 0; continue; }
    const pct = descontoPercentual(s, username, p);
    const limCat = limiteCategoriaFuncionario(s, username, p.category);
    let valor: number;
    if (limCat == null) {
      valor = it.qty * p.price * (1 - pct / 100);
    } else {
      if (restante[p.category] == null) restante[p.category] = limCat;
      const comDesc = Math.min(it.qty, restante[p.category]);
      restante[p.category] -= comDesc;
      valor = comDesc * p.price * (1 - pct / 100) + (it.qty - comDesc) * p.price;
    }
    out[it.productId] = (out[it.productId] ?? 0) + valor;
  }
  return out;
}

export function valorConsumoPonto(s: State, username: string, itens: { productId: string; qty: number }[]): number {
  return Object.values(valoresConsumoPonto(s, username, itens)).reduce((a, b) => a + b, 0);
}

function prevShift(date: string, shift: ShiftKey): { date: string; shift: ShiftKey } {
  if (shift === "tarde") return { date, shift: "manha" };
  if (shift === "noite") return { date, shift: "tarde" };
  // manha inherits noite of previous day
  const d = new Date(date + "T00:00:00");
  d.setDate(d.getDate() - 1);
  const p = (n: number) => String(n).padStart(2, "0");
  return { date: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`, shift: "noite" };
}

const IDX_PERIODO: Record<string, number> = { manha: 0, tarde: 1, noite: 2 };
const chavePeriodo = (t: { date: string; shift: string }) => `${t.date}#${IDX_PERIODO[t.shift] ?? 9}`;

// Última sobra registrada de cada produto no histórico (do período mais recente para o mais antigo).
// Serve para reconstruir o estoque quando ele não existe neste aparelho (computador novo, dados do
// navegador limpos) — o histórico vem do Supabase, mas o estoque atual ficava só no navegador.
function sobrasDoHistorico(historico: Turno[]): Record<string, number> {
  const out: Record<string, number> = {};
  const ordenado = [...historico].sort((a, b) => chavePeriodo(b).localeCompare(chavePeriodo(a)));
  for (const t of ordenado) {
    for (const [pid, it] of Object.entries(t.items)) {
      if (out[pid] === undefined && it.sobra != null) out[pid] = it.sobra;
    }
  }
  return out;
}

// Entrada de cada produto para um turno na data/período informados:
// - turno novo (o mais recente): vale a quantidade em estoque atual (que o dono pode corrigir);
// - turno lançado "para trás" (já existe fechamento mais novo): vale a sobra do período anterior a ele;
// - se o estoque não existe neste aparelho, reconstrói pelas sobras do histórico.
function entradaHerdada(s: State, date: string, shift: ShiftKey): (productId: string) => number {
  const alvo = chavePeriodo({ date, shift });
  const anteriores = s.historico.filter((t) => chavePeriodo(t) < alvo).sort((a, b) => chavePeriodo(b).localeCompare(chavePeriodo(a)));
  const ref = anteriores[0];
  const maisRecente = s.historico.reduce<string>((m, t) => (chavePeriodo(t) > m ? chavePeriodo(t) : m), "");
  const retroativo = !!ref && chavePeriodo(ref) !== maisRecente;
  const doHist = sobrasDoHistorico(s.historico);
  return (pid) => {
    if (retroativo && ref) return ref.items[pid]?.sobra ?? s.estoqueQtd[pid] ?? doHist[pid] ?? 0;
    return s.estoqueQtd[pid] ?? doHist[pid] ?? 0;
  };
}

// Fechamento do período informado; se não existir, o mais próximo ANTES dele (assim um turno lançado
// em data antiga herda do período anterior, e não do fechamento mais novo do histórico).
function findLastClosed(s: State, date: string, shift: ShiftKey): Turno | undefined {
  const exato = s.historico.find((t) => t.date === date && t.shift === shift);
  if (exato) return exato;
  const alvo = chavePeriodo({ date, shift });
  return s.historico
    .filter((t) => chavePeriodo(t) < alvo)
    .sort((a, b) => chavePeriodo(b).localeCompare(chavePeriodo(a)))[0];
}

// Atualiza a quantidade em estoque de cada produto com a sobra registrada no turno informado.
function syncEstoqueFromTurno(estoqueQtd: Record<string, number>, t: Turno): Record<string, number> {
  const next = { ...estoqueQtd };
  for (const [pid, it] of Object.entries(t.items)) {
    if (it.sobra != null) next[pid] = it.sobra;
  }
  return next;
}

function previousCaixaFim(s: State, shift: ShiftKey, date: string): number {
  const prev = prevShift(date, shift);
  const t = findLastClosed(s, prev.date, prev.shift);
  if (!t) return 0;
  // dinheiroFinal - dinheiroMalote = dinheiro que ficou no caixa
  return (t.caixa.dinheiroFinal ?? 0) - (t.caixa.dinheiroMalote ?? 0);
}

function previousMoedasFinal(s: State, shift: ShiftKey, date: string): number {
  const prev = prevShift(date, shift);
  const t = findLastClosed(s, prev.date, prev.shift);
  return t ? (t.caixa.moedasFinal ?? 0) : 0;
}

function previousMaqBases(s: State, shift: ShiftKey, date: string): { maq1: number; maq2: number } {
  // Noite resets → base 0 for the "após 00:00" saved value... but we treat: base = last saved display value
  // Since noite saves "apos00" as final, next shift base = that value.
  const prev = prevShift(date, shift);
  const t = findLastClosed(s, prev.date, prev.shift);
  if (!t) return { maq1: 0, maq2: 0 };
  const savedFrom = (m: MaquininhaState, wasNoite: boolean) => wasNoite ? (m.apos00 ?? 0) : (m.display ?? 0);
  const wasNoite = t.shift === "noite";
  return {
    maq1: savedFrom(t.caixa.maq1, wasNoite),
    maq2: t.caixa.maq2Ativa ? savedFrom(t.caixa.maq2, wasNoite) : 0,
  };
}

// --------- Selectors / calculations ---------

export function vendeu(item: ShiftItem): number | null {
  // Considera preenchido se sobra, consumo, consumoEst ou descarte foram tocados
  const filled =
    item.sobra != null ||
    item.consumo > 0 ||
    (item.consumoEst != null && item.consumoEst > 0) ||
    item.descarte > 0;
  if (!filled) return null;
  const sobra = item.sobra ?? 0;
  // consumoEst = consumo do estabelecimento (gelo p/ gelar bebidas) → sai do estoque mas não é venda
  const total =
    item.entrada + (item.chegada ?? 0) - sobra - item.consumo - (item.consumoEst ?? 0) - item.descarte;
  return Math.max(0, total);
}

export function sobraOverflow(item: ShiftItem): boolean {
  return item.sobra != null && item.sobra > item.entrada + (item.chegada ?? 0);
}

// useLivePrice = true → usa o preço atual (state.precos), refletindo correções do dono em tempo real.
// useLivePrice = false (padrão) → usa o preço congelado no início do turno (precosSnapshot), preservando a
// exatidão dos relatórios históricos mesmo que o preço tenha mudado depois.
export function esperadoTurno(t: Turno, products: Product[], useLivePrice = false): number {
  let total = 0;
  for (const p of products) {
    if (!p.saleable) continue;
    const it = t.items[p.id]; if (!it) continue;
    const v = vendeu(it); if (v == null) continue;
    const price = useLivePrice ? p.price : (t.precosSnapshot[p.id] ?? p.price);
    total += v * price;
  }
  return total;
}

export function realMaq(m: MaquininhaState, shift: ShiftKey): number {
  if (shift === "noite") {
    const a = (m.ate00 ?? m.display) - m.base;
    const b = m.apos00 ?? 0;
    return Math.max(0, a) + Math.max(0, b);
  }
  return Math.max(0, (m.display ?? 0) - m.base);
}

export function arrecadadoTurno(t: Turno): number {
  const c = t.caixa;
  const maq1 = realMaq(c.maq1, t.shift);
  const maq2 = c.maq2Ativa ? realMaq(c.maq2, t.shift) : 0;
  // dinheiro = dinheiroFinal - malote (o que entrou de dinheiro no turno)
  // moedas = moedasFinal - moedasInicial (variação)
  const dinheiro = Math.max(0, (c.dinheiroFinal || 0) - (c.caixaFimPrev || 0));
  const moedas   = Math.max(0, (c.moedasFinal || 0) - (c.moedasInicial || 0));
  return dinheiro + moedas + (c.pix || 0) + (c.voucher || 0) + maq1 + maq2;
}

export interface ResumoPagamentos {
  dinheiro: number;
  moedas: number;
  pix: number;
  voucher: number;
  maq1Bruto: number;
  maq2Bruto: number;
}

// Soma, por tipo de pagamento, tudo o que foi arrecadado nos turnos fechados dentro do período.
export function resumoPagamentos(historico: Turno[], from: string, to: string): ResumoPagamentos {
  const r: ResumoPagamentos = { dinheiro: 0, moedas: 0, pix: 0, voucher: 0, maq1Bruto: 0, maq2Bruto: 0 };
  for (const t of historico) {
    if (t.date < from || t.date > to) continue;
    const c = t.caixa;
    r.dinheiro += Math.max(0, (c.dinheiroFinal || 0) - (c.caixaFimPrev || 0));
    r.moedas   += Math.max(0, (c.moedasFinal || 0) - (c.moedasInicial || 0));
    r.pix      += c.pix || 0;
    r.voucher  += c.voucher || 0;
    r.maq1Bruto += realMaq(c.maq1, t.shift);
    r.maq2Bruto += c.maq2Ativa ? realMaq(c.maq2, t.shift) : 0;
  }
  return r;
}

// Status do turno para exibição (Painel e Histórico usam exatamente a mesma regra):
// Arrecadado maior ou igual ao Esperado (com pequena tolerância) conta como "ok"; só é "falta"
// quando o arrecadado ficou realmente abaixo do esperado.
export function statusTurno(t: Turno, products: Product[]): "ok" | "falta" {
  const diff = arrecadadoTurno(t) - esperadoTurno(t, products);
  return diff > -0.5 ? "ok" : "falta";
}

/** Dinheiro que fica fisicamente no caixa após separar o malote */
export function dinheiroNoCaixa(c: Caixa): number {
  return Math.max(0, (c.dinheiroFinal || 0) - (c.dinheiroMalote || 0));
}

// --------- Context ---------

interface Ctx { state: State; dispatch: React.Dispatch<Action>; }
const StoreCtx = createContext<Ctx | null>(null);

// ============================================================================
// Retiradas de caixa, descontos por funcionário e configurações (Supabase)
// ============================================================================
const MIGRACAO_KEY = "barraca_migracao_banco_v19";

function retiradaFromRow(row: any): Retirada {
  return {
    id: row.id,
    date: row.date,
    valor: Number(row.valor),
    motivo: row.motivo,
    criadoEm: new Date(row.created_at).getTime(),
    origem: row.origem === "maq1" || row.origem === "maq2" ? row.origem : "dinheiro",
    tipo: row.tipo === "inclusao" ? "inclusao" : "retirada",
  };
}

function retiradaToRow(r: Retirada) {
  const base = { id: r.id, date: r.date, valor: r.valor, motivo: r.motivo, created_at: new Date(r.criadoEm).toISOString() };
  // A coluna "origem" só é enviada quando não é dinheiro — assim as retiradas de dinheiro continuam
  // funcionando mesmo antes de rodar o SQL que cria a coluna.
  const comOrigem = r.origem && r.origem !== "dinheiro" ? { ...base, origem: r.origem } : base;
  // Idem para "tipo": só vai quando é inclusão (precisa do adicionar_inclusao_dinheiro.sql)
  return ehInclusao(r) ? { ...comOrigem, tipo: "inclusao" } : comOrigem;
}

// Retirada é um lançamento único (não muda a cada tecla), então vai direto, sem atraso.
async function sincronizarRetirada(a: Action) {
  try {
    if (a.type === "ADD_RETIRADA") {
      const { error } = await supabase.from("retiradas").upsert(retiradaToRow(a.r), { onConflict: "id" });
      if (error) throw error;
    } else if (a.type === "REMOVE_RETIRADA") {
      const { error } = await supabase.from("retiradas").delete().eq("id", a.id);
      if (error) throw error;
    }
  } catch (e) {
    if (a.type === "ADD_RETIRADA" && ehInclusao(a.r) && ehColunaFaltando(e)) {
      alert("Para salvar inclusões de dinheiro no banco, rode o arquivo adicionar_inclusao_dinheiro.sql no SQL Editor do Supabase (até lá a inclusão vale só neste aparelho).");
    }
    throw e; // a fila decide: sem internet → reenvia; recusado pelo servidor → avisa na tela
  }
}

type DescontosMap = Record<string, Record<string, DescontoConfig>>;

function descontoToRow(username: string, productId: string, cfg: DescontoConfig) {
  return { employee_username: username, product_id: productId, percentual: cfg.percentual, limite: cfg.limite ?? null };
}

function descontosFromRows(rows: any[]): DescontosMap {
  const m: DescontosMap = {};
  for (const r of rows) {
    (m[r.employee_username] ??= {})[r.product_id] = {
      percentual: Number(r.percentual),
      limite: r.limite != null ? Number(r.limite) : undefined,
    };
  }
  return m;
}

function configToRow(c: ConfigGeral, t: TaxasMaquininha) {
  return {
    id: true,
    transporte_ida: c.transporteIda,
    transporte_volta: c.transporteVolta,
    refeicao: c.refeicao,
    taxa_maq1: t.maq1,
    taxa_maq2: t.maq2,
    // Os nomes só vão quando preenchidos — assim o app continua salvando mesmo antes de rodar o SQL
    // que cria as colunas nome_maq1 / nome_maq2.
    ...(t.nome1 != null ? { nome_maq1: t.nome1 } : {}),
    ...(t.nome2 != null ? { nome_maq2: t.nome2 } : {}),
  };
}

// Grava a configuração; se o banco ainda não tem as colunas dos nomes, grava sem eles.
async function gravarConfigRow(c: ConfigGeral, t: TaxasMaquininha) {
  const { error } = await supabase.from("config_geral").upsert(configToRow(c, t), { onConflict: "id" });
  if (!error) return null;
  if (t.nome1 != null || t.nome2 != null) {
    const { error: err2 } = await supabase
      .from("config_geral").upsert(configToRow(c, { ...t, nome1: undefined, nome2: undefined }), { onConflict: "id" });
    return err2;
  }
  return error;
}

// ---- Envio "em fila" e com pequeno atraso (para campos digitados: percentual, taxas, valores padrão) ----
// Cada chave tem a sua fila: as chamadas da mesma chave nunca se atropelam (a última sempre vence), e
// quem digita "30" não manda "3" e "30" como duas gravações soltas.
const pendentesSync = new Map<string, { timer: ReturnType<typeof setTimeout>; fn: () => Promise<void> }>();
const filasSync = new Map<string, Promise<void>>();

function enfileirarSync(chave: string, fn: () => Promise<void>) {
  const anterior = filasSync.get(chave) ?? Promise.resolve();
  filasSync.set(chave, anterior.catch(() => {}).then(fn));
}

function agendarSync(chave: string, fn: () => Promise<void>, atrasoMs = 400) {
  const existente = pendentesSync.get(chave);
  if (existente) clearTimeout(existente.timer);
  const timer = setTimeout(() => {
    pendentesSync.delete(chave);
    enfileirarSync(chave, fn);
  }, atrasoMs);
  pendentesSync.set(chave, { timer, fn });
}

function cancelarSyncPendente(chave: string) {
  const existente = pendentesSync.get(chave);
  if (existente) {
    clearTimeout(existente.timer);
    pendentesSync.delete(chave);
  }
}

// Se a aba for minimizada/fechada antes do atraso terminar, envia o que estiver pendente na hora.
function flushSyncPendentes() {
  for (const [chave, { timer, fn }] of Array.from(pendentesSync.entries())) {
    clearTimeout(timer);
    pendentesSync.delete(chave);
    enfileirarSync(chave, fn);
  }
}

// ---- Carregamento inicial (e subida única do que já existia só neste aparelho) ----
// "migrar" = primeira vez que este aparelho se conecta ao banco: o que foi lançado antes (e só existe
// aqui no navegador) sobe para o Supabase em vez de sumir da tela.
async function carregarRetiradas(
  dispatch: React.Dispatch<Action>, local: Partial<State>, migrar: boolean,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("retiradas").select("*")
    .order("date", { ascending: false }).order("created_at", { ascending: false });
  if (error) {
    // eslint-disable-next-line no-console
    console.error("Não foi possível carregar as retiradas do Supabase:", error);
    return false;
  }
  const doBanco = (data ?? []).map(retiradaFromRow);
  // Retiradas/inclusões lançadas aqui que ainda esperam a internet continuam aparecendo
  const idsBanco = new Set(doBanco.map((r) => r.id));
  for (const p of pendentesDoTipo<Action>("retirada")) {
    if (p.type === "ADD_RETIRADA" && !idsBanco.has(p.r.id)) doBanco.push(p.r);
  }
  let soLocais: Retirada[] = [];
  let ok = true;
  if (migrar) {
    const ids = new Set(doBanco.map((r) => r.id));
    soLocais = (local.retiradas ?? []).filter((r) => !ids.has(r.id));
    if (soLocais.length > 0) {
      const { error: errUp } = await supabase.from("retiradas").upsert(soLocais.map(retiradaToRow), { onConflict: "id" });
      if (errUp) {
        ok = false;
        // eslint-disable-next-line no-console
        console.error("Não foi possível enviar as retiradas antigas para o Supabase:", errUp);
      }
    }
  }
  const todas = [...doBanco, ...soLocais].sort((a, b) => b.date.localeCompare(a.date) || b.criadoEm - a.criadoEm);
  dispatch({ type: "SET_RETIRADAS_FROM_DB", retiradas: todas });
  return ok;
}

async function carregarDescontos(
  dispatch: React.Dispatch<Action>, local: Partial<State>, migrar: boolean,
): Promise<boolean> {
  const { data, error } = await supabase.from("descontos_funcionario").select("*");
  if (error) {
    // eslint-disable-next-line no-console
    console.error("Não foi possível carregar os descontos do Supabase:", error);
    return false;
  }
  const merged = descontosFromRows(data ?? []);
  let ok = true;
  if (migrar) {
    for (const [username, produtos] of Object.entries(local.descontosPorFuncionario ?? {})) {
      for (const [productId, cfg] of Object.entries(produtos)) {
        if (merged[username]?.[productId]) continue; // o banco já tem esse — vale o do banco
        const { error: errUp } = await supabase
          .from("descontos_funcionario")
          .upsert(descontoToRow(username, productId, cfg), { onConflict: "employee_username,product_id" });
        if (errUp && errUp.code !== "23503") ok = false; // 23503 = funcionário/produto que não existe no banco
        if (errUp) {
          // eslint-disable-next-line no-console
          console.warn("Desconto antigo não enviado ao Supabase:", username, productId, errUp.message);
        }
        (merged[username] ??= {})[productId] = cfg;
      }
    }
  }
  dispatch({ type: "SET_DESCONTOS_FROM_DB", descontos: merged });
  return ok;
}

const configEhPadrao = (c: ConfigGeral, t: TaxasMaquininha) =>
  c.transporteIda === 0 && c.transporteVolta === 0 && c.refeicao === 15 && t.maq1 === 0 && t.maq2 === 0;

async function carregarConfig(
  dispatch: React.Dispatch<Action>, local: Partial<State>, migrar: boolean,
): Promise<boolean> {
  const { data, error } = await supabase.from("config_geral").select("*").limit(1);
  if (error) {
    // eslint-disable-next-line no-console
    console.error("Não foi possível carregar as configurações do Supabase:", error);
    return false;
  }
  const row = data?.[0];
  const doBanco = row
    ? {
        cfg: { transporteIda: Number(row.transporte_ida), transporteVolta: Number(row.transporte_volta), refeicao: Number(row.refeicao) },
        taxas: {
          maq1: Number(row.taxa_maq1), maq2: Number(row.taxa_maq2),
          nome1: row.nome_maq1 ?? undefined, nome2: row.nome_maq2 ?? undefined,
        },
      }
    : null;
  const localCfg = local.configGeral;
  const localTaxas = local.taxasMaquininha;
  const localTemValores = !!localCfg && !!localTaxas && !configEhPadrao(localCfg, localTaxas);

  // Banco ainda "zerado" (padrão) e este aparelho já tinha valores próprios: sobe os valores daqui.
  const subirLocal = migrar && localTemValores && (!doBanco || configEhPadrao(doBanco.cfg, doBanco.taxas));
  if (subirLocal && localCfg && localTaxas) {
    const errUp = await gravarConfigRow(localCfg, localTaxas);
    if (errUp) {
      // eslint-disable-next-line no-console
      console.error("Não foi possível enviar as configurações para o Supabase:", errUp);
      return false;
    }
    return true; // a tela já está com esses valores
  }
  if (doBanco) {
    dispatch({ type: "SET_CONFIG_FROM_DB", configGeral: doBanco.cfg, taxasMaquininha: doBanco.taxas });
  }
  return true;
}

// ---- Produtos (tabela "produtos"): preço, produtos cadastrados pelo dono, removidos e estoque ----
// Antes isso ficava só no navegador de cada aparelho: o preço trocado pelo dono não chegava ao tablet do
// funcionário. Agora o banco é a referência e todo aparelho carrega dele ao abrir (e ao voltar para o app).
const MIGRACAO_PRODUTOS_KEY = "barraca_migracao_produtos_v1";
const IDS_PADRAO = new Set(DEFAULT_PRODUCTS.map((p) => p.id));

function acharProduto(s: State, id: string): Product | undefined {
  return DEFAULT_PRODUCTS.find((p) => p.id === id) ?? s.bebidas.find((p) => p.id === id);
}

function produtoToRow(s: State, p: Product) {
  const idxPadrao = DEFAULT_PRODUCTS.findIndex((x) => x.id === p.id);
  return {
    id: p.id,
    nome: p.name,
    categoria: p.category,
    preco: s.precos[p.id] ?? p.price,
    saleable: p.saleable,
    free_for_employee: !!p.freeForEmployee,
    special: !!p.special,
    decimal_qty: !!p.decimal,
    ordem: idxPadrao >= 0 ? idxPadrao : 1000 + Math.max(0, s.bebidas.findIndex((x) => x.id === p.id)),
  };
}

function produtoFromRow(row: any): Product {
  return {
    id: row.id,
    name: row.nome,
    price: Number(row.preco) || 0,
    category: row.categoria,
    saleable: row.saleable !== false,
    freeForEmployee: !!row.free_for_employee || undefined,
    special: !!row.special || undefined,
    decimal: !!row.decimal_qty || undefined,
  };
}

// Erro de coluna inexistente (o SQL adicionar_estoque_produtos.sql ainda não foi rodado)
const ehColunaFaltando = (e: any) =>
  e?.code === "42703" || e?.code === "PGRST204" || /column/i.test(String(e?.message ?? ""));
let avisouSqlProdutos = false;
function avisarSqlProdutos() {
  if (avisouSqlProdutos) return;
  avisouSqlProdutos = true;
  // eslint-disable-next-line no-console
  console.warn("Banco sem as colunas de estoque/ativo em 'produtos': rode adicionar_estoque_produtos.sql no SQL Editor do Supabase.");
}

// Envia o produto inteiro (nome, categoria, preço...). Usado quando o dono cadastra ou troca o preço.
// Produto inteiro (nome, categoria, preço...): quando o dono cadastra ou troca o preço. A linha é montada
// na hora do lançamento e vai para a fila (se estiver sem internet, é enviada depois).
function enviarPrecoProduto(s: State, id: string) {
  const p = acharProduto(s, id);
  if (!p) return;
  enviar("produto", produtoToRow(s, p), { chave: `produto:${id}` });
}

async function gravarProdutoRow(row: ReturnType<typeof produtoToRow>) {
  try {
    const { error } = await supabase.from("produtos").upsert(row, { onConflict: "id" });
    if (error) throw error;
  } catch (e) {
    throw e; // a fila decide: sem internet → reenvia; recusado pelo servidor → avisa na tela
  }
}

// Envia só o estoque (não mexe no preço — um aparelho desatualizado nunca desfaz o preço do dono)
function enviarEstoqueProduto(s: State, id: string) {
  enviar("estoque", { id, estoque_qtd: s.estoqueQtd[id] ?? null, estoque_minimo: s.estoqueMinimo[id] ?? null }, { chave: `estoque:${id}` });
}

async function gravarEstoqueProduto(d: { id: string; estoque_qtd: number | null; estoque_minimo: number | null }) {
  try {
    const { error } = await supabase
      .from("produtos")
      .update({ estoque_qtd: d.estoque_qtd, estoque_minimo: d.estoque_minimo })
      .eq("id", d.id);
    if (error) throw error;
  } catch (e) {
    if (ehColunaFaltando(e)) return avisarSqlProdutos();
    throw e; // a fila decide: sem internet → reenvia; recusado pelo servidor → avisa na tela
  }
}

async function removerProdutoSupabase(id: string) {
  try {
    const { error } = await supabase.from("produtos").update({ ativo: false }).eq("id", id);
    if (error) throw error;
  } catch (e) {
    if (ehColunaFaltando(e)) {
      avisarSqlProdutos();
      alert("Para remover produtos em todos os aparelhos, rode o arquivo adicionar_estoque_produtos.sql no SQL Editor do Supabase (até lá a remoção vale só neste aparelho).");
      return;
    }
    throw e; // a fila decide: sem internet → reenvia; recusado pelo servidor → avisa na tela
  }
}

async function carregarProdutos(
  dispatch: React.Dispatch<Action>, local: Partial<State>, migrar: boolean, antesDeAplicar?: () => void,
): Promise<boolean> {
  const { data, error } = await supabase.from("produtos").select("*");
  if (error) {
    // eslint-disable-next-line no-console
    console.error("Não foi possível carregar os produtos do Supabase:", error);
    return false;
  }
  const rows = data ?? [];
  const temColunaAtivo = rows.some((r: any) => "ativo" in r);
  const precos: Record<string, number> = {};
  const estoqueQtd: Record<string, number> = {};
  const estoqueMinimo: Record<string, number> = {};
  const bebidas: Product[] = [];
  const removedProductIds: string[] = [];
  const ordenadas = [...rows].sort((a: any, b: any) => (a.ordem ?? 0) - (b.ordem ?? 0));
  for (const r of ordenadas) {
    if (r.preco != null) precos[r.id] = Number(r.preco);
    if (r.estoque_qtd != null) estoqueQtd[r.id] = Number(r.estoque_qtd);
    if (r.estoque_minimo != null) estoqueMinimo[r.id] = Number(r.estoque_minimo);
    if (r.ativo === false) removedProductIds.push(r.id);
    if (!IDS_PADRAO.has(r.id)) bebidas.push(produtoFromRow(r));
  }

  let ok = true;
  if (migrar) {
    // Primeira vez deste aparelho com produtos no banco: o que só existia aqui sobe para o banco.
    // Preço: só sobe se foi trocado neste aparelho e o banco ainda está com o preço original.
    const idsDb = new Set(rows.map((r: any) => r.id));
    const localState = { ...local, precos: local.precos ?? {}, bebidas: local.bebidas ?? [] } as State;
    const subir: any[] = [];
    for (const p of DEFAULT_PRODUCTS) {
      const lp = localState.precos[p.id];
      const dbp = precos[p.id];
      if (lp != null && lp !== p.price && (dbp == null || dbp === p.price)) {
        subir.push(produtoToRow(localState, p));
        precos[p.id] = lp;
      }
    }
    for (const b of localState.bebidas) {
      if (!idsDb.has(b.id)) subir.push(produtoToRow(localState, b));
    }
    if (subir.length > 0) {
      const { error: errUp } = await supabase.from("produtos").upsert(subir, { onConflict: "id" });
      if (errUp) {
        ok = false;
        // eslint-disable-next-line no-console
        console.error("Não foi possível enviar os produtos deste aparelho para o Supabase:", errUp);
      }
    }
    if (temColunaAtivo) {
      for (const id of local.removedProductIds ?? []) {
        if (removedProductIds.includes(id)) continue;
        const { error: errRm } = await supabase.from("produtos").update({ ativo: false }).eq("id", id);
        if (errRm) ok = false;
      }
    }
  }

  antesDeAplicar?.();
  dispatch({
    type: "SET_PRODUTOS_FROM_DB",
    precos, bebidas, estoqueQtd, estoqueMinimo,
    removedProductIds: temColunaAtivo ? removedProductIds : undefined,
  });
  return ok;
}

// ---- Ajustes semanais da folha (tabela "folha_ajustes", criada pelo folha_semanal.sql) ----
const tabelaFaltando = (e: any) =>
  e?.code === "42P01" || e?.code === "PGRST205" || /relation .* does not exist|Could not find the table/i.test(String(e?.message ?? ""));
let avisouSqlFolha = false;

async function carregarAjustesFolha(dispatch: React.Dispatch<Action>) {
  const { data, error } = await supabase.from("folha_ajustes").select("*");
  if (error) {
    // eslint-disable-next-line no-console
    if (!tabelaFaltando(error)) console.error("Não foi possível carregar os ajustes da folha do Supabase:", error);
    return;
  }
  const ajustes: Record<string, AjusteFolha> = {};
  for (const r of data ?? []) {
    ajustes[`${r.employee_username}|${String(r.semana_inicio).slice(0, 10)}`] = {
      adicional: Number(r.adicional) || 0,
      desconto: Number(r.desconto) || 0,
      observacao: r.observacao ?? undefined,
    };
  }
  dispatch({ type: "SET_AJUSTES_FOLHA_FROM_DB", ajustes });
}

function enviarAjusteFolha(s: State, username: string, semana: string) {
  const a = s.ajustesFolha[`${username}|${semana}`];
  if (!a) return;
  enviar("ajusteFolha", {
    employee_username: username, semana_inicio: semana,
    adicional: a.adicional || 0, desconto: a.desconto || 0, observacao: a.observacao?.trim() || null,
  }, { chave: `ajuste:${username}|${semana}` });
}

async function gravarAjusteFolha(row: Record<string, unknown>) {
  try {
    const { error } = await supabase.from("folha_ajustes").upsert(row, { onConflict: "employee_username,semana_inicio" });
    if (error) throw error;
  } catch (e) {
    if (tabelaFaltando(e)) {
      if (!avisouSqlFolha) {
        avisouSqlFolha = true;
        alert("Para salvar o adicional/desconto da semana no banco, rode o arquivo folha_semanal.sql no SQL Editor do Supabase (até lá ele vale só neste aparelho).");
      }
      return;
    }
    throw e; // a fila decide: sem internet → reenvia; recusado pelo servidor → avisa na tela
  }
}

// ---- Fila de envio: o que cada tipo de lançamento faz no Supabase (ver lib/fila.ts) ----
// Turno: vai a foto completa do turno; uma nova foto do mesmo turno substitui a que estava esperando.
const enviarTurno = (t: Turno) => enviar("turno", t, { chave: `turno:${t.id}` });
const enviarExclusaoTurno = (id: string) => enviar("turnoExcluir", id, { chave: `turno-excluir:${id}`, cancelar: [`turno:${id}`] });

async function gravarDesconto(row: ReturnType<typeof descontoToRow>) {
  const { error } = await supabase.from("descontos_funcionario").upsert(row, { onConflict: "employee_username,product_id" });
  if (error) throw error;
}
async function removerDesconto(d: { username: string; productId: string }) {
  const { error } = await supabase.from("descontos_funcionario").delete().eq("employee_username", d.username).eq("product_id", d.productId);
  if (error) throw error;
}
async function gravarConfig(d: { cfg: ConfigGeral; taxas: TaxasMaquininha }) {
  const error = await gravarConfigRow(d.cfg, d.taxas);
  if (error) throw error;
}

registrarExecutor("turno", (t: Turno) => sincronizarTurnoCompleto(t));
registrarExecutor("turnoExcluir", (id: string) => excluirTurnoSupabase(id));
registrarExecutor("funcionario", (a: Action) => sincronizarFuncionario(a));
registrarExecutor("ponto", (a: Action) => sincronizarPonto(a));
registrarExecutor("retirada", (a: Action) => sincronizarRetirada(a));
registrarExecutor("produto", gravarProdutoRow);
registrarExecutor("estoque", gravarEstoqueProduto);
registrarExecutor("produtoRemover", (id: string) => removerProdutoSupabase(id));
registrarExecutor("desconto", gravarDesconto);
registrarExecutor("descontoRemover", removerDesconto);
registrarExecutor("config", gravarConfig);
registrarExecutor("ajusteFolha", gravarAjusteFolha);

const raw0 = (salvo: Partial<State>): State | null =>
  Object.keys(salvo).length > 0 ? { ...initialState(), ...salvo } : null;

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, initialState);
  // Sempre aponta para o estado mais recente — usado nos envios com atraso (leem o valor na hora de enviar)
  const stateRef = useRef(state);
  stateRef.current = state;

  // Regras de envio dos turnos: só o que a pessoa mexeu NESTE aparelho vai para o banco. Antes, ao abrir o
  // app, o histórico guardado no navegador era reenviado inteiro — um tablet desatualizado desfazia as
  // correções do dono e trazia de volta fechamentos que ele tinha excluído.
  const turnosCarregadosRef = useRef(false); // terminou a 1ª leitura dos turnos no banco
  const turnoSujoRef = useRef(false);        // turno em andamento foi alterado aqui e precisa ser enviado
  const histPendentesRef = useRef(new Set<string>()); // fechamentos (fechados/corrigidos aqui) a enviar
  // Estoque (quantidade e alerta): só é enviado depois de uma ação feita aqui, nunca por um carregamento
  const estoqueSujoRef = useRef(false);
  const estoqueBaseRef = useRef({ q: state.estoqueQtd, m: state.estoqueMinimo });

  useEffect(() => {
    // 1) Carrega o que está guardado no navegador (aparece na hora, mesmo sem internet)
    let localSalvo: Partial<State> = {};
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) localSalvo = JSON.parse(raw);
    } catch {}
    dispatch({ type: "HYDRATE", state: raw0(localSalvo) });

    // Antes de ler o banco, envia o que ficou guardado neste aparelho sem internet — assim o que vier
    // do banco já inclui esses lançamentos.
    const filaEnviada = processar();

    // 2) Carrega os funcionários do Supabase — a partir de agora, a lista de funcionários
    // (cadastro, senha, taxa por hora, etc.) mora no banco, não mais só no navegador.
    (async () => {
      await filaEnviada;
      let { data, error } = await supabase.from("funcionarios").select("*").order("created_at");
      if (error?.code === "42501") {
        // Depois do seguranca_login.sql a coluna de senha não pode ser lida: busca as demais
        ({ data, error } = await supabase.from("funcionarios").select(COLUNAS_FUNCIONARIO).order("created_at"));
      }
      if (error) {
        // eslint-disable-next-line no-console
        console.error("Não foi possível carregar os funcionários do Supabase:", error);
        return;
      }
      dispatch({ type: "SET_FUNCIONARIOS", funcionarios: (data ?? []).map(funcionarioFromRow) });
    })();

    // 3) Carrega o turno em andamento (se houver) e o histórico de turnos fechados do Supabase.
    // Se der erro de conexão, mantém o que está no aparelho (não apaga nada nem sobrescreve o banco).
    (async () => {
      await filaEnviada;
      try {
        const { data: ativoRows, error: errAtivo } = await supabase
          .from("turnos").select("*").is("closed_at", null)
          .order("created_at", { ascending: false }).limit(1);
        if (errAtivo) throw errAtivo;
        let turnoAtivo: Turno | null = null;
        if (ativoRows && ativoRows.length > 0) {
          const row = ativoRows[0];
          const { data: itemRows, error: errItens } = await supabase.from("turno_itens").select("*").eq("turno_id", row.id);
          if (errItens) throw errItens;
          const items: Record<string, ShiftItem> = {};
          for (const ir of itemRows ?? []) items[ir.product_id] = shiftItemFromRow(ir);
          turnoAtivo = turnoFromRow(row, items);
        }

        const { data: histRows, error: errHist } = await supabase
          .from("turnos").select("*").not("closed_at", "is", null).order("date", { ascending: false });
        if (errHist) throw errHist;
        let historico: Turno[] = [];
        if (histRows && histRows.length > 0) {
          const ids = histRows.map((r: any) => r.id);
          const allItemRows = await buscarEmLotes("turno_itens", "turno_id", ids);
          const itemsByTurno: Record<string, Record<string, ShiftItem>> = {};
          for (const ir of allItemRows ?? []) {
            (itemsByTurno[ir.turno_id] ??= {})[ir.product_id] = shiftItemFromRow(ir);
          }
          historico = histRows.map((row: any) => turnoFromRow(row, itemsByTurno[row.id] ?? {}));
        }

        // Turnos ainda esperando a internet neste aparelho: a versão daqui vale (é a mais nova)
        const excluidosAqui = new Set(pendentesDoTipo<string>("turnoExcluir"));
        historico = historico.filter((t) => !excluidosAqui.has(t.id));
        if (turnoAtivo && excluidosAqui.has(turnoAtivo.id)) turnoAtivo = null;
        for (const t of pendentesDoTipo<Turno>("turno")) {
          if (t.closedAt) {
            historico = [t, ...historico.filter((h) => h.id !== t.id)];
            if (turnoAtivo?.id === t.id) turnoAtivo = null;
          } else if (!turnoAtivo || turnoAtivo.id === t.id) {
            turnoAtivo = t;
          }
        }

        // O que veio do banco substitui o que estava no aparelho; nada disso é reenviado.
        turnoSujoRef.current = false;
        estoqueSujoRef.current = false;
        dispatch({ type: "SET_TURNOS_FROM_DB", turnoAtivo, historico });
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error("Não foi possível carregar os turnos do Supabase (usando os dados deste aparelho):", e);
      } finally {
        turnosCarregadosRef.current = true;
      }
    })();

    // 4) Carrega os registros de ponto (e o consumo de cada um) do Supabase
    (async () => {
      await filaEnviada;
      const { data: pontoRows, error: errPontos } = await supabase
        .from("pontos").select("*").order("date", { ascending: false });
      if (errPontos) {
        // eslint-disable-next-line no-console
        console.error("Não foi possível carregar os pontos do Supabase:", errPontos);
        return;
      }
      let pontos: Ponto[] = [];
      if (pontoRows && pontoRows.length > 0) {
        const ids = pontoRows.map((r: any) => r.id);
        const consumoRows = await buscarEmLotes("ponto_consumo", "ponto_id", ids);
        const consumoByPonto: Record<string, PontoConsumoItem[]> = {};
        for (const cr of consumoRows ?? []) {
          (consumoByPonto[cr.ponto_id] ??= []).push({ productId: cr.product_id, qty: cr.qty });
        }
        pontos = pontoRows.map((row: any) => pontoFromRow(row, consumoByPonto[row.id] ?? []));
      }
      dispatch({ type: "SET_PONTOS_FROM_DB", pontos });
    })();

    // 5) Retiradas de caixa, descontos por funcionário e configurações (valores padrão + taxas das maquininhas)
    (async () => {
      await filaEnviada;
      let migrar = false;
      try { migrar = localStorage.getItem(MIGRACAO_KEY) !== "1"; } catch {}
      const resultados = await Promise.all([
        carregarRetiradas(dispatch, localSalvo, migrar),
        carregarDescontos(dispatch, localSalvo, migrar),
        carregarConfig(dispatch, localSalvo, migrar),
      ]);
      if (migrar && resultados.every(Boolean)) {
        try { localStorage.setItem(MIGRACAO_KEY, "1"); } catch {}
      }
    })();

    // 7) Adicional/desconto de cada semana (fechamento semanal da folha)
    void filaEnviada.then(() => carregarAjustesFolha(dispatch));

    // 6) Produtos: preços, produtos cadastrados pelo dono, removidos e estoque
    (async () => {
      await filaEnviada;
      let migrar = false;
      try { migrar = localStorage.getItem(MIGRACAO_PRODUTOS_KEY) !== "1"; } catch {}
      const ok = await carregarProdutos(dispatch, localSalvo, migrar, () => { estoqueSujoRef.current = false; });
      if (migrar && ok) {
        try { localStorage.setItem(MIGRACAO_PRODUTOS_KEY, "1"); } catch {}
      }
    })();
  }, []);

  // Sincroniza o turno em andamento com o Supabase quando ele é alterado neste aparelho (chegada, sobra,
  // caixa, abertura, correção...). Espera meio segundo após a última mudança antes de enviar — o bastante
  // para não mandar uma chamada a cada tecla, mas rápido o suficiente para não se perder se a aba fechar.
  const turnoAtivoAnteriorRef = useRef<Turno | null>(null);
  const turnoSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelarSincronizacaoTurno = () => {
    if (turnoSyncTimerRef.current) {
      clearTimeout(turnoSyncTimerRef.current);
      turnoSyncTimerRef.current = null;
    }
  };

  const flushSincronizacaoTurno = () => {
    if (turnoSyncTimerRef.current) {
      cancelarSincronizacaoTurno();
      if (turnoAtivoAnteriorRef.current) enviarTurno(turnoAtivoAnteriorRef.current);
    }
  };

  useEffect(() => {
    turnoAtivoAnteriorRef.current = state.turnoAtivo;
    // Mudança que veio do carregamento (navegador ou banco) não é reenviada. Alterações feitas antes do
    // banco responder ficam esperando: o que vier do banco vale.
    if (!state.turnoAtivo || !turnoSujoRef.current || !turnosCarregadosRef.current) return;
    turnoSujoRef.current = false;
    const turno = state.turnoAtivo;
    cancelarSincronizacaoTurno();
    turnoSyncTimerRef.current = setTimeout(() => {
      turnoSyncTimerRef.current = null;
      enviarTurno(turno);
    }, 500);
  }, [state.turnoAtivo]);

  // Recarrega os produtos (preço, estoque) ao voltar para o app — o dono pode ter mudado algo em outro aparelho
  const recarregarProdutos = () => {
    void carregarProdutos(dispatch, {}, false, () => { estoqueSujoRef.current = false; });
  };

  // Segurança extra: se a pessoa minimizar, trocar de app ou fechar a aba antes dos 500ms
  // terminarem, manda o que estiver pendente imediatamente, sem esperar.
  useEffect(() => {
    const flushTudo = () => { flushSincronizacaoTurno(); flushSyncPendentes(); };
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") flushTudo();
      else { void processar(); recarregarProdutos(); }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pagehide", flushTudo);
    // Sem internet: tenta reenviar o que está esperando a cada 20 segundos
    const tentarDeNovo = setInterval(() => { void processar(); }, 20000);
    return () => {
      clearInterval(tentarDeNovo);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pagehide", flushTudo);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Envia só os fechamentos que foram fechados ou corrigidos neste aparelho (não o histórico inteiro).
  useEffect(() => {
    const pendentes = histPendentesRef.current;
    if (pendentes.size === 0) return;
    for (const t of state.historico) {
      if (pendentes.has(t.id)) {
        pendentes.delete(t.id);
        enviarTurno(t);
      }
    }
  }, [state.historico]);

  // Estoque: envia os produtos cuja quantidade/alerta mudou por uma ação feita aqui
  useEffect(() => {
    const antes = estoqueBaseRef.current;
    estoqueBaseRef.current = { q: state.estoqueQtd, m: state.estoqueMinimo };
    if (!estoqueSujoRef.current) return;
    estoqueSujoRef.current = false;
    const ids = new Set([...Object.keys(state.estoqueQtd), ...Object.keys(state.estoqueMinimo)]);
    for (const id of ids) {
      if (antes.q[id] === state.estoqueQtd[id] && antes.m[id] === state.estoqueMinimo[id]) continue;
      agendarSync(`estoque:${id}`, async () => enviarEstoqueProduto(stateRef.current, id));
    }
  }, [state.estoqueQtd, state.estoqueMinimo]);

  // A tela sempre atualiza na hora (não espera a internet); o envio para o Supabase acontece
  // em paralelo, "por trás".
  const dispatchComSincronizacao: React.Dispatch<Action> = (a) => {
    const antes = stateRef.current;
    dispatch(a);
    if (
      a.type === "SET_ESTOQUE_QTD" || a.type === "SET_ESTOQUE_MINIMO" || a.type === "CLOSE_SHIFT" ||
      a.type === "EDIT_HIST" || a.type === "EDIT_ATIVO" || a.type === "DELETE_TURNO"
    ) {
      estoqueSujoRef.current = true;
    }
    if (
      a.type === "START_SHIFT" || a.type === "UPDATE_ITEM" || a.type === "SYNC_TURNO_ITEMS" ||
      a.type === "UPDATE_CAIXA" || a.type === "UPDATE_MAQ" || a.type === "EDIT_ATIVO"
    ) {
      turnoSujoRef.current = true;
    }

    if (a.type === "CLOSE_SHIFT") {
      // O envio pendente do turno aberto é cancelado: quem vai para o banco é a versão fechada
      if (!antes.turnoAtivo) return;
      cancelarSincronizacaoTurno();
      turnoSujoRef.current = false;
      histPendentesRef.current.add(antes.turnoAtivo.id);
    } else if (a.type === "EDIT_HIST") {
      histPendentesRef.current.add(a.id);
    } else if (a.type === "DISCARD_SHIFT") {
      if (!antes.turnoAtivo) return;
      cancelarSincronizacaoTurno();
      turnoSujoRef.current = false;
      enviarExclusaoTurno(antes.turnoAtivo.id);
    } else if (a.type === "DELETE_TURNO") {
      // Remove do Supabase (os itens do turno somem junto) e cancela qualquer envio pendente dele
      if (antes.turnoAtivo?.id === a.id) {
        cancelarSincronizacaoTurno();
        turnoSujoRef.current = false;
      }
      histPendentesRef.current.delete(a.id);
      enviarExclusaoTurno(a.id);
    } else if (a.type === "ADD_FUNC" || a.type === "UPDATE_FUNC" || a.type === "REMOVE_FUNC") {
      enviar("funcionario", a);
    } else if (a.type === "ADD_PONTO" || a.type === "REMOVE_PONTO" || a.type === "UPDATE_PONTO" || a.type === "UPDATE_PONTO_CONSUMO") {
      enviar("ponto", a, a.type === "UPDATE_PONTO_CONSUMO" ? { chave: `pc:${a.pontoId}|${a.productId}` } : {});
    } else if (a.type === "ADD_RETIRADA" || a.type === "REMOVE_RETIRADA") {
      enviar("retirada", a);
    } else if (a.type === "ADD_PRODUCT") {
      // Produto novo vai para o banco junto com o preço (o estado ainda não tem o produto: monta na hora)
      const s = { ...antes, bebidas: [...antes.bebidas, a.b], precos: { ...antes.precos, [a.b.id]: a.b.price } };
      enviarPrecoProduto(s, a.b.id);
    } else if (a.type === "SET_PRICE") {
      // Lê o preço na hora do envio (estado mais recente), então digitar "12" grava 12, não "1"
      agendarSync(`preco:${a.productId}`, async () => enviarPrecoProduto(stateRef.current, a.productId));
    } else if (a.type === "REMOVE_PRODUCT") {
      enviar("produtoRemover", a.productId, { chave: `produto-remover:${a.productId}` });
    } else if (a.type === "SET_DESCONTO_FUNCIONARIO") {
      // O valor é lido na hora do envio (estado mais recente), então digitar "30" grava 30, não "3"
      const chave = `desconto:${a.username}|${a.productId}`;
      agendarSync(chave, async () => {
        const cfg = stateRef.current.descontosPorFuncionario[a.username]?.[a.productId];
        if (cfg) enviar("desconto", descontoToRow(a.username, a.productId, cfg), { chave });
      });
    } else if (a.type === "REMOVE_DESCONTO_FUNCIONARIO") {
      const chave = `desconto:${a.username}|${a.productId}`;
      cancelarSyncPendente(chave);
      // Mesma chave do envio do desconto: se ele ainda estava esperando a internet, a remoção o substitui
      enviar("descontoRemover", { username: a.username, productId: a.productId }, { chave });
    } else if (a.type === "SET_AJUSTE_FOLHA") {
      // Lido na hora do envio: digitar "30" grava 30, não "3"
      agendarSync(`ajuste:${a.username}|${a.semana}`, async () => enviarAjusteFolha(stateRef.current, a.username, a.semana));
    } else if (a.type === "SET_CONFIG_GERAL" || a.type === "SET_TAXAS_MAQUININHA") {
      agendarSync("config_geral", async () => {
        const st = stateRef.current;
        enviar("config", { cfg: st.configGeral, taxas: st.taxasMaquininha }, { chave: "config" });
      });
    }
  };

  return <StoreCtx.Provider value={{ state, dispatch: dispatchComSincronizacao }}>{children}</StoreCtx.Provider>;
}

export function useStore() {
  const c = useContext(StoreCtx);
  if (!c) throw new Error("StoreProvider missing");
  return c;
}
