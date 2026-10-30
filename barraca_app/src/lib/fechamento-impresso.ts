import { jsPDF } from "jspdf";
import { vendeu, getAllProducts, valorConsumoPonto, type State, type Turno } from "./store";
import { EXCLUIR_DO_TOTAL_PASTEL, type Product } from "./products";
import { BRL, shiftLabel } from "./format";
import { montarRelatorioSobras, type RelatorioSobras } from "./relatorio-sobras";
import { textoParaPdf } from "./pdf";
import { baixarCsv } from "./csv";

// Fechamento geral do turno, no formato pedido pelo dono, em UMA folha (PDF e CSV):
// 1- Resultado · 2- Dinheiro, moedas e pix · 3- Maquininhas · 4- Vendidos no turno (produto a produto)
// · 5- Consumo dos funcionários.

export interface LinhaProduto {
  produto: string;
  entrada: number; chegada: number; sobra: number | null; consumo: number; descarte: number;
  total: number;    // entrada + chegada
  vendidos: number; // total − sobra − consumo − descarte
  valor: number | null; // vendidos × preço (null = produto que não é vendido, ex.: casquinha crua)
  decimal?: boolean;
}
export interface GrupoProdutos {
  titulo: string; linhas: LinhaProduto[];
  total?: LinhaProduto; // só nos pastéis: soma dos sabores (sem casquinha)
  valorTotal: number;   // soma em R$ de tudo que foi vendido na subcategoria
}
export interface ConsumoPessoa { nome: string; itens: string; valor: number }

export interface FechamentoImpresso {
  base: RelatorioSobras;
  turnoNome: string;               // Manhã / Tarde / Noite (sem emoji)
  grupos: GrupoProdutos[];
  totalVendido: number;            // soma da coluna Valor R$
  consumoFuncionarios: ConsumoPessoa[];
  arquivoBase: string;
}

const GRUPOS: { titulo: string; filtro: (p: Product) => boolean; totalPasteis?: boolean }[] = [
  { titulo: "Pastéis", filtro: (p) => p.category === "pastel", totalPasteis: true },
  { titulo: "Caldo", filtro: (p) => p.category === "caldo" },
  { titulo: "Bebidas", filtro: (p) => p.category === "bebida" && p.id !== "ot_gelo" },
  { titulo: "Gelo", filtro: (p) => p.id === "ot_gelo" },
  { titulo: "Outros", filtro: (p) => p.category === "outros" },
];

export function montarFechamentoImpresso(turno: Turno, state: State): FechamentoImpresso {
  const products = getAllProducts(state);
  const base = montarRelatorioSobras(turno, products, state.funcionarios, state.taxasMaquininha);
  let totalVendido = 0;
  const grupos: GrupoProdutos[] = [];
  for (const g of GRUPOS) {
    const doGrupo = products.filter(g.filtro).filter((p) => turno.items[p.id]);
    if (doGrupo.length === 0) continue;
    // Casquinhas por último no grupo dos pastéis (não entram no total)
    if (g.totalPasteis) doGrupo.sort((a, b) => Number(EXCLUIR_DO_TOTAL_PASTEL.has(a.id)) - Number(EXCLUIR_DO_TOTAL_PASTEL.has(b.id)));
    const linhas = doGrupo.map((p): LinhaProduto => {
      const it = turno.items[p.id];
      const vend = vendeu(it) ?? 0;
      // Mesmo preço do "Esperado" do fechamento
      const valor = p.saleable ? vend * p.price : null;
      if (valor) totalVendido += valor;
      return {
        produto: p.name, entrada: it.entrada || 0, chegada: it.chegada ?? 0, sobra: it.sobra ?? null,
        consumo: (it.consumo || 0) + (it.consumoEst || 0), descarte: it.descarte || 0,
        total: (it.entrada || 0) + (it.chegada ?? 0), vendidos: vend, valor, decimal: p.decimal,
      };
    });
    const grupo: GrupoProdutos = { titulo: g.titulo, linhas, valorTotal: linhas.reduce((s, l) => s + (l.valor ?? 0), 0) };
    if (g.totalPasteis) {
      const sabores = linhas.filter((_, i) => !EXCLUIR_DO_TOTAL_PASTEL.has(doGrupo[i].id));
      const soma = (f: (l: LinhaProduto) => number) => sabores.reduce((s, l) => s + f(l), 0);
      grupo.total = {
        produto: "Total dos pastéis (sem casquinha)", entrada: soma((l) => l.entrada), chegada: soma((l) => l.chegada),
        sobra: soma((l) => l.sobra ?? 0), consumo: soma((l) => l.consumo), descarte: soma((l) => l.descarte),
        total: soma((l) => l.total), vendidos: soma((l) => l.vendidos), valor: soma((l) => l.valor ?? 0),
      };
    }
    grupos.push(grupo);
  }

  // Consumo de quem trabalhou no turno (quem abriu + colegas), lançado no ponto da data do turno
  const nomeProduto = (id: string) => products.find((p) => p.id === id)?.name ?? id;
  const consumoFuncionarios: ConsumoPessoa[] = [];
  for (const username of [turno.employee, ...(turno.outrosFuncionarios ?? [])]) {
    const itens = state.pontos.filter((p) => p.employeeUsername === username && p.date === turno.date).flatMap((p) => p.consumo);
    if (itens.length === 0) continue;
    const qtd: Record<string, number> = {};
    for (const c of itens) qtd[c.productId] = (qtd[c.productId] ?? 0) + c.qty;
    const lista = Object.entries(qtd).map(([productId, q]) => ({ productId, qty: q }));
    consumoFuncionarios.push({
      nome: state.funcionarios.find((f) => f.username === username)?.nome ?? username,
      itens: lista.map((c) => `${c.qty}x ${nomeProduto(c.productId)}`).join(", "),
      valor: valorConsumoPonto(state, username, lista),
    });
  }

  return {
    base, turnoNome: shiftLabel(turno.shift).replace(/^[^\p{L}]+/u, ""), grupos, totalVendido, consumoFuncionarios,
    arquivoBase: `fechamento-${turno.date}-${turno.shift}`,
  };
}

