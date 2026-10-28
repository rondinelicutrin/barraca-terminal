// Fila de envio para o Supabase (funciona sem internet).
// Todo lançamento (ponto, consumo, turno, retirada...) entra aqui e fica guardado NO APARELHO até o
// servidor confirmar. Sem internet (comum no 4G), ele espera e é reenviado sozinho quando a conexão
// volta — mesmo que o app tenha sido fechado no meio. Os envios saem na ordem em que foram feitos.

export interface Pendencia {
  id: string;
  tipo: string;
  chave?: string;      // lançamentos com a mesma chave se substituem (vale o mais recente)
  dados: unknown;
  tentativas: number;
  criadoEm: number;
  ultimoErro?: string;
}

export interface EstadoFila {
  pendentes: number;
  online: boolean;
  enviando: boolean;
  recusados: { quando: number; tipo: string; erro: string }[]; // o servidor recusou (não adianta reenviar)
  ultimoEnvioOk?: number;
}

type Executor = (dados: any) => Promise<void>;

const CHAVE_STORAGE = "barraca_fila_v1";
const executores = new Map<string, Executor>();
let fila: Pendencia[] = carregar();
let enviando = false;
let houveFalha = false; // algum envio falhou por falta de internet desde o último "tudo enviado"
let estado: EstadoFila = { pendentes: 0, online: true, enviando: false, recusados: [] };
estado = montarEstado();
const ouvintes = new Set<() => void>();

function carregar(): Pendencia[] {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(CHAVE_STORAGE) : null;
    return raw ? (JSON.parse(raw) as Pendencia[]) : [];
  } catch {
    return [];
  }
}

function salvar() {
  try { localStorage.setItem(CHAVE_STORAGE, JSON.stringify(fila)); } catch { /* sem armazenamento */ }
}

function montarEstado(extra: Partial<EstadoFila> = {}): EstadoFila {
  return {
    pendentes: fila.length,
    online: typeof navigator === "undefined" ? true : navigator.onLine !== false,
    enviando,
    recusados: estado?.recusados ?? [],
    ultimoEnvioOk: estado?.ultimoEnvioOk,
    ...extra,
  };
}

function avisar(extra: Partial<EstadoFila> = {}) {
  estado = montarEstado(extra);
  for (const o of ouvintes) o();
}

// Falha de conexão (sem internet, servidor fora do ar, tempo esgotado): vale a pena tentar de novo.
// Erro com código do banco (ex.: permissão, dado inválido) não melhora reenviando.
export function ehErroTemporario(e: any): boolean {
  if (!e) return false;
  if (e instanceof TypeError) return true;
  const msg = String(e?.message ?? e);
  if (/fetch|network|load failed|timeout|timed out|aborted|ECONN|Failed to/i.test(msg)) return true;
  const status = typeof e?.status === "number" ? e.status : undefined;
  if (status !== undefined && (status === 0 || status === 408 || status === 429 || status >= 500)) return true;
  return !e?.code; // sem código do banco = a requisição nem chegou a ser respondida
}

export function registrarExecutor(tipo: string, fn: Executor) {
  executores.set(tipo, fn);
}

// Coloca um lançamento na fila e tenta enviar na hora. "cancelar" remove pendências que perderam o
// sentido (ex.: excluir um turno cancela o envio pendente desse turno).
// "mesclar": quando já há um envio esperando com a mesma chave, junta os dois (ex.: produtos alterados
// do turno) em vez de só substituir.
export function enviar(
  tipo: string, dados: unknown,
  opcoes: { chave?: string; cancelar?: string[]; mesclar?: (anterior: any, novo: any) => unknown } = {},
) {
  const { chave, cancelar, mesclar } = opcoes;
  if (cancelar?.length) fila = fila.filter((p) => !p.chave || !cancelar.includes(p.chave));
  if (chave) {
    const anterior = fila.find((p) => p.chave === chave);
    if (anterior && mesclar) dados = mesclar(anterior.dados, dados);
    fila = fila.filter((p) => p.chave !== chave);
  }
  fila.push({ id: crypto.randomUUID(), tipo, chave, dados, tentativas: 0, criadoEm: Date.now() });
  salvar();
  avisar();
  void processar();
}

// Envia o que está na fila, um de cada vez, na ordem. Para no primeiro que falhar por falta de
// conexão (os seguintes podem depender dele) e tenta de novo mais tarde.
export async function processar(): Promise<void> {
  if (enviando || fila.length === 0) { avisar(); return; }
  enviando = true;
  avisar();
  let enviouAlgum = false;
  try {
    while (fila.length > 0) {
      const p = fila[0];
      const fn = executores.get(p.tipo);
      if (!fn) { fila.shift(); salvar(); continue; } // tipo desconhecido (versão antiga): descarta
      try {
        await fn(p.dados);
        // Só sai da fila depois de confirmado (o mesmo item pode ter sido substituído enquanto enviava)
        fila = fila.filter((x) => x.id !== p.id);
        salvar();
        enviouAlgum = true;
      } catch (e: any) {
        if (ehErroTemporario(e)) {
          houveFalha = true;
          p.tentativas += 1;
          p.ultimoErro = String(e?.message ?? e);
          salvar();
          break;
        }
        // Recusado pelo servidor: não adianta reenviar — tira da fila e mostra o aviso
        fila = fila.filter((x) => x.id !== p.id);
        salvar();
        const recusados = [...estado.recusados, { quando: Date.now(), tipo: p.tipo, erro: String(e?.message ?? e) }].slice(-20);
        estado = { ...estado, recusados };
        // eslint-disable-next-line no-console
        console.error("Lançamento recusado pelo servidor:", p.tipo, e);
      }
      avisar();
    }
  } finally {
    enviando = false;
    // "Tudo enviado" só aparece quando o app se recupera de uma falta de internet (não a cada salvamento)
    const recuperou = enviouAlgum && fila.length === 0 && houveFalha;
    if (recuperou) houveFalha = false;
    avisar(recuperou ? { ultimoEnvioOk: Date.now() } : {});
  }
}

export const pendentesDoTipo = <T,>(tipo: string): T[] => fila.filter((p) => p.tipo === tipo).map((p) => p.dados as T);
export const temPendencias = () => fila.length > 0;

export function limparRecusados() {
  estado = { ...estado, recusados: [] };
  avisar();
}

export function assinarFila(fn: () => void) {
  ouvintes.add(fn);
  return () => { ouvintes.delete(fn); };
}
export const estadoFila = () => estado;

// Mudança de conexão do aparelho: atualiza o aviso e, se voltou, envia o que estava esperando
if (typeof window !== "undefined") {
  window.addEventListener("online", () => { avisar(); void processar(); });
  window.addEventListener("offline", () => avisar());
}
