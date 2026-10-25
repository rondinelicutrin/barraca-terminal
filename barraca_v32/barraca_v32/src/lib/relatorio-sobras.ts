import { esperadoTurno, arrecadadoTurno, realMaq, dinheiroNoCaixa, nomeMaquina, type Turno, type Funcionario, type TaxasMaquininha } from "./store";
import { EXCLUIR_DO_TOTAL_PASTEL, type Category, type Product } from "./products";
import { BRL, formatDateBR, shiftLabel } from "./format";
import { gerarRelatorioPdf, type PdfSection } from "./pdf";
import { baixarCsv } from "./csv";

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
  esperado: number;
  arrecadado: number;
  diferenca: number;   // arrecadado − esperado
  situacao: string;    // Caixa conferido / Sobra / Falta
  arquivoBase: string; // nome do arquivo, sem extensão
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
    grupos, caixa, maquininhas, consumo, esperado, arrecadado, diferenca, situacao,
    arquivoBase: `sobras-${turno.date}-${turno.shift}`,
  };
}

const sinal = (n: number) => `${n > 0.005 ? "+" : ""}${BRL(n)}`;

export function baixarRelatorioSobrasPdf(r: RelatorioSobras) {
  const temApos00 = r.maquininhas.some((m) => m.apos00 != null);
  const sections: PdfSection[] = [
    {
      heading: "Resultado do turno",
      columns: ["Item", "Valor"],
      rows: [["Esperado", BRL(r.esperado)], ["Arrecadado", BRL(r.arrecadado)], ["Diferença", sinal(r.diferenca)]],
      totalRow: ["Situação", r.situacao],
    },
    {
      heading: "Dinheiro, moedas e pix",
      columns: ["Item", "Valor"],
      rows: r.caixa.map(([k, v]) => [k, BRL(v)]),
    },
    {
      heading: "Maquininhas",
      columns: temApos00 ? ["Maquininha", "Turno anterior", "Até 00:00", "Após 00:00", "Vendido"] : ["Maquininha", "Turno anterior", "Lançado agora", "Vendido"],
      rows: r.maquininhas.map((m) => temApos00
        ? [m.nome, BRL(m.anterior), BRL(m.lancado), BRL(m.apos00 ?? 0), BRL(m.real)]
        : [m.nome, BRL(m.anterior), BRL(m.lancado), BRL(m.real)]),
    },
    {
      heading: "Consumos e descarte do turno",
      columns: ["Produto", "Consumo funcionários", "Consumo barraca", "Descarte"],
      rows: r.consumo.length > 0
        ? r.consumo.map((x) => [x.produto, String(x.funcionarios), String(x.barraca), String(x.descarte)])
        : [["Nenhum consumo ou descarte", "", "", ""]],
    },
    ...r.grupos.map((g) => ({
      heading: `Sobras — ${g.categoria}`,
      columns: ["Produto", "Sobra"],
      rows: g.linhas.map((l) => [l.produto, l.sobra]),
      totalRow: g.totalPasteis != null ? ["Total de pastéis (sem casquinhas)", String(g.totalPasteis)] : undefined,
    })),
  ];

  gerarRelatorioPdf({
    filename: `${r.arquivoBase}.pdf`,
    title: "Fechamento e sobras do turno",
    subtitle: [
      `${r.turno} · ${r.data}`,
      r.abertoPor === r.fechadoPor ? `Fechado por: ${r.fechadoPor}` : `Aberto por: ${r.abertoPor} · Fechado por: ${r.fechadoPor}`,
      r.colegas.length > 0 ? `Colegas no turno: ${r.colegas.join(", ")}` : "Colegas no turno: nenhum",
    ],
    sections,
  });
}

export function baixarRelatorioSobrasCsv(r: RelatorioSobras) {
  const s = (t: string) => t.replace(/;/g, ","); // ";" é o separador do arquivo
  const v = (n: number) => n.toFixed(2);
  const linhas: (string | number)[][] = [
    ["FECHAMENTO E SOBRAS DO TURNO"],
    ["Data", r.data],
    ["Turno", r.turno],
    ["Aberto por", s(r.abertoPor)],
    ["Fechado por", s(r.fechadoPor)],
    ["Colegas no turno", r.colegas.length > 0 ? s(r.colegas.join(", ")) : "Nenhum"],
    [],
    ["RESULTADO"],
    ["Esperado (R$)", v(r.esperado)],
    ["Arrecadado (R$)", v(r.arrecadado)],
    ["Diferença (R$)", v(r.diferenca)],
    ["Situação", s(r.situacao)],
    [],
    ["DINHEIRO, MOEDAS E PIX", "Valor (R$)"],
    ...r.caixa.map(([k, x]) => [k, v(x)]),
    [],
    ["MAQUININHAS", "Turno anterior (R$)", "Lançado agora / até 00:00 (R$)", "Após 00:00 (R$)", "Vendido (R$)"],
    ...r.maquininhas.map((m) => [s(m.nome), v(m.anterior), v(m.lancado), m.apos00 != null ? v(m.apos00) : "", v(m.real)]),
    [],
    ["CONSUMOS E DESCARTE", "Consumo funcionários", "Consumo barraca", "Descarte"],
    ...r.consumo.map((x) => [s(x.produto), x.funcionarios, x.barraca, x.descarte]),
    [],
    ["SOBRAS", "Produto", "Sobra"],
  ];
  for (const g of r.grupos) {
    for (const l of g.linhas) linhas.push([g.categoria, s(l.produto), l.sobra]);
    if (g.totalPasteis != null) {
      linhas.push([g.categoria, "TOTAL DE PASTÉIS (sem casquinhas)", String(g.totalPasteis)]);
    }
  }
  baixarCsv(`${r.arquivoBase}.csv`, [], linhas);
}