const rotuloTotalGrupo = (g: GrupoProdutos) =>
  g.total ? `Total ${g.titulo} em R$ (com casquinha frita)` : `Total ${g.titulo} em R$`;

const qtd = (n: number | null, decimal?: boolean) =>
  n == null ? "-" : decimal || !Number.isInteger(n) ? n.toLocaleString("pt-BR", { maximumFractionDigits: 2 }) : String(n);
const reais = (n: number | null) => (n == null ? "-" : BRL(n).replace(/ /g, " "));
const sinal = (n: number) => `${n > 0.005 ? "+" : ""}${reais(n)}`;
const linhaColunas = (l: LinhaProduto) => [
  qtd(l.entrada, l.decimal), qtd(l.chegada, l.decimal), qtd(l.sobra, l.decimal), qtd(l.consumo, l.decimal),
  qtd(l.descarte, l.decimal), qtd(l.total, l.decimal), qtd(l.vendidos, l.decimal), reais(l.valor),
];
export const COLUNAS_VENDIDOS = ["Produtos", "Entrada", "Chegada", "Sobras", "Consumo", "Descarte", "Total", "Vendidos", "Valor R$"];

function cabecalhoLinhas(f: FechamentoImpresso): string[] {
  const r = f.base;
  return [
    `${f.turnoNome} · ${r.data}`,
    `Fechado por: ${r.fechadoPor}${r.abertoPor !== r.fechadoPor ? ` (aberto por ${r.abertoPor})` : ""}`,
    `Colegas no turno: ${r.colegas.length > 0 ? r.colegas.join(", ") : "nenhum"}`,
  ];
}

function maquininhasTabela(f: FechamentoImpresso) {
  const noite = f.base.maquininhas.some((m) => m.apos00 != null);
  return {
    colunas: noite ? ["Maquininha", "Turno anterior", "Até 00:00", "Após 00:00", "Vendido"] : ["Maquininha", "Turno anterior", "Lançado agora", "Vendido"],
    linhas: f.base.maquininhas.map((m) => noite
      ? [m.nome, reais(m.anterior), reais(m.lancado), reais(m.apos00 ?? 0), reais(m.real)]
      : [m.nome, reais(m.anterior), reais(m.lancado), reais(m.real)]),
  };
}

// PDF numa folha A4. Se houver muitos produtos, a letra diminui até caber.
export function baixarFechamentoPdf(f: FechamentoImpresso) {
  const doc = gerarFechamentoPdfDoc(f);
  doc.save(`${f.arquivoBase}.pdf`);
}

