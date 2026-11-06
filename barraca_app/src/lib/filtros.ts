import { useCallback, useState } from "react";
import { todayISO } from "./format";

// Guarda filtros e pesquisas (datas, funcionário selecionado, aba...) enquanto o app está aberto,
// para não precisar refazer a busca ao ir para outro menu e voltar. Fica na memória (troca de menu)
// e também na sessão do navegador (se a página for recarregada). Fechando a aba, volta ao padrão.
// Vale só no mesmo dia: no celular a aba fica aberta por dias e o Painel ficava preso numa semana antiga
// (ex.: no dia 06 ainda mostrava os turnos só até o dia 01). No dia seguinte, volta ao padrão de cada tela.
type Guardado = { dia: string; v: unknown };
const memoria = new Map<string, Guardado>();
const PREFIXO = "barraca_filtro:";

function ler<T>(chave: string): { achou: boolean; valor?: T } {
  const hoje = todayISO();
  const m = memoria.get(chave);
  if (m) return m.dia === hoje ? { achou: true, valor: m.v as T } : { achou: false };
  try {
    const bruto = sessionStorage.getItem(PREFIXO + chave);
    if (bruto != null) {
      const g = JSON.parse(bruto) as Partial<Guardado>;
      // Valor guardado em outro dia (ou no formato antigo, sem dia): volta ao padrão
      if (g && typeof g === "object" && g.dia === hoje && "v" in g) {
        memoria.set(chave, g as Guardado);
        return { achou: true, valor: g.v as T };
      }
    }
  } catch { /* sessionStorage pode não estar disponível */ }
  return { achou: false };
}

function gravar(chave: string, valor: unknown) {
  const g: Guardado = { dia: todayISO(), v: valor };
  memoria.set(chave, g);
  try { sessionStorage.setItem(PREFIXO + chave, JSON.stringify(g)); } catch { /* ignora */ }
}

export function useFiltro<T>(chave: string, inicial: T | (() => T)) {
  const [valor, setValor] = useState<T>(() => {
    const lido = ler<T>(chave);
    if (lido.achou) return lido.valor as T;
    return typeof inicial === "function" ? (inicial as () => T)() : inicial;
  });
  const definir = useCallback((v: T) => {
    gravar(chave, v);
    setValor(v);
  }, [chave]);
  return [valor, definir] as const;
}
