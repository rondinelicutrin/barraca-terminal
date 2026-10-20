export const BRL = (n: number) =>
  (n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export const num = (n: number) =>
  (n || 0).toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 2 });

// Aceita tanto vírgula quanto ponto como separador decimal (o teclado numérico do celular
// costuma inserir "." em inputMode="decimal", mesmo em aparelhos configurados em português).
export const parseBR = (s: string): number => {
  if (!s) return 0;
  let cleaned = String(s).replace(/[^\d.,\-]/g, "");
  if (cleaned.includes(",")) {
    // Vírgula presente: ela é o separador decimal; pontos (se houver) são separadores de milhar
    cleaned = cleaned.replace(/\./g, "").replace(",", ".");
  }
  // Sem vírgula: mantém o ponto como separador decimal (ex.: "10.5" digitado no teclado numérico)
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
};

export const parseInt2 = (s: string): number => {
  const n = parseInt(String(s).replace(/[^\d-]/g, ""), 10);
  return isNaN(n) ? 0 : n;
};

export const formatDateBR = (iso: string) => {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
};

// Converte uma data ISO (yyyy-mm-dd) em Date local, sem deslocamento de fuso horário
export const isoToDate = (iso: string): Date | undefined => {
  if (!iso) return undefined;
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return undefined;
  return new Date(y, m - 1, d);
};

// Converte um Date local em string ISO (yyyy-mm-dd)
export const dateToISO = (date: Date): string => {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
};

export const todayISO = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

export const shiftLabel = (s: string) =>
  s === "manha" ? "☀️ Manhã" : s === "tarde" ? "🌤️ Tarde" : "🌙 Noite";
