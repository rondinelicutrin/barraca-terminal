import * as XLSX from "xlsx";

export interface ExcelSheet {
  name: string;
  rows: Record<string, string | number>[];
}

// Gera e baixa um arquivo .xlsx (Excel) com uma ou mais planilhas.
export function baixarExcel(filename: string, sheets: ExcelSheet[]) {
  const wb = XLSX.utils.book_new();
  for (const sheet of sheets) {
    const ws = XLSX.utils.json_to_sheet(sheet.rows);
    XLSX.utils.book_append_sheet(wb, ws, sheet.name.slice(0, 31)); // nome de aba: máx. 31 caracteres
  }
  XLSX.writeFile(wb, filename);
}
