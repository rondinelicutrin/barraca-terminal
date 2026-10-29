import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Shell, TopBar, BottomNav, TurnoBloqueado, useBloqueioTurno, turnoDeOutroFuncionario } from "@/components/Shell";
import {
  useStore, usaTurnoEPonto, getAllProducts, vendeu, sobraOverflow, esperadoTurno, saidasSemVenda, disponivelItem, buscarTurnoAberto,
  arrecadadoTurno, dinheiroNoCaixa, realMaq, nomeMaquina, type ShiftKey, type ShiftItem, type Caixa, type Turno,
} from "@/lib/store";
import { BRL, num, parseBR, parseInt2, todayISO, shiftLabel } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DatePickerBR } from "@/components/ui/date-picker-br";

import { BufferedNumberInput } from "@/components/ui/buffered-number-input";
import { montarRelatorioSobras } from "@/lib/relatorio-sobras";
import { RelatorioSobrasBotoes, camposObrigatoriosDoTurno, situacaoPonto } from "@/components/FechamentoTurno";
import type { Category } from "@/lib/products";
import { EXCLUIR_DO_TOTAL_PASTEL } from "@/lib/products";

export const Route = createFileRoute("/turno")({
  component: TurnoPage,
  head: () => ({ meta: [{ title: "Turno — Barraca Terminal" }] }),
});

function TurnoPage() {
  const { state } = useStore();
  const nav = useNavigate();
  useEffect(() => {
    if (!state.hidratado) return; // espera ler o login salvo (F5 não desloga)
    if (!state.currentUser) nav({ to: "/" });
    else if (!usaTurnoEPonto(state.currentUser)) nav({ to: "/owner" });
  }, [state.hidratado, state.currentUser, nav]);
  const bloqueio = useBloqueioTurno();
  if (!usaTurnoEPonto(state.currentUser)) return null;
  if (bloqueio) return <TurnoBloqueado turno={bloqueio} />;
  return (
    <Shell>
      {state.turnoAtivo ? <ActiveShift /> : <StartShift />}
      <BottomNav />
    </Shell>
  );
}

// Resumo ao final da lista de Pastéis, durante o turno: soma a sobra registrada até agora
// (excluindo casquinhas), para o funcionário/dono terem noção do total em tempo real.
function TotalPasteisResumo({ products, items }: { products: ReturnType<typeof getAllProducts>; items: Record<string, ShiftItem> }) {
  const pasteis = products.filter((p) => p.category === "pastel" && !EXCLUIR_DO_TOTAL_PASTEL.has(p.id));
  const soma = (f: (it: ShiftItem) => number) => pasteis.reduce((s, p) => s + (items[p.id] ? f(items[p.id]) : 0), 0);
  const total = soma((it) => it.sobra ?? 0);
  const entrou = soma((it) => it.entrada + (it.chegada ?? 0));
  const consumo = soma((it) => it.consumo || 0);
  const descarte = soma((it) => it.descarte || 0);
  const vendidos = soma((it) => vendeu(it) ?? 0);
  const faltam = pasteis.filter((p) => items[p.id]?.sobra == null).length;
  return (
    <div className="bg-card border border-primary/40 rounded-xl p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold">Total de pastéis (sobra)</div>
          {faltam > 0 && <div className="text-[11px] text-muted-foreground">{faltam} sabor(es) sem sobra preenchida ainda</div>}
        </div>
        <div className="text-xl font-semibold mono text-primary">{total}</div>
      </div>
      {/* Soma geral dos pastéis: o consumo e o descarte são descontados (não contam como vendidos) */}
      <div className="grid grid-cols-2 gap-x-3 text-[11px] text-muted-foreground mono">
        <span>Entrada + chegada: <span className="text-foreground">{entrou}</span></span>
        <span>Consumo: <span className="text-foreground">{consumo}</span></span>
        <span>Descarte: <span className="text-foreground">{descarte}</span></span>
        <span>Vendidos: <span className="text-foreground font-semibold">{vendidos}</span></span>
      </div>
    </div>
  );
}

