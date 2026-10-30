import { vendeu, esperadoTurno, arrecadadoTurno, realMaq, dinheiroNoCaixa, nomeMaquina, type Turno, type Funcionario, type TaxasMaquininha } from "./store";
import { EXCLUIR_DO_TOTAL_PASTEL, type Category, type Product } from "./products";
import { BRL, formatDateBR, shiftLabel } from "./format";

const CATEGORIAS: { key: Category; label: string }[] = [
  { key: "pastel", label: "Pastéis" },
  { key: "caldo", label: "Caldo de cana" },
  { key: "bebida", label: "Bebidas" },
  { key: "outros", label: "Outros" },
];

export interface GrupoSobras {
  categoria: string;
  linhas: { produto: string; sobra: string }[];
  totalPasteis?: number; // só no grupo de pastéis (não soma casquinha crua e frita)
}

export interface MaquininhaRelatorio {
  nome: string;
  anterior: number;            // valor do turno anterior (base)
  lancado: number;             // valor exibido (dia) ou até 00:00 (noite)
  apos00?: number;             // só na noite: valor depois da meia-noite (a maquininha zera)
  real: number;                // vendido nela neste turno
}

// Entradas do turno por produto: entrada (estoque com que o turno começou) + chegada = total que entrou
export interface LinhaEntrada { produto: string; entrada: string; chegada: string; total: string }
export interface GrupoEntradas { categoria: string; linhas: LinhaEntrada[]; total?: string }

export interface VendidoRelatorio { item: string; qtd: string }

export interface ConsumoRelatorio { produto: string; funcionarios: number; barraca: number; descarte: number }

export interface RelatorioSobras {
  data: string;        // dd/mm/aaaa
  turno: string;       // Manhã / Tarde / Noite
  abertoPor: string;   // quem abriu o turno
  fechadoPor: string;  // quem fechou o turno (se não registrado, quem abriu)
  colegas: string[];   // demais funcionários que trabalharam no turno
  grupos: GrupoSobras[];
  // Fechamento do caixa
  caixa: [string, number][];
  maquininhas: MaquininhaRelatorio[];
  consumo: ConsumoRelatorio[];
  vendidos: VendidoRelatorio[];
  entradas: GrupoEntradas[]; // resumo das entradas (entrada + chegada) de cada produto lançado // resumo: total vendido = entrada + chegada − sobra − consumo − descarte
  esperado: number;
  arrecadado: number;
  diferenca: number;   // arrecadado − esperado
  situacao: string;    // Caixa conferido / Sobra / Falta
  arquivoBase: string; // nome do arquivo, sem extensão
}

// Linhas fixas do resumo "Vendidos no turno" (na ordem pedida pelo dono)
const NAO_REFRIGERANTE = new Set(["bb_agua", "bb_aguagas", "bb_cerveja", "ot_gelo"]);
const LINHAS_VENDIDOS: { item: string; filtro: (p: Product) => boolean }[] = [
  { item: "Casquinha frita", filtro: (p) => p.id === "cq_frita" },
  { item: "Caldo 300", filtro: (p) => p.id === "cc_300" },
  { item: "Caldo 400", filtro: (p) => p.id === "cc_400" },
  { item: "Caldo 500", filtro: (p) => p.id === "cc_500" },
  { item: "Garrafa 500", filtro: (p) => p.id === "cc_g500" },
  { item: "Garrafa 1L", filtro: (p) => p.id === "cc_g1000" },
  { item: "Refrigerantes", filtro: (p) => p.category === "bebida" && !NAO_REFRIGERANTE.has(p.id) },
  { item: "Água", filtro: (p) => p.id === "bb_agua" },
  { item: "Água com gás", filtro: (p) => p.id === "bb_aguagas" },
  { item: "Cerveja", filtro: (p) => p.id === "bb_cerveja" },
  { item: "Gelo", filtro: (p) => p.id === "ot_gelo" },
];

// Total vendido no turno por linha do resumo. O consumo (funcionários e barraca) e o descarte são
// descontados: saíram do estoque mas não foram vendidos.
export function vendidosDoTurno(turno: Turno, products: Product[]): VendidoRelatorio[] {
  const soma = (lista: Product[]) => lista.reduce((s, p) => s + (turno.items[p.id] ? (vendeu(turno.items[p.id]) ?? 0) : 0), 0);
  const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toLocaleString("pt-BR"));
  const usados = new Set<string>();
  const pasteis = products.filter((p) => p.category === "pastel" && !EXCLUIR_DO_TOTAL_PASTEL.has(p.id));
  pasteis.forEach((p) => usados.add(p.id));
  const linhas: VendidoRelatorio[] = [{ item: `Pastéis do turno (${shiftLabel(turno.shift).replace(/^[^\p{L}]+/u, "")})`, qtd: fmt(soma(pasteis)) }];
  for (const l of LINHAS_VENDIDOS) {
    const lista = products.filter(l.filtro);
    lista.forEach((p) => usados.add(p.id));
    linhas.push({ item: l.item, qtd: fmt(soma(lista)) });
  }
  // Produtos cadastrados pelo dono que não entram em nenhuma linha acima (só aparece se vendeu algo)
  const outros = soma(products.filter((p) => !usados.has(p.id) && p.saleable));
  if (outros > 0) linhas.push({ item: "Outros produtos", qtd: fmt(outros) });
  return linhas;
}

const GRUPOS_ENTRADA: { categoria: string; filtro: (p: Product) => boolean; somaPasteis?: boolean }[] = [
  { categoria: "Pastéis", filtro: (p) => p.category === "pastel", somaPasteis: true },
  { categoria: "Caldos", filtro: (p) => p.category === "caldo" },
  { categoria: "Bebidas", filtro: (p) => p.category === "bebida" && p.id !== "ot_gelo" },
  { categoria: "Gelo", filtro: (p) => p.id === "ot_gelo" },
  { categoria: "Outros", filtro: (p) => p.category === "outros" },
];

