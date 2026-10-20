import { jsPDF } from "jspdf";

export interface PdfSection {
  heading?: string;
  columns: string[];      // cabeçalhos das colunas
  rows: string[][];       // cada linha: array de strings, mesmo tamanho de columns
  totalRow?: string[];    // linha final em negrito (opcional)
  // Gráfico de barras horizontais desenhado no PDF (usado no lugar da tabela quando informado).
  // Valores negativos aparecem em vermelho. "valueText" é o texto exibido ao lado de cada barra.
  bars?: { label: string; value: number; valueText: string }[];
}

// Gera e baixa um PDF simples de tabelas — usado nos relatórios de sobras.
// Baixa o arquivo diretamente (doc.save), sem abrir a caixa de impressão do navegador.
export function gerarRelatorioPdf(opts: {
  filename: string;
  title: string;
  subtitle?: string | string[]; // uma ou várias linhas abaixo do título
  sections: PdfSection[];
}) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const marginX = 40;
  const pageHeight = doc.internal.pageSize.getHeight();
  const pageWidth = doc.internal.pageSize.getWidth();
  const lineHeight = 16;
  let y = 50;

  doc.setFontSize(16);
  doc.setFont("helvetica", "bold");
  doc.text(opts.title, marginX, y);
  y += 22;

  if (opts.subtitle) {
    const linhasSubtitulo = Array.isArray(opts.subtitle) ? opts.subtitle : [opts.subtitle];
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(90);
    for (const linha of linhasSubtitulo) {
      doc.text(linha, marginX, y);
      y += 14;
    }
    doc.setTextColor(0);
    y += 6;
  }

  const ensureSpace = (needed: number) => {
    if (y + needed > pageHeight - 40) {
      doc.addPage();
      y = 50;
    }
  };

  for (const section of opts.sections) {
    ensureSpace(34);
    if (section.heading) {
      doc.setFontSize(12);
      doc.setFont("helvetica", "bold");
      doc.text(section.heading, marginX, y);
      y += 18;
    }

    const usableWidth = pageWidth - marginX * 2;

    if (section.bars) {
      const maxAbs = Math.max(1e-9, ...section.bars.map((b) => Math.abs(b.value)));
      const labelW = 150, valueW = 90;
      const barMax = usableWidth - labelW - valueW;
      doc.setFontSize(9);
      doc.setFont("helvetica", "normal");
      for (const b of section.bars) {
        ensureSpace(lineHeight);
        const label = b.label.length > 28 ? b.label.slice(0, 27) + "…" : b.label;
        doc.setTextColor(0);
        doc.text(label, marginX, y);
        const w = Math.max(1, (Math.abs(b.value) / maxAbs) * barMax);
        if (b.value < 0) doc.setFillColor(200, 60, 60); else doc.setFillColor(40, 130, 90);
        doc.rect(marginX + labelW, y - 8, w, 9, "F");
        doc.text(b.valueText, marginX + labelW + w + 6, y);
        y += lineHeight;
      }
      doc.setTextColor(0);
      y += 14;
      continue;
    }

    const colWidth = usableWidth / section.columns.length;

    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    section.columns.forEach((c, i) => doc.text(c, marginX + i * colWidth, y));
    y += 4;
    doc.setDrawColor(200);
    doc.line(marginX, y, marginX + usableWidth, y);
    y += 12;

    doc.setFont("helvetica", "normal");
    for (const row of section.rows) {
      ensureSpace(lineHeight);
      row.forEach((cell, i) => doc.text(String(cell ?? ""), marginX + i * colWidth, y));
      y += lineHeight;
    }

    if (section.totalRow) {
      ensureSpace(lineHeight + 10);
      doc.setDrawColor(200);
      doc.line(marginX, y - 4, marginX + usableWidth, y - 4);
      doc.setFont("helvetica", "bold");
      section.totalRow.forEach((cell, i) => doc.text(String(cell ?? ""), marginX + i * colWidth, y + 8));
      y += lineHeight + 10;
      doc.setFont("helvetica", "normal");
    }

    y += 14;
  }

  doc.save(opts.filename);
}
