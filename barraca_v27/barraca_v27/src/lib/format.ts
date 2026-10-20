export const BRL = (n: number) =>
  (n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export const num = (n: number) =>
  (n || 0).toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 2 });

// Aceita tanto vírgula quanto ponto como separador decimal (o teclado numérico do celular
// costuma inserir "." em inputMode="decimal", mesmo em aparelhos configurados em português).
// Todos os campos do app são valores ou quantidades: o sinal de menos é ignorado (nunca negativo).
export const parseBR = (s: string): number => {
  if (!s) return 0;
  let cleaned = String(s).replace(/[^\d.,]/g, "");
  if (cleaned.includes(",")) {
    // Vírgula presente: ela é o separador decimal; pontos (se houver) são separadores de milhar
    cleaned = cleaned.replace(/\./g, "").replace(",", ".");
  } else if (/^\d{1,3}(\.\d{3})+$/.test(cleaned)) {
    // "1.500" ou "12.000.000": ponto como separador de milhar (antes "1.500" virava 1,5)
    cleaned = cleaned.replace(/\./g, "");
  }
  // Sem vírgula: mantém o ponto como separador decimal (ex.: "10.5" digitado no teclado numérico)
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
};

// Quantidade inteira: "1,5" vira 1 (antes juntava os dígitos e virava 15); "1.000" vira 1000.
export const parseInt2 = (s: string): number => Math.trunc(parseBR(s));

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
