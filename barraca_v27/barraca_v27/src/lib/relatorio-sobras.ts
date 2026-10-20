import type { Turno, Funcionario } from "./store";
import { EXCLUIR_DO_TOTAL_PASTEL, type Category, type Product } from "./products";
import { formatDateBR, shiftLabel } from "./format";
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

export interface RelatorioSobras {
  data: string;        // dd/mm/aaaa
  turno: string;       // Manhã / Tarde / Noite
  fechadoPor: string;  // quem abriu, contou e fechou o turno
  colegas: string[];   // demais funcionários que trabalharam no turno
  grupos: GrupoSobras[];
  arquivoBase: string; // nome do arquivo, sem extensão
}

const fmtQtd = (n: number, decimal?: boolean) => (decimal ? n.toLocaleString("pt-BR") : String(n));

// Monta o relatório de sobras de UM turno, com todos os produtos que tiveram a sobra contada,
// agrupados por categoria, e os nomes de quem fechou o turno e dos colegas.
export function montarRelatorioSobras(turno: Turno, products: Product[], funcionarios: Funcionario[]): RelatorioSobras {
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

  return {
    data: formatDateBR(turno.date),
    turno: shiftLabel(turno.shift),
    fechadoPor: nome(turno.employee),
    colegas: (turno.outrosFuncionarios ?? []).map(nome),
    grupos,
    arquivoBase: `sobras-${turno.date}-${turno.shift}`,
  };
}

export function baixarRelatorioSobrasPdf(r: RelatorioSobras) {
  const sections: PdfSection[] = r.grupos.map((g) => ({
    heading: g.categoria,
    columns: ["Produto", "Sobra"],
    rows: g.linhas.map((l) => [l.produto, l.sobra]),
    totalRow: g.totalPasteis != null ? ["Total de pastéis (sem casquinhas)", String(g.totalPasteis)] : undefined,
  }));

  gerarRelatorioPdf({
    filename: `${r.arquivoBase}.pdf`,
    title: "Sobras do turno",
    subtitle: [
      `${r.turno} · ${r.data}`,
      `Fechamento e contagem: ${r.fechadoPor}`,
      r.colegas.length > 0 ? `Colegas no turno: ${r.colegas.join(", ")}` : "Colegas no turno: nenhum",
    ],
    sections,
  });
}

export function baixarRelatorioSobrasCsv(r: RelatorioSobras) {
  const s = (t: string) => t.replace(/;/g, ","); // ";" é o separador do arquivo
  const linhas: (string | number)[][] = [
    ["RELATÓRIO DE SOBRAS DO TURNO"],
    ["Data", r.data],
    ["Turno", r.turno],
    ["Fechamento e contagem por", s(r.fechadoPor)],
    ["Colegas no turno", r.colegas.length > 0 ? s(r.colegas.join(", ")) : "Nenhum"],
    [],
    ["Categoria", "Produto", "Sobra"],
  ];
  for (const g of r.grupos) {
    for (const l of g.linhas) linhas.push([g.categoria, s(l.produto), l.sobra]);
    if (g.totalPasteis != null) {
      linhas.push([g.categoria, "TOTAL DE PASTÉIS (sem casquinhas)", String(g.totalPasteis)]);
    }
  }
  baixarCsv(`${r.arquivoBase}.csv`, [], linhas);
}