// ── Abrir turno ──────────────────────────────────────
function StartShift() {
  const { state, dispatch } = useStore();
  // Data compartilhada com o menu Ponto — evita lançamentos em datas diferentes entre os dois menus
  const date = state.selectedDate;
  const setDate = (d: string) => dispatch({ type: "SET_SELECTED_DATE", date: d });
  const [shift, setShift] = useState<ShiftKey>("manha");
  const [outros, setOutros] = useState<string[]>([]);

  // Ao abrir a tela, a data volta a ser a de hoje (segundo o relógio do celular/computador) —
  // evita começar um turno "preso" numa data antiga esquecida de uma sessão anterior.
  useEffect(() => {
    dispatch({ type: "SET_SELECTED_DATE", date: todayISO() });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hoje = todayISO();

  // Último turno fechado — fica acessível aqui para gerar de novo o relatório de sobras
  // (caso a tela de "Turno fechado" tenha sido fechada ou a página recarregada)
  const ultimoFechado = state.historico.length > 0
    ? state.historico.reduce((a, b) => ((b.closedAt ?? 0) > (a.closedAt ?? 0) ? b : a))
    : null;
  const dataDiferente = date !== hoje;

  const outrosDisponiveis = state.funcionarios.filter((f) => f.ativo !== false && f.username !== state.currentUser?.username);

  const toggleOutro = (username: string) => {
    setOutros((prev) => prev.includes(username) ? prev.filter((u) => u !== username) : [...prev, username]);
  };

  const [abrindo, setAbrindo] = useState(false);
  const handleStart = async () => {
    if (!date) { alert("Selecione a data do turno."); return; }
    // Confere no banco se alguém já abriu um turno (em outro aparelho) antes de abrir outro
    setAbrindo(true);
    const aberto = await buscarTurnoAberto();
    setAbrindo(false);
    if (aberto) {
      if (turnoDeOutroFuncionario(state, aberto)) {
        dispatch({ type: "SET_TURNO_ATIVO_FROM_DB", turnoAtivo: aberto }); // mostra a tela de acesso bloqueado
      } else {
        alert(`Você já tem o turno ${shiftLabel(aberto.shift)} de ${aberto.date.split("-").reverse().join("/")} aberto. Ele foi carregado.`);
        dispatch({ type: "SET_TURNO_ATIVO_FROM_DB", turnoAtivo: aberto });
      }
      return;
    }
    const exists = state.historico.find((t) => t.date === date && t.shift === shift);
    if (exists) {
      alert(`O turno ${shiftLabel(shift)} de ${date.split("-").reverse().join("/")} já foi fechado.`);
      return;
    }
    // Aviso (não bloqueia): confirma que a pessoa está ciente de abrir com data diferente de hoje
    if (dataDiferente) {
      const ok = confirm(
        `ATENÇÃO: VOCÊ ESTÁ ABRINDO O TURNO COM A DATA ${date.split("-").reverse().join("/")}, DIFERENTE DE HOJE (${hoje.split("-").reverse().join("/")}).\n\nTEM CERTEZA QUE É ISSO MESMO?`
      );
      if (!ok) return;
    }
    dispatch({ type: "START_SHIFT", shift, date, employee: state.currentUser!.username, outrosFuncionarios: outros });
  };

  return (
    <>
      <TopBar title="Iniciar Turno" />
      <div className="p-4 space-y-4">
        <p className="text-sm text-muted-foreground">
          Olá, <span className="text-foreground font-medium">{state.currentUser?.nome ?? state.currentUser?.username}</span>. Selecione o turno:
        </p>
        <div className="bg-card border border-border rounded-xl p-4 space-y-3">
          {/* Campo data com calendário (dd/mm/aaaa) */}
          <div>
            <label className="text-xs text-muted-foreground">Data</label>
            <div className="mt-1">
              <DatePickerBR value={date} onChange={setDate} />
            </div>
            {dataDiferente && (
              <p className="text-xs font-bold text-destructive mt-1.5 uppercase tracking-wide bg-destructive/10 border border-destructive/40 rounded-md px-2 py-1.5">
                ⚠️ ATENÇÃO: ESTA DATA É DIFERENTE DE HOJE ({hoje.split("-").reverse().join("/")}). CONFIRA ANTES DE ABRIR O TURNO.
              </p>
            )}
          </div>
          <div className="grid grid-cols-3 gap-2">
            {(["manha", "tarde", "noite"] as ShiftKey[]).map((s) => (
              <button key={s} onClick={() => setShift(s)}
                className={`h-14 rounded-lg border text-sm transition-colors ${shift === s ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-foreground"}`}>
                {shiftLabel(s)}
              </button>
            ))}
          </div>

          {outrosDisponiveis.length > 0 && (
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">
                Mais alguém trabalha neste turno? (opcional)
              </label>
              <div className="flex flex-wrap gap-1.5">
                {outrosDisponiveis.map((f) => (
                  <button
                    key={f.username}
                    type="button"
                    onClick={() => toggleOutro(f.username)}
                    className={`px-2.5 h-8 rounded-full text-xs border transition-colors ${
                      outros.includes(f.username)
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-card border-border text-muted-foreground"
                    }`}
                  >
                    {f.nome}
                  </button>
                ))}
              </div>
            </div>
          )}

          <Button className="w-full h-11" onClick={handleStart} disabled={abrindo}>{abrindo ? "Conferindo…" : "Abrir turno"}</Button>
        </div>

        <div className="bg-card border border-border rounded-xl p-4 space-y-2">
          <div className="text-sm font-medium">Relatório do último turno fechado (caixa e sobras)</div>
          {ultimoFechado ? (
            <>
              <div className="text-xs text-muted-foreground">
                {shiftLabel(ultimoFechado.shift)} · {ultimoFechado.date.split("-").reverse().join("/")}
              </div>
              <RelatorioSobrasBotoes turno={ultimoFechado} />
            </>
          ) : (
            <p className="text-xs text-muted-foreground">
              Os botões de PDF e CSV aparecem aqui assim que o primeiro turno for fechado.
            </p>
          )}
        </div>
      </div>
    </>
  );
}

// ── Turno ativo ──────────────────────────────────────
const CATS: { key: Category; label: string }[] = [
  { key: "pastel",  label: "Pastel"  },
  { key: "caldo",   label: "Caldo"   },
  { key: "bebida",  label: "Bebidas" },
  { key: "outros",  label: "Outros"  },
];

function ActiveShift() {
  const { state, dispatch } = useStore();
  const t = state.turnoAtivo!;
  const products = getAllProducts(state);
  const [tab, setTab] = useState<Category>("pastel");
  const [view, setView] = useState<"produtos" | "caixa">("produtos");

  // Auto-corrige o turno em andamento se um produto novo foi cadastrado depois dele já estar
  // aberto (evita tela quebrada/em branco ao entrar numa aba com produto sem entrada ainda).
  useEffect(() => {
    if (products.some((p) => !t.items[p.id])) {
      dispatch({ type: "SYNC_TURNO_ITEMS", products });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products.length]);

  const camposObrigatorios = camposObrigatoriosDoTurno(t, state.taxasMaquininha);
  const { semPonto } = situacaoPonto(state, t);

  return (
    <>
      <TopBar
        title={`${shiftLabel(t.shift)} · ${t.employee}`}
        right={<span className="text-xs text-muted-foreground mono">{t.date.split("-").reverse().join("/")}</span>}
      />
      {t.outrosFuncionarios && t.outrosFuncionarios.length > 0 && (
        <div className="px-3 -mt-1 mb-1 text-[11px] text-muted-foreground">
          Também no turno:{" "}
          {t.outrosFuncionarios
            .map((u) => state.funcionarios.find((f) => f.username === u)?.nome ?? u)
            .join(", ")}
        </div>
      )}
      <div className="px-3 pt-3">
        <div className="grid grid-cols-2 gap-2 mb-3">
          <button onClick={() => setView("produtos")}
            className={`h-9 rounded-md text-sm ${view === "produtos" ? "bg-primary text-primary-foreground" : "bg-card border border-border"}`}>
            Produtos
          </button>
          <button onClick={() => setView("caixa")}
            className={`h-9 rounded-md text-sm ${view === "caixa" ? "bg-primary text-primary-foreground" : "bg-card border border-border"}`}>
            Caixa
          </button>
        </div>
      </div>

      {view === "produtos" ? (
        <>
          <div className="px-3 flex gap-1 overflow-x-auto pb-2">
            {CATS.map((c) => {
              const faltamCat = products.filter((p) => p.category === c.key)
                .filter((p) => { const it = t.items[p.id]; return !it || it.chegada == null || it.sobra == null; }).length;
              return (
                <button key={c.key} onClick={() => setTab(c.key)}
                  className={`px-3 h-8 rounded-full text-xs whitespace-nowrap flex items-center gap-1 ${tab === c.key ? "bg-primary text-primary-foreground" : "bg-card border border-border text-muted-foreground"}`}>
                  {c.label}
                  {faltamCat > 0 && (
                    <span className={`inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full text-[10px] ${tab === c.key ? "bg-primary-foreground/20" : "bg-warning/20 text-warning"}`}>
                      {faltamCat}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          <div className="p-3 space-y-2">
            {products.filter((p) => p.category === tab).map((p) => (
              <ProductRow key={p.id} product={p} item={t.items[p.id]} />
            ))}
            {tab === "pastel" && <TotalPasteisResumo products={products} items={t.items} />}
          </div>
        </>
      ) : (
        <CaixaView camposObrigatorios={camposObrigatorios} />
      )}

      {/* O fechamento (Esperado / Arrecadado / Diferença) agora fica no menu Ponto */}
      <div className="px-3 pb-4 space-y-3">
        <div className="bg-card border border-border rounded-xl p-3 space-y-2">
          <div className="text-sm font-medium">Relatório do turno (caixa e sobras)</div>
          <p className="text-[11px] text-muted-foreground">
            Gera o arquivo com as sobras dos produtos, o nome de quem está fechando e dos colegas.
            Para o relatório completo, preencha todas as sobras antes de gerar.
          </p>
          <RelatorioSobrasBotoes turno={t} />
        </div>
        <div className={`rounded-xl p-3 text-center border-2 ${semPonto.length > 0 ? "bg-destructive/10 border-destructive" : "bg-card border-border"}`}>
          <p className={`text-xs font-extrabold uppercase leading-snug ${semPonto.length > 0 ? "text-destructive" : "text-muted-foreground"}`}>
            {semPonto.length > 0
              ? `PARA FECHAR O TURNO, VÁ NO MENU PONTO E REGISTRE ENTRADA E SAÍDA DE: ${semPonto.map((s) => s.nome).join(", ").toUpperCase()}.`
              : "PONTO REGISTRADO. PARA FECHAR O TURNO, VÁ NO MENU PONTO."}
          </p>
        </div>
      </div>
    </>
  );
}

function Row({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="flex justify-between items-center text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={`mono font-semibold ${valueClass ?? ""}`}>{value}</span>
    </div>
  );
}

// ── ProductRow ────────────────────────────────────────
function ProductRow({ product, item: itemProp }: { product: ReturnType<typeof getAllProducts>[number]; item: ShiftItem | undefined }) {
  const { state, dispatch } = useStore();
  // Proteção: se o produto foi adicionado ao catálogo depois deste turno já estar aberto,
  // pode não existir item correspondente ainda — usa um item vazio em vez de quebrar a tela.
  const item: ShiftItem = itemProp ?? { entrada: 0, chegada: null, sobra: null, consumo: 0, descarte: 0, consumoEst: product.special ? 0 : undefined };
  const v        = vendeu(item);
  const overflow = sobraOverflow(item);
  const estoqueTotal = item.entrada + (item.chegada ?? 0);

  // Alerta de estoque baixo definido pelo dono (Produtos): quantidade em estoque <= alerta configurado
  const estoqueAtual  = state.estoqueQtd[product.id] ?? 0;
  const estoqueMinimo = state.estoqueMinimo[product.id] ?? 0;
  const lowStock = estoqueMinimo > 0 && estoqueAtual <= estoqueMinimo;

  // Limite máximo para sobra/consumo/descarte = entrada + chegada
  const limiteEstoque = estoqueTotal;

  const fmtQ = (n: number) => (product.decimal ? num(n) : String(n));
  const upd = (patch: Partial<ShiftItem>) =>
    dispatch({ type: "UPDATE_ITEM", productId: product.id, patch });

  // Valida se sobra excede estoque. n=null significa "campo apagado" (não preenchido);
  // n=0 é um valor real e explícito (acabou tudo) e deve ser aceito normalmente.
  // Com a chegada ainda vazia não dá para saber o limite (a pessoa pode preencher a sobra primeiro);
  // com a chegada preenchida — inclusive 0 — a sobra nunca pode passar de entrada + chegada.
  // O consumo e o descarte já saíram do estoque: a sobra não pode passar do que ficou disponível.
  const saidas = saidasSemVenda(item);
  const disponivel = disponivelItem(item);
  const handleSobra = (n: number | null) => {
    if (n != null && n > disponivel && (item.chegada != null || limiteEstoque > 0)) {
      alert(saidas > 0
        ? `Sobra não pode ser maior que o disponível: entrada + chegada (${fmtQ(limiteEstoque)}) − consumo/descarte (${fmtQ(saidas)}) = ${fmtQ(disponivel)}.`
        : `Sobra não pode ser maior que entrada + chegada (${fmtQ(limiteEstoque)}).`);
      return;
    }
    upd({ sobra: n });
  };

  // Valida consumoEst (gelo barraca)
  const handleConsumoEst = (n: number) => {
    const usado = (item.consumo || 0) + (item.descarte || 0);
    if (n + usado > limiteEstoque && limiteEstoque > 0) {
      alert(`Consumo Barraca + Consumo Funcionário + Descarte não pode exceder a entrada + chegada (${limiteEstoque}).`);
      return;
    }
    upd({ consumoEst: n });
  };

  return (
    <div className="bg-card border border-border rounded-lg p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="text-sm font-medium flex items-center gap-1.5">
          {product.name}
          {lowStock && <span className="text-warning text-[10px] font-semibold">⚠ estoque baixo</span>}
          {!product.saleable && <span className="text-[10px] text-muted-foreground">(só estoque)</span>}
        </div>
        <div className="mono text-xs text-muted-foreground">
          {product.saleable && product.price > 0 ? BRL(product.price) : "—"}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-1.5">
        <Field label="Entrada" value={item.entrada} readOnly blue decimal={product.decimal} />
        <Field label="Chegada" value={item.chegada ?? ""} placeholder="—" decimal={product.decimal}
          onChangeNullable={(n) => upd({ chegada: n })} />
        <Field label="Sobra" value={item.sobra ?? ""} placeholder="—" decimal={product.decimal}
          error={overflow}
          onChangeNullable={handleSobra} />
      </div>

      {/* Gelo: campo "CONSUMO BARRACA" */}
      {product.special && (
        <div className="mt-1.5">
          <Field
            label="CONSUMO BARRACA"
            value={item.consumoEst ?? 0}
            onChange={handleConsumoEst}
          />
        </div>
      )}

      {saidas > 0 && (
        <div className="mt-1.5 text-[11px] text-muted-foreground flex flex-wrap gap-x-3">
          {(item.consumo || 0) > 0 && <span>Consumo: <span className="mono text-foreground">{fmtQ(item.consumo)}</span></span>}
          {(item.consumoEst || 0) > 0 && <span>Consumo barraca: <span className="mono text-foreground">{fmtQ(item.consumoEst ?? 0)}</span></span>}
          {(item.descarte || 0) > 0 && <span>Descarte: <span className="mono text-foreground">{fmtQ(item.descarte)}</span></span>}
          <span>Disponível: <span className="mono text-foreground font-semibold">{fmtQ(disponivel)}</span></span>
        </div>
      )}
      <div className="mt-2 flex justify-between items-center text-xs">
        <span className="text-muted-foreground">Vendeu</span>
        <span className="mono font-semibold text-primary">
          {v == null ? "—" : `${product.decimal ? num(v) : v} · ${BRL(v * (product.saleable ? product.price : 0))}`}
        </span>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, onChangeNullable, readOnly, blue, error, placeholder, decimal }: {
  label: string; value: number | string;
  onChange?: (n: number) => void;
  // Use quando o campo pode ficar "não preenchido" (null) — string vazia dispara null em vez de 0,
  // permitindo digitar o número zero normalmente sem ele ser confundido com "campo vazio".
  onChangeNullable?: (n: number | null) => void;
  readOnly?: boolean; blue?: boolean; error?: boolean; placeholder?: string; decimal?: boolean;
}) {
  const display = (v: number | string) => (v === "" ? "" : decimal ? num(Number(v)) : String(v));
  const [text, setText] = useState(() => display(value));
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setText(display(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <label className="flex flex-col gap-0.5">
      <span className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</span>
      <input
        type="text" inputMode={decimal ? "decimal" : "numeric"} readOnly={readOnly} placeholder={placeholder}
        value={text}
        onFocus={() => { focused.current = true; }}
        onBlur={() => { focused.current = false; setText(display(value)); }}
        onChange={(e) => {
          const raw = e.target.value;
          setText(raw);
          if (onChangeNullable) {
            // Campo realmente vazio (apagado) → null ("não preenchido"). Qualquer número digitado,
            // incluindo "0", é enviado como número — nunca convertido de volta para null.
            onChangeNullable(raw.trim() === "" ? null : (decimal ? parseBR(raw) : parseInt2(raw)));
            return;
          }
          onChange?.(decimal ? parseBR(raw) : parseInt2(raw));
        }}
        className={`h-9 rounded-md px-2 text-sm mono text-center border bg-input border-border
          ${blue   ? "field-blue"  : ""}
          ${error  ? "field-error" : ""}
          ${readOnly ? "opacity-90 cursor-not-allowed" : ""}`}
      />
    </label>
  );
}

// ── MoneyField com marcação de campo preenchido ───────
function MoneyField({
  label, value, fieldKey, onChange, required,
}: {
  label: string;
  value: number;
  fieldKey: string;
  onChange: (n: number) => void;
  required?: boolean;
}) {
  const { state, dispatch } = useStore();
  const preenchido = state.turnoAtivo?.caixa.camposPreenchidos?.[fieldKey] ?? false;

  const [raw, setRaw] = useState(value > 0 ? value.toFixed(2).replace(".", ",") : "");

  const markFilled = (n: number) => {
    // Marca como preenchido assim que o usuário digitar qualquer valor (inclusive 0)
    dispatch({
      type: "UPDATE_CAIXA",
      patch: { camposPreenchidos: { ...state.turnoAtivo?.caixa.camposPreenchidos, [fieldKey]: true } },
    });
    onChange(n);
  };

  return (
    <div className="relative">
      <label className="text-xs text-muted-foreground flex items-center gap-1">
        {label}
        {required && !preenchido && <span className="text-destructive text-[10px]">*</span>}
        {required && preenchido  && <span className="text-success text-[10px]">✓</span>}
      </label>
      <input
        type="text"
        inputMode="decimal"
        className={`mt-1 w-full h-10 rounded-md bg-input px-3 text-sm mono border ${
          required && !preenchido ? "border-warning" : "border-border"
        }`}
        value={raw}
        placeholder="0,00"
        onChange={(e) => {
          setRaw(e.target.value);
          markFilled(parseBR(e.target.value));
        }}
        onBlur={() => {
          const n = parseBR(raw);
          setRaw(n > 0 ? n.toFixed(2).replace(".", ",") : "0,00");
          markFilled(n);
        }}
      />
    </div>
  );
}

// ── CaixaView ─────────────────────────────────────────
function CaixaView({ camposObrigatorios }: { camposObrigatorios: { key: string; label: string }[] }) {
  const { state, dispatch } = useStore();
  const t = state.turnoAtivo!;
  const c = t.caixa;
  const isNoite  = t.shift === "noite";
  const maq1Real = realMaq(c.maq1, t.shift);
  const maq2Real = c.maq2Ativa ? realMaq(c.maq2, t.shift) : 0;

  // Dinheiro que fica no caixa após separar o malote
  const dinheiroRestante = dinheiroNoCaixa(c);
  // Variação de moedas
  const variacaoMoedas = (c.moedasFinal || 0) - (c.moedasInicial || 0);

  const upd = (patch: Partial<typeof c>) =>
    dispatch({ type: "UPDATE_CAIXA", patch });

  const updMaq = (which: "maq1" | "maq2", patch: Record<string, number>) =>
    dispatch({ type: "UPDATE_MAQ", which, patch });

  const markFilled = (key: string) =>
    upd({ camposPreenchidos: { ...c.camposPreenchidos, [key]: true } });
  // Valor da maquininha menor que o do turno anterior: o campo volta a contar como não preenchido
  const desmarcar = (key: string) =>
    upd({ camposPreenchidos: { ...c.camposPreenchidos, [key]: false } });

  return (
    <div className="p-3 space-y-3">

      {/* Alerta de campos obrigatórios não preenchidos */}
      {(() => {
        const faltam = camposObrigatorios.filter(({ key }) => !c.camposPreenchidos?.[key]);
        if (faltam.length === 0) return null;
        return (
          <div className="bg-warning/10 border border-warning rounded-lg px-3 py-2 text-xs text-warning">
            Preencha todos os campos obrigatórios antes de fechar:{" "}
            {faltam.map((f) => f.label).join(", ")}
          </div>
        );
      })()}

      {/* ── Dinheiro ── */}
      <div className="bg-card border border-border rounded-xl p-3 space-y-3">
        <div className="text-sm font-medium">💵 Dinheiro</div>

        <MoneyField
          label="Dinheiro Final (todo o dinheiro contado)"
          value={c.dinheiroFinal}
          fieldKey="dinheiroFinal"
          required
          onChange={(n) => upd({ dinheiroFinal: n })}
        />

        <MoneyField
          label="Dinheiro Malote (parte enviada ao dono)"
          value={c.dinheiroMalote}
          fieldKey="dinheiroMalote"
          required
          onChange={(n) => upd({ dinheiroMalote: n })}
        />

        {c.dinheiroFinal > 0 && (
          <div className="text-xs text-muted-foreground">
            Fica no caixa:{" "}
            <span className="mono font-semibold text-success">{BRL(dinheiroRestante)}</span>
            {" "}= Dinheiro Final − Malote
          </div>
        )}

        {c.caixaFimPrev > 0 && (
          <div className="text-xs text-muted-foreground">
            Caixa anterior (ref.):{" "}
            <span className="mono">{BRL(c.caixaFimPrev)}</span>
          </div>
        )}
      </div>

      {/* ── Moedas ── */}
      <div className="bg-card border border-border rounded-xl p-3 space-y-3">
        <div className="text-sm font-medium">🪙 Moedas</div>

        <div>
          <div className="text-xs text-muted-foreground">
            Moedas Inicial (herdado do turno anterior)
          </div>
          <div className="mono text-sm mt-1 px-3 py-2 rounded-md bg-input/50 border border-border opacity-70">
            {BRL(c.moedasInicial)}
          </div>
        </div>

        <MoneyField
          label="Moedas Final (contagem atual)"
          value={c.moedasFinal}
          fieldKey="moedasFinal"
          required
          onChange={(n) => upd({ moedasFinal: n })}
        />

        {c.moedasFinal > 0 && (
          <div className={`text-xs ${variacaoMoedas >= 0 ? "text-success" : "text-destructive"}`}>
            Variação: <span className="mono font-semibold">{variacaoMoedas >= 0 ? "+" : ""}{BRL(variacaoMoedas)}</span>
          </div>
        )}
      </div>

      {/* ── Pix ── */}
      <div className="bg-card border border-border rounded-xl p-3 space-y-3">
        <div className="text-sm font-medium">📱 Pix</div>
        <MoneyField label="Pix manual" value={c.pix} fieldKey="pix" required
          onChange={(n) => upd({ pix: n })} />
      </div>

      {/* ── Maquininha 1 ── */}
      <MaquininhaCard
        label={nomeMaquina(state.taxasMaquininha, "maq1")}
        m={c.maq1}
        isNoite={isNoite}
        real={maq1Real}
        onChange={(patch) => updMaq("maq1", patch)}
        onFilled={(campo) => markFilled(`maq1.${campo}`)}
        onInvalido={(campo) => desmarcar(`maq1.${campo}`)}
        preench={(campo) => !!c.camposPreenchidos?.[`maq1.${campo}`]}
      />

      {/* ── Maquininha 2 ── */}
      <div className="bg-card border border-border rounded-xl p-3">
        <label className="flex items-center gap-2 text-sm mb-2">
          <Checkbox
            checked={c.maq2Ativa}
            onCheckedChange={(v) => upd({ maq2Ativa: !!v })}
          />
          Usar {nomeMaquina(state.taxasMaquininha, "maq2")}
        </label>
        {c.maq2Ativa && (
          <MaquininhaCard
            label={nomeMaquina(state.taxasMaquininha, "maq2")}
            m={c.maq2}
            isNoite={isNoite}
            real={maq2Real}
            onChange={(patch) => updMaq("maq2", patch)}
            onFilled={(campo) => markFilled(`maq2.${campo}`)}
            onInvalido={(campo) => desmarcar(`maq2.${campo}`)}
            preench={(campo) => !!c.camposPreenchidos?.[`maq2.${campo}`]}
            bare
          />
        )}
      </div>
    </div>
  );
}

type CampoMaq = "display" | "ate00" | "apos00";
function MaquininhaCard({ label, m, isNoite, real, onChange, onFilled, onInvalido, preench, bare }: {
  label: string;
  m: any;
  isNoite: boolean;
  real: number;
  onChange: (patch: any) => void;
  onFilled: (campo: CampoMaq) => void;
  onInvalido: (campo: CampoMaq) => void;
  preench: (campo: CampoMaq) => boolean;
  bare?: boolean;
}) {
  // O valor nunca pode ser menor que o do turno anterior (base). Confere quando a pessoa termina de
  // digitar (sai do campo) — conferir a cada tecla daria alerta no meio da digitação.
  const base: number = m.base ?? 0;
  const [abaixo, setAbaixo] = useState(false);
  const conferir = (campo: CampoMaq) => (n: number) => {
    if (n < base) {
      alert(`ATENÇÃO: o valor da ${label} só pode ser IGUAL OU MAIOR que o valor do turno anterior (${BRL(base)}).\n\n` +
        `Você lançou ${BRL(n)}. Confira o valor exibido na maquininha e corrija.`);
      onInvalido(campo);
      setAbaixo(true);
    } else {
      setAbaixo(false);
    }
  };
  const avisoAbaixo = abaixo && (
    <p className="text-[11px] font-semibold text-destructive mt-1">
      Menor que o turno anterior ({BRL(base)}). O valor só pode ser igual ou maior.
    </p>
  );
  // Todos os campos da maquininha são obrigatórios: no turno da noite os dois valores
  const preenchido = isNoite ? preench("ate00") && preench("apos00") : preench("display");
  const cls = bare ? "space-y-2" : "bg-card border border-border rounded-xl p-3 space-y-2";
  return (
    <div className={cls}>
      {!bare && (
        <div className="flex justify-between items-center text-sm font-medium">
          <span>{label}</span>
          {!preenchido && <span className="text-destructive text-[10px]">*</span>}
          {preenchido  && <span className="text-success text-[10px]">✓</span>}
        </div>
      )}
      <div className="text-xs text-muted-foreground">
        Base (turno anterior): <span className="mono">{BRL(m.base)}</span>
      </div>

      {!isNoite ? (
        <div>
          <label className="text-xs text-muted-foreground flex gap-1">
            Valor exibido na maquininha
            {!preenchido && <span className="text-destructive">*</span>}
            {preenchido  && <span className="text-success">✓</span>}
          </label>
          <BufferedNumberInput
            value={m.display ?? 0}
            placeholder="0,00"
            className={`mt-1 w-full h-10 px-3 ${!preenchido ? "border-warning" : "border-border"}`}
            onChange={(n) => { onChange({ display: n }); onFilled("display"); }}
            onBlur={conferir("display")}
          />
          {avisoAbaixo}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-xs text-muted-foreground flex gap-1">
              Até 00:00
              {!preench("ate00") ? <span className="text-destructive">*</span> : <span className="text-success">✓</span>}
            </label>
            <BufferedNumberInput
              value={m.ate00 ?? 0}
              placeholder="0,00"
              className={`mt-1 w-full h-10 px-3 ${!preench("ate00") ? "border-warning" : "border-border"}`}
              onChange={(n) => { onChange({ ate00: n, display: n }); onFilled("ate00"); }}
              onBlur={conferir("ate00")}
            />
            {avisoAbaixo}
          </div>
          <div>
            <label className="text-xs text-muted-foreground flex gap-1">
              Após 00:00
              {!preench("apos00") ? <span className="text-destructive">*</span> : <span className="text-success">✓</span>}
            </label>
            <BufferedNumberInput
              value={m.apos00 ?? 0}
              placeholder="0,00"
              className={`mt-1 w-full h-10 px-3 ${!preench("apos00") ? "border-warning" : "border-border"}`}
              onChange={(n) => { onChange({ apos00: n }); onFilled("apos00"); }}
            />
            <p className="text-[10px] text-muted-foreground mt-1">A maquininha zera à meia-noite: este valor começa do 0.</p>
          </div>
        </div>
      )}

      <div className="text-sm text-right">
        Real: <span className="mono font-semibold text-primary">{BRL(real)}</span>
      </div>
    </div>
  );
}
