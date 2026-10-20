// Gera e baixa um arquivo .csv simples (separador ";", compatível com Excel/pt-BR).
// Passe headers=[] para um CSV sem cabeçalho fixo (útil quando as próprias linhas já
// contêm seções e cabeçalhos, como em relatórios com múltiplas tabelas).
export function baixarCsv(filename: string, headers: string[], rows: (string | number)[][]) {
  const bom = "\uFEFF";
  const linhas = headers.length > 0 ? [headers.join(";"), ...rows.map((r) => r.join(";"))] : rows.map((r) => r.join(";"));
  const csv = bom + linhas.join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