export function gerarFechamentoPdfDoc(f: FechamentoImpresso): jsPDF {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();
  const M = 28, larg = W - M * 2;
  const r = f.base;
  const nLinhasProdutos = f.grupos.reduce((s, g) => s + 2 + g.linhas.length + (g.total ? 1 : 0), 0) + 2;
  const maq = maquininhasTabela(f);
  const nConsumo = Math.max(1, f.consumoFuncionarios.length);
  // Altura de uma linha (pt): começa em 11 e diminui se não couber numa folha
  const fixas = 3 + 8 + 2 + maq.linhas.length + nConsumo + 1; // linhas fora da tabela de produtos
  const disponivel = H - M * 2 - 70 - 5 * 18; // tirando título e títulos das seções
  const lh = Math.max(6.5, Math.min(11, disponivel / (nLinhasProdutos + fixas)));
  const fs = Math.max(5.5, Math.min(8.5, lh * 0.78));
  const texto = (t: string, x: number, y: number, o?: { align?: "right" | "left"; bold?: boolean; cor?: number; size?: number }) => {
    doc.setFont("helvetica", o?.bold ? "bold" : "normal");
    doc.setFontSize(o?.size ?? fs);
    doc.setTextColor(o?.cor ?? 0);
    doc.text(textoParaPdf(t), x, y, { align: o?.align ?? "left" });
  };
  const titulo = (t: string, y: number) => {
    doc.setFillColor(235, 235, 235);
    doc.rect(M, y - 9, larg, 12, "F");
    texto(t, M + 4, y, { bold: true, size: 9 });
    return y + 12;
  };
  const traco = (y: number, x1 = M, x2 = M + larg) => { doc.setDrawColor(210); doc.line(x1, y, x2, y); };

  let y = M + 12;
  texto(`Fechamento geral do turno · ${f.turnoNome.toUpperCase()}`, M, y, { bold: true, size: 15 });
  y += 15;
  for (const l of cabecalhoLinhas(f)) { texto(l, M, y, { size: 9, cor: 60 }); y += 11; }
  y += 6;

  // 1 e 2 lado a lado
  const meia = (larg - 14) / 2, x2 = M + meia + 14;
  const linhaKV = (k: string, v: string, x: number, w: number, yy: number, bold = false) => {
    texto(k, x + 4, yy, { bold }); texto(v, x + w - 4, yy, { align: "right", bold });
  };
  doc.setFillColor(235, 235, 235); doc.rect(M, y - 9, meia, 12, "F"); doc.rect(x2, y - 9, meia, 12, "F");
  texto("1- Resultado do turno", M + 4, y, { bold: true, size: 9 });
  texto("2- Dinheiro, moedas e pix", x2 + 4, y, { bold: true, size: 9 });
  let y1 = y + 12, y2 = y + 12;
  linhaKV("Esperado", reais(r.esperado), M, meia, y1); y1 += lh;
  linhaKV("Arrecadado", reais(r.arrecadado), M, meia, y1); y1 += lh;
  linhaKV("Diferença", sinal(r.diferenca), M, meia, y1, true); y1 += lh;
  const corSituacao: [number, number, number] = Math.abs(r.diferenca) < 0.5 ? [30, 130, 70] : r.diferenca > 0 ? [190, 120, 0] : [200, 40, 40];
  doc.setFont("helvetica", "bold"); doc.setFontSize(fs); doc.setTextColor(...corSituacao);
  doc.text(textoParaPdf(r.situacao), M + 4, y1); doc.setTextColor(0); y1 += lh;
  for (const [k, v] of r.caixa) { linhaKV(k, reais(v), x2, meia, y2); y2 += lh; }
  y = Math.max(y1, y2) + 6;

  // 3- Maquininhas
  y = titulo("3- Maquininhas", y);
  const wMaq = larg / maq.colunas.length;
  maq.colunas.forEach((c, i) => texto(c, i === 0 ? M + 4 : M + wMaq * (i + 1) - 4, y, { bold: true, align: i === 0 ? "left" : "right" }));
  y += 3; traco(y); y += lh - 2;
  for (const l of maq.linhas) {
    l.forEach((c, i) => texto(c, i === 0 ? M + 4 : M + wMaq * (i + 1) - 4, y, { align: i === 0 ? "left" : "right" }));
    y += lh;
  }
  y += 6;

  // 4- Vendidos no turno, produto a produto
  y = titulo(`4- Vendidos no turno (${f.turnoNome})`, y);
  const wProd = 150, wCol = (larg - wProd) / 8;
  const xCol = (i: number) => (i === 0 ? M + 4 : M + wProd + wCol * i - 4);
  COLUNAS_VENDIDOS.forEach((c, i) => texto(c, xCol(i), y, { bold: true, align: i === 0 ? "left" : "right" }));
  y += 3; traco(y); y += lh - 2;
  const linhaProduto = (l: LinhaProduto, bold = false) => {
    texto(l.produto.length > 34 ? l.produto.slice(0, 33) + "…" : l.produto, xCol(0), y, { bold });
    linhaColunas(l).forEach((c, i) => texto(c, xCol(i + 1), y, { align: "right", bold, cor: !bold && (c === "0" || c === "-") ? 150 : 0 }));
    y += lh;
  };
  for (const g of f.grupos) {
    texto(g.titulo, M + 4, y, { bold: true, size: fs + 1 }); y += lh;
    for (const l of g.linhas) linhaProduto(l);
    if (g.total) { traco(y - lh + 2.5); linhaProduto(g.total, true); }
    // Valor em R$ da subcategoria inteira (nos pastéis inclui a casquinha frita)
    if (!g.total) traco(y - lh + 2.5);
    texto(rotuloTotalGrupo(g), xCol(0), y, { bold: true });
    texto(reais(g.valorTotal), xCol(8), y, { bold: true, align: "right" });
    y += lh + 2;
  }
  traco(y - lh + 2.5);
  texto("Total vendido em produtos", xCol(0), y, { bold: true });
  texto(reais(f.totalVendido), xCol(8), y, { bold: true, align: "right" });
  y += lh + 6;

  // 5- Consumo dos funcionários
  y = titulo("5- Consumo funcionário", y);
  if (f.consumoFuncionarios.length === 0) { texto("Nenhum consumo de funcionário neste turno.", M + 4, y, { cor: 90 }); y += lh; }
  for (const c of f.consumoFuncionarios) {
    texto(c.nome, M + 4, y, { bold: true });
    const itens = doc.splitTextToSize(textoParaPdf(c.itens), larg - 230)[0] as string;
    texto(itens + (itens.length < c.itens.length ? "…" : ""), M + 110, y);
    texto(reais(c.valor), M + larg - 4, y, { align: "right" });
    y += lh;
  }
  texto(`Gerado em ${new Date().toLocaleString("pt-BR")}`, M, H - M + 8, { size: 6.5, cor: 140 });
  return doc;
}

