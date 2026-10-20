import { useCallback, useState } from "react";

// Guarda filtros e pesquisas (datas, funcionário selecionado, aba...) enquanto o app está aberto,
// para não precisar refazer a busca ao ir para outro menu e voltar. Fica na memória (troca de menu)
// e também na sessão do navegador (se a página for recarregada). Fechando a aba, volta ao padrão.
const memoria = new Map<string, unknown>();
const PREFIXO = "barraca_filtro:";

function ler<T>(chave: string): { achou: boolean; valor?: T } {
  if (memoria.has(chave)) return { achou: true, valor: memoria.get(chave) as T };
  try {
    const bruto = sessionStorage.getItem(PREFIXO + chave);
    if (bruto != null) {
      const valor = JSON.parse(bruto) as T;
      memoria.set(chave, valor);
      return { achou: true, valor };
    }
  } catch { /* sessionStorage pode não estar disponível */ }
  return { achou: false };
}

function gravar(chave: string, valor: unknown) {
  memoria.set(chave, valor);
  try { sessionStorage.setItem(PREFIXO + chave, JSON.stringify(valor)); } catch { /* ignora */ }
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