// Só os produtos que tiveram entrada ou chegada no turno. No grupo dos pastéis, o total não soma as
// casquinhas (igual ao total de pastéis do turno).
export function entradasDoTurno(turno: Turno, products: Product[]): GrupoEntradas[] {
  const fmt = (n: number, decimal?: boolean) => (decimal || !Number.isInteger(n) ? n.toLocaleString("pt-BR") : String(n));
  const grupos: GrupoEntradas[] = [];
  for (const g of GRUPOS_ENTRADA) {
    let soma = 0;
    const linhas: LinhaEntrada[] = [];
    for (const p of products.filter(g.filtro)) {
      const it = turno.items[p.id];
      if (!it) continue;
      const entrada = it.entrada || 0, chegada = it.chegada ?? 0, total = entrada + chegada;
      if (total <= 0) continue;
      linhas.push({ produto: p.name, entrada: fmt(entrada, p.decimal), chegada: fmt(chegada, p.decimal), total: fmt(total, p.decimal) });
      if (!g.somaPasteis || !EXCLUIR_DO_TOTAL_PASTEL.has(p.id)) soma += total;
    }
    if (linhas.length === 0) continue;
    grupos.push({ categoria: g.categoria, linhas, total: g.somaPasteis ? fmt(soma) : undefined });
  }
  return grupos;
}

const fmtQtd = (n: number, decimal?: boolean) => (decimal ? n.toLocaleString("pt-BR") : String(n));
const TAXAS_PADRAO: TaxasMaquininha = { maq1: 0, maq2: 0 };

// Monta o relatório de UM turno: sobras dos produtos (por categoria), fechamento do caixa (dinheiro,
// moedas, pix, maquininhas), consumos, esperado × arrecadado e quem abriu/fechou.
export function montarRelatorioSobras(
  turno: Turno, products: Product[], funcionarios: Funcionario[], taxas: TaxasMaquininha = TAXAS_PADRAO,
): RelatorioSobras {
  const nome = (username: string) => funcionarios.find((f) => f.username === username)?.nome ?? username;

  const grupos: GrupoSobras[] = [];
  for (const cat of CATEGORIAS) {
    const linhas = products
      .filter((p) => p.category === cat.key)
      .map((p) => ({ p, item: turno.items[p.id] }))
      .filter(({ item }) => item && item.sobra != null)
      .map(({ p, item }) => ({ produto: p.name, sobra: fmtQtd(item!.sobra as number, p.decimal) }));
    if (linhas.length === 0) continue;

    const grupo: GrupoSobras = { categoria: cat.label, linhas };
    if (cat.key === "pastel") {
      grupo.totalPasteis = products
        .filter((p) => p.category === "pastel" && !EXCLUIR_DO_TOTAL_PASTEL.has(p.id))
        .reduce((s, p) => s + (turno.items[p.id]?.sobra ?? 0), 0);
    }
    grupos.push(grupo);
  }

  const c = turno.caixa;
  const caixa: [string, number][] = [
    ["Dinheiro do caixa anterior", c.caixaFimPrev || 0],
    ["Dinheiro final (contado)", c.dinheiroFinal || 0],
    ["Dinheiro malote (enviado ao dono)", c.dinheiroMalote || 0],
    ["Fica no caixa", dinheiroNoCaixa(c)],
    ["Moedas inicial", c.moedasInicial || 0],
    ["Moedas final", c.moedasFinal || 0],
    ["Pix manual", c.pix || 0],
  ];
  if (c.voucher) caixa.push(["Voucher", c.voucher]);

  const noite = turno.shift === "noite";
  const maquininhas: MaquininhaRelatorio[] = (c.maq2Ativa ? (["maq1", "maq2"] as const) : (["maq1"] as const)).map((m) => ({
    nome: nomeMaquina(taxas, m),
    anterior: c[m].base || 0,
    lancado: noite ? (c[m].ate00 ?? c[m].display ?? 0) : (c[m].display ?? 0),
    apos00: noite ? (c[m].apos00 ?? 0) : undefined,
    real: realMaq(c[m], turno.shift),
  }));

  const consumo: ConsumoRelatorio[] = products
    .map((p) => ({ p, it: turno.items[p.id] }))
    .filter(({ it }) => it && ((it.consumo || 0) > 0 || (it.consumoEst || 0) > 0 || (it.descarte || 0) > 0))
    .map(({ p, it }) => ({ produto: p.name, funcionarios: it!.consumo || 0, barraca: it!.consumoEst || 0, descarte: it!.descarte || 0 }));

  // Mesma conta da tela de fechamento (Ponto → Fechar o turno)
  const esperado = esperadoTurno(turno, products, true);
  const arrecadado = arrecadadoTurno(turno);
  const diferenca = arrecadado - esperado;
  const situacao = Math.abs(diferenca) < 0.5 ? "Caixa conferido" : diferenca > 0 ? `Sobra de ${BRL(diferenca)}` : `Faltam ${BRL(-diferenca)}`;

  return {
    data: formatDateBR(turno.date),
    turno: shiftLabel(turno.shift),
    abertoPor: nome(turno.employee),
    fechadoPor: nome(turno.fechadoPor ?? turno.employee),
    colegas: (turno.outrosFuncionarios ?? []).map(nome),
    grupos, caixa, maquininhas, consumo, vendidos: vendidosDoTurno(turno, products), entradas: entradasDoTurno(turno, products), esperado, arrecadado, diferenca, situacao,
    arquivoBase: `sobras-${turno.date}-${turno.shift}`,
  };
}