// CSV numa única planilha, mesma ordem do PDF
export function linhasFechamentoCsv(f: FechamentoImpresso): (string | number)[][] {
  const s = (t: string) => t.replace(/;/g, ",");
  const v = (n: number | null) => (n == null ? "" : n.toFixed(2));
  const q = (n: number | null) => (n == null ? "" : String(n).replace(".", ","));
  const r = f.base;
  const maq = maquininhasTabela(f);
  const linhas: (string | number)[][] = [
    [`FECHAMENTO GERAL DO TURNO · ${f.turnoNome.toUpperCase()}`],
    ...cabecalhoLinhas(f).map((l) => [s(l)]),
    [],
    ["1- RESULTADO DO TURNO", "Valor (R$)"],
    ["Esperado", v(r.esperado)], ["Arrecadado", v(r.arrecadado)], ["Diferença", v(r.diferenca)], ["Situação", s(r.situacao)],
    [],
    ["2- DINHEIRO, MOEDAS E PIX", "Valor (R$)"],
    ...r.caixa.map(([k, x]) => [k, v(x)]),
    [],
    ["3- MAQUININHAS", ...maq.colunas.slice(1).map((c) => `${c} (R$)`)],
    ...f.base.maquininhas.map((m) => [s(m.nome), v(m.anterior), v(m.lancado), ...(m.apos00 != null ? [v(m.apos00)] : []), v(m.real)]),
    [],
    [`4- VENDIDOS NO TURNO (${f.turnoNome.toUpperCase()})`],
    COLUNAS_VENDIDOS,
  ];
  const linhaCsv = (l: LinhaProduto) => [s(l.produto), q(l.entrada), q(l.chegada), q(l.sobra), q(l.consumo), q(l.descarte), q(l.total), q(l.vendidos), v(l.valor)];
  for (const g of f.grupos) {
    linhas.push([g.titulo.toUpperCase()]);
    for (const l of g.linhas) linhas.push(linhaCsv(l));
    if (g.total) linhas.push(linhaCsv(g.total));
    linhas.push([rotuloTotalGrupo(g), "", "", "", "", "", "", "", v(g.valorTotal)]);
  }
  linhas.push(["Total vendido em produtos", "", "", "", "", "", "", "", v(f.totalVendido)], []);
  linhas.push(["5- CONSUMO FUNCIONÁRIO", "Itens", "Valor (R$)"]);
  if (f.consumoFuncionarios.length === 0) linhas.push(["Nenhum consumo de funcionário neste turno"]);
  for (const c of f.consumoFuncionarios) linhas.push([s(c.nome), s(c.itens), v(c.valor)]);
  return linhas;
}

export function baixarFechamentoCsv(f: FechamentoImpresso) {
  baixarCsv(`${f.arquivoBase}.csv`, [], linhasFechamentoCsv(f));
}
