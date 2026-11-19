import { useState } from "react";
import { useStore, getAllProducts, valorConsumoPonto, valoresConsumoPonto, ehSoConsumo, type Turno, type ShiftItem } from "@/lib/store";
import { BRL, shiftLabel } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { BufferedNumberInput } from "@/components/ui/buffered-number-input";
import { limiteDisponivel } from "@/components/Modals";

const dataBR = (d: string) => d.split("-").reverse().join("/");

// Quanto ainda dá para tirar do estoque do turno (consumo ou descarte): entrada + chegada menos o que já saiu.
// Com a sobra já contada, também não pode passar do que sobrou fora dela (senão o "vendido" ficaria negativo).
function disponivelPara(it: ShiftItem | undefined, tipo: "consumo" | "descarte"): number {
  if (!it) return 0;
  const livre = limiteDisponivel(it, tipo);
  if (it.sobra == null) return livre;
  const saiu = (it.consumo || 0) + (it.descarte || 0) + (it.consumoEst || 0);
  return Math.max(0, Math.min(livre, (it.entrada || 0) + (it.chegada || 0) - it.sobra - saiu));
}

function avisoSemEstoque(nome: string, it: ShiftItem | undefined, disp: number) {
  alert(!it || (!it.entrada && it.chegada == null)
    ? `Sem estoque de ${nome} no turno. Preencha primeiro a Entrada/Chegada de ${nome} no menu Turno.`
    : it.sobra != null
      ? `Só ${disp} unidade(s) de ${nome} podem sair do estoque: a sobra lançada é ${it.sobra}. Se a sobra estiver errada, corrija no menu Turno.`
      : `Só ${disp} unidade(s) de ${nome} disponíveis no estoque do turno (entrada + chegada − o que já saiu).`);
}

// Lança (+) ou tira (−) consumo só na folha da pessoa (ponto do dia do turno). Usado pelo campo "Consumo func."
// do Histórico → ✏️ (aba Produtos): quem muda o número ali já mexe no estoque do turno; isto leva a mesma
// diferença para o ponto da pessoa, para aparecer na folha e no fechamento.
type StoreCtx = ReturnType<typeof useStore>;
export function ajustarFolhaConsumo(state: StoreCtx["state"], dispatch: StoreCtx["dispatch"], u: string, date: string, pid: string, delta: number) {
  const ps = state.pontos.filter((p) => p.employeeUsername === u && p.date === date);
  if (delta > 0) {
    const alvo = ps.find((p) => p.consumo.some((c) => c.productId === pid)) ?? ps.find((p) => !ehSoConsumo(p)) ?? ps[0];
    if (alvo) {
      const q = alvo.consumo.find((c) => c.productId === pid)?.qty ?? 0;
      dispatch({ type: "UPDATE_PONTO_CONSUMO", pontoId: alvo.id, productId: pid, qty: q + delta });
    } else {
      dispatch({ type: "ADD_PONTO", p: { id: crypto.randomUUID(), employeeUsername: u, date, entrada: "00:00", saida: "00:00",
        transporte: 0, refeicao: 0, colegas: [], consumo: [{ productId: pid, qty: delta }] } });
    }
    return delta;
  }
  let resto = -delta;
  for (const p of [...ps].reverse()) {
    const q = p.consumo.find((c) => c.productId === pid)?.qty ?? 0;
    if (!q || resto <= 0) continue;
    const tira = Math.min(q, resto);
    dispatch({ type: "UPDATE_PONTO_CONSUMO", pontoId: p.id, productId: pid, qty: q - tira });
    resto -= tira;
  }
  return delta + resto; // quanto foi tirado de fato (negativo)
}

// Quantidade com botões − e + (no celular, digitar a quantidade gerava zeros por engano)
function MenosMais({ qtd, onChange, rotulo }: { qtd: number; onChange: (n: number) => void; rotulo: string }) {
  return (
    <span className="inline-flex items-center rounded-md border border-border bg-input overflow-hidden shrink-0">
      <button type="button" aria-label={`Menos ${rotulo}`} onClick={() => onChange(qtd - 1)} className="w-9 h-9 text-lg leading-none hover:bg-muted">−</button>
      <span className="w-8 text-center mono text-sm">{qtd}</span>
      <button type="button" aria-label={`Mais ${rotulo}`} onClick={() => onChange(qtd + 1)} className="w-9 h-9 text-lg leading-none hover:bg-muted">+</button>
    </span>
  );
}

// Consumo de cada pessoa do turno. Grava na hora nos dois lugares, sempre juntos:
// - no ponto da pessoa na data do turno (é o que a folha desconta; sem ponto, cria um registro só de consumo);
// - na coluna Consumo do turno (estoque), para o resultado do fechamento continuar certo.
// modo "correcao": dono/administrador em Histórico → ✏️ (turno aberto ou fechado), quantidade digitada.
// modo "ponto": menu Ponto, com o turno aberto, por quem abriu o turno (ou dono/administrador): botões − e +.
export function ConsumoTurnoEditor({ local, setLocal, isAtivo, modo = "correcao", somenteLeitura = false }: {
  local: Turno; setLocal: (t: Turno) => void; isAtivo: boolean; modo?: "correcao" | "ponto"; somenteLeitura?: boolean;
}) {
  const { state, dispatch } = useStore();
  const products = getAllProducts(state);
  // Formulário único: pessoa → item → quantidade → Incluir (só aparece na lista quem tem consumo lançado)
  const [novo, setNovo] = useState<{ pessoa: string; pid: string; qtd: number }>({ pessoa: "", pid: "", qtd: 1 });
  const nome = (u: string) => state.funcionarios.find((f) => f.username === u)?.nome ?? u;
  const nomeProd = (pid: string) => products.find((p) => p.id === pid)?.name ?? pid;
  // Quem trabalhou no turno e quem só passou para consumir (lista guardada no turno, lida do estado atual)
  const atual = state.turnoAtivo?.id === local.id ? state.turnoAtivo : state.historico.find((h) => h.id === local.id);
  const soConsumo = atual?.consumidores ?? local.consumidores ?? [];
  const trabalhou = new Set([local.employee, ...(local.outrosFuncionarios ?? [])]);
  const pessoas = [...new Set([local.employee, ...(local.outrosFuncionarios ?? []), ...soConsumo])];
  // Opções do formulário: primeiro quem está no turno, depois os outros funcionários cadastrados (colegas que só consumiram)
  const outrosCadastrados = state.funcionarios.filter((f) => !f.excluido && f.ativo !== false && !trabalhou.has(f.username));
  const pontosDe = (u: string) => state.pontos.filter((p) => p.employeeUsername === u && p.date === local.date);
  const qtd = (u: string, pid: string) =>
    pontosDe(u).reduce((s, p) => s + (p.consumo.find((c) => c.productId === pid)?.qty ?? 0), 0);
  const itensDe = (u: string) => {
    const m: Record<string, number> = {};
    for (const p of pontosDe(u)) for (const c of p.consumo) m[c.productId] = (m[c.productId] ?? 0) + c.qty;
    return Object.entries(m).filter(([, q]) => q > 0).map(([productId, q]) => ({ productId, qty: q }));
  };
  const naPonto = modo === "ponto";
  // Quanto da coluna Consumo do turno não está no ponto de ninguém do turno (ex.: lançado direto no estoque)
  const itensTurno = (isAtivo && state.turnoAtivo ? state.turnoAtivo.items : atual?.items ?? local.items);
  const semDono = (pid: string) => Math.max(0, (itensTurno[pid]?.consumo || 0) - pessoas.reduce((s, u) => s + qtd(u, pid), 0));
  const semDonoLista = products.filter((p) => semDono(p.id) > 0).map((p) => `${semDono(p.id)}x ${p.name}`);
  const eu = state.currentUser?.username;

  // Ajusta a coluna Consumo do turno (estoque) pela diferença
  // Ajusta as colunas do turno (estoque): Consumo pela diferença e, quando um descarte vira consumo, Descarte também
  const ajustarTurno = (pid: string, delta: number, deltaDescarte = 0) => {
    const soma = (it: ShiftItem | undefined): ShiftItem => {
      const base = it ?? { entrada: 0, chegada: 0, sobra: 0, consumo: 0, descarte: 0 };
      return { ...base, consumo: Math.max(0, (base.consumo || 0) + delta), descarte: Math.max(0, (base.descarte || 0) + deltaDescarte) };
    };
    setLocal({ ...local, items: { ...local.items, [pid]: soma(local.items[pid]) } });
    if (isAtivo && state.turnoAtivo) {
      const novo = soma(state.turnoAtivo.items[pid]);
      dispatch({ type: "UPDATE_ITEM", productId: pid, patch: deltaDescarte ? { consumo: novo.consumo, descarte: novo.descarte } : { consumo: novo.consumo } });
    } else {
      const t = state.historico.find((h) => h.id === local.id);
      if (t) dispatch({ type: "EDIT_HIST", id: t.id, turno: { ...t, items: { ...t.items, [pid]: soma(t.items[pid]) } } });
    }
  };

  const definir = (u: string, pid: string, novoTotal: number) => {
    const atual = qtd(u, pid);
    const delta = Math.round(novoTotal) - atual;
    if (delta === 0 || novoTotal < 0) return;
    const it = (isAtivo && state.turnoAtivo ? state.turnoAtivo.items : local.items)[pid];
    // Consumo "sem dono" (já está no estoque do turno, mas não no ponto de ninguém): ao incluir para a pessoa,
    // usa primeiro esse consumo — ele já saiu do estoque, então não soma de novo na coluna Consumo do turno
    const usaSemDono = delta > 0 ? Math.min(delta, semDono(pid)) : 0;
    const deltaTurno = delta - usaSemDono;
    // Descarte que na verdade foi consumo (ex.: bebida lançada como descarte): oferece transformar em consumo da
    // pessoa — sai do Descarte e entra no Consumo do turno, sem tirar de novo do estoque
    let usaDescarte = 0;
    const descAtual = it?.descarte || 0;
    if (deltaTurno > 0 && descAtual > 0) {
      const n = Math.min(deltaTurno, descAtual);
      if (confirm(`${nomeProd(pid)}: há ${descAtual} lançado(s) como DESCARTE neste turno.\n\nTransformar ${n} desse descarte em consumo de ${nome(u)}?\n\nOK = transformar (sai do descarte)\nCancelar = lançar como consumo a mais, mantendo o descarte`)) usaDescarte = n;
    }
    const novoNoEstoque = deltaTurno - usaDescarte; // o que ainda vai sair do estoque além do que já tinha saído
    if (novoNoEstoque > 0) {
      if (naPonto) {
        // Turno aberto: não deixa tirar do estoque mais do que tem
        const disp = disponivelPara(it, "consumo");
        if (novoNoEstoque > disp) { avisoSemEstoque(nomeProd(pid), it, disp); return; }
      } else if (local.closedAt && it) {
        // Correção do dono: consumo maior do que o que saiu do estoque deixaria o "vendido" negativo
        const livre = it.entrada + (it.chegada ?? 0) - (it.sobra ?? 0) - (it.consumo || 0) - (it.descarte || 0) - (it.consumoEst || 0);
        if (novoNoEstoque > livre && !confirm(`${nomeProd(pid)}: só ${Math.max(0, livre)} unidade(s) saíram do estoque sem consumo/descarte neste turno (entrada + chegada − sobra). Lançar ${novoNoEstoque} mesmo assim?`)) return;
      }
    }
    if (delta > 0) {
      const ps = pontosDe(u);
      const alvo = ps.find((p) => p.consumo.some((c) => c.productId === pid)) ?? ps.find((p) => !ehSoConsumo(p)) ?? ps[0];
      if (alvo) {
        const q = alvo.consumo.find((c) => c.productId === pid)?.qty ?? 0;
        dispatch({ type: "UPDATE_PONTO_CONSUMO", pontoId: alvo.id, productId: pid, qty: q + delta });
      } else {
        dispatch({ type: "ADD_PONTO", p: { id: crypto.randomUUID(), employeeUsername: u, date: local.date, entrada: "00:00", saida: "00:00",
          transporte: 0, refeicao: 0, colegas: [], consumo: [{ productId: pid, qty: delta }] } });
      }
    } else {
      let resto = -delta;
      for (const p of [...pontosDe(u)].reverse()) {
        const q = p.consumo.find((c) => c.productId === pid)?.qty ?? 0;
        if (!q || resto <= 0) continue;
        const tira = Math.min(q, resto);
        dispatch({ type: "UPDATE_PONTO_CONSUMO", pontoId: p.id, productId: pid, qty: q - tira });
        resto -= tira;
      }
    }
    if (deltaTurno !== 0 || usaDescarte) ajustarTurno(pid, deltaTurno, -usaDescarte);
  };
  const tirarOuDefinir = (u: string, pid: string, q: number) => {
    if (q <= 0) {
      if (!confirm(`Tirar ${nomeProd(pid)} do consumo de ${nome(u)}?`)) return;
      q = 0;
    }
    definir(u, pid, q);
  };

  return (
    <div className="bg-card border border-border rounded-xl p-3 space-y-3" id={naPonto ? "lancar-consumo" : undefined}>
      <div>
        <div className="text-sm font-semibold">
          {naPonto ? `🍽 Consumo do turno (${shiftLabel(local.shift)} ${dataBR(local.date)})` : "🍽 Consumo dos funcionários do turno"}
        </div>
        <p className="text-[11px] text-muted-foreground">
          {somenteLeitura
            ? `🔒 Quem lança o consumo é ${nome(local.employee)} (abriu o turno). Peça para incluir o seu.`
            : naPonto
              ? "Lance o consumo de cada pessoa do turno. Grava na hora: já entra na folha da pessoa (valor com o desconto de funcionário) e sai do estoque do turno."
              : "Altere a quantidade (0 tira o item) ou inclua o que foi esquecido. Grava na hora: entra na folha da pessoa e na coluna Consumo do turno (o esperado do fechamento é recalculado)."}
        </p>
      </div>
      {(() => {
        const comConsumo = pessoas.filter((u) => itensDe(u).length > 0);
        const semConsumo = [...trabalhou].filter((u) => itensDe(u).length === 0);
        return (
          <>
            {comConsumo.length === 0 && <div className="text-[11px] text-muted-foreground">Nenhum consumo lançado neste turno.</div>}
            {comConsumo.map((u) => {
              const itens = itensDe(u);
              const valores = valoresConsumoPonto(state, u, itens);
              return (
                <div key={u} className="bg-background border border-border/60 rounded-lg p-2 space-y-1.5">
                  <div className="flex justify-between text-xs font-semibold">
                    <span>{nome(u)}{naPonto && u === eu ? " (você)" : ""}{!trabalhou.has(u) && <span className="font-normal text-muted-foreground"> · só consumo</span>}</span>
                    <span className="mono">{BRL(valorConsumoPonto(state, u, itens))}</span>
                  </div>
                  {itens.map((c) => {
                    const rot = `${nomeProd(c.productId)} de ${nome(u)}`;
                    const v = valores[c.productId] ?? 0;
                    return (
                      <div key={c.productId} className="flex items-center justify-between gap-2 text-xs">
                        <span className="flex items-center gap-1.5 min-w-0">
                          {somenteLeitura ? <span className="mono w-6 text-right">{c.qty}x</span>
                            : naPonto ? <MenosMais qtd={c.qty} rotulo={rot} onChange={(q) => tirarOuDefinir(u, c.productId, q)} />
                            : <BufferedNumberInput value={c.qty} decimal={false} className="w-14 h-8 text-xs" aria-label={`Consumo de ${nome(u)}: ${nomeProd(c.productId)}`}
                                onChange={() => {}} onBlur={(q) => tirarOuDefinir(u, c.productId, q)} />}
                          <span className="truncate">{naPonto ? "" : "× "}{nomeProd(c.productId)}</span>
                        </span>
                        <span className="mono shrink-0">{v < 0.005 ? "grátis" : BRL(v)}</span>
                      </div>
                    );
                  })}
                </div>
              );
            })}
            {!somenteLeitura && semDonoLista.length > 0 && (
              <div className="text-[11px] text-warning font-semibold bg-warning/10 border border-warning/40 rounded-md p-2">
                ⚠ Consumo sem dono neste turno: {semDonoLista.join(", ")}. Inclua abaixo para quem consumiu (não soma de novo no estoque).
              </div>
            )}
            {naPonto && !somenteLeitura && semConsumo.length > 0 && (
              <div className="text-[11px] text-warning font-semibold">⚠ Sem consumo lançado: {semConsumo.map(nome).join(", ")}</div>
            )}
            {!somenteLeitura && (
              <div className="bg-background border border-border/60 rounded-lg p-2 space-y-1.5">
                <div className="text-[11px] font-semibold">+ Incluir consumo</div>
                <select value={novo.pessoa} aria-label="Pessoa do consumo" onChange={(e) => setNovo({ ...novo, pessoa: e.target.value })}
                  className="w-full h-9 rounded-md bg-input border border-border px-2 text-xs">
                  <option value="">De quem?</option>
                  <optgroup label="No turno">
                    {[...trabalhou].map((u) => <option key={u} value={u}>{nome(u)}{naPonto && u === eu ? " (você)" : ""}</option>)}
                  </optgroup>
                  {outrosCadastrados.length > 0 && (
                    <optgroup label="Colegas que só consumiram">
                      {outrosCadastrados.map((f) => <option key={f.username} value={f.username}>{f.nome}</option>)}
                    </optgroup>
                  )}
                </select>
                <div className="flex items-center gap-1.5">
                  <select value={novo.pid} aria-label="Produto do consumo" onChange={(e) => setNovo({ ...novo, pid: e.target.value })}
                    className="flex-1 min-w-0 h-9 rounded-md bg-input border border-border px-2 text-xs">
                    <option value="">Item…</option>
                    {products.filter((p) => p.saleable).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                  <BufferedNumberInput value={novo.qtd} decimal={false} className="w-12 h-9 text-xs" aria-label="Quantidade do consumo"
                    onChange={(q) => setNovo({ ...novo, qtd: q })} />
                  <Button variant="secondary" className="h-9 px-2 text-xs" aria-label="Incluir consumo" disabled={!novo.pessoa || !novo.pid || novo.qtd <= 0}
                    onClick={() => {
                      const u = novo.pessoa;
                      // Colega que não trabalhou no turno: fica guardado no turno como "só consumo" (sem exigir ponto)
                      if (!trabalhou.has(u) && !soConsumo.includes(u)) dispatch({ type: "ADD_CONSUMIDOR_TURNO", turnoId: local.id, username: u });
                      definir(u, novo.pid, qtd(u, novo.pid) + novo.qtd);
                      setNovo({ pessoa: u, pid: "", qtd: 1 });
                    }}>
                    Incluir
                  </Button>
                </div>
              </div>
            )}
          </>
        );
      })()}
    </div>
  );
}

// Descarte do turno aberto (pastel que caiu, queimou, estragou): só a quantidade, com − e +.
// Grava na hora na coluna Descarte do turno (sai do estoque e do esperado; não vai para a folha de ninguém).
export function DescarteTurnoEditor({ turno, somenteLeitura = false }: { turno: Turno; somenteLeitura?: boolean }) {
  const { state, dispatch } = useStore();
  const products = getAllProducts(state);
  const [n, setN] = useState<{ pid: string; qtd: number }>({ pid: "", qtd: 1 });
  const lancados = products.filter((p) => (turno.items[p.id]?.descarte || 0) > 0);
  const definir = (pid: string, novoTotal: number) => {
    const it = turno.items[pid];
    const atual = it?.descarte || 0;
    const nomeP = products.find((p) => p.id === pid)?.name ?? pid;
    if (novoTotal <= 0) {
      if (!confirm(`Tirar ${nomeP} do descarte?`)) return;
      novoTotal = 0;
    }
    const delta = novoTotal - atual;
    if (delta === 0) return;
    if (delta > 0) {
      const disp = disponivelPara(it, "descarte");
      if (delta > disp) { avisoSemEstoque(nomeP, it, disp); return; }
    }
    dispatch({ type: "UPDATE_ITEM", productId: pid, patch: { descarte: novoTotal } });
  };
  return (
    <div className="bg-card border border-border rounded-xl p-3 space-y-2" id="lancar-descarte">
      <div>
        <div className="text-sm font-semibold">🗑 Descarte do turno</div>
        <p className="text-[11px] text-muted-foreground">
          {somenteLeitura
            ? "🔒 Quem lança o descarte é quem abriu o turno."
            : "Pastel que caiu, queimou ou estragou. Grava na hora e sai do estoque do turno (não é consumo de ninguém)."}
        </p>
      </div>
      {lancados.length === 0 && <div className="text-[11px] text-muted-foreground">Nenhum descarte lançado.</div>}
      {lancados.map((p) => (
        <div key={p.id} className="flex items-center gap-1.5 text-xs">
          {somenteLeitura ? <span className="mono w-6 text-right">{turno.items[p.id].descarte}x</span>
            : <MenosMais qtd={turno.items[p.id].descarte} rotulo={`descarte de ${p.name}`} onChange={(q) => definir(p.id, q)} />}
          <span>{p.name}</span>
        </div>
      ))}
      {!somenteLeitura && (
        <div className="flex items-center gap-1.5">
          <select value={n.pid} aria-label="Produto para incluir no descarte" onChange={(e) => setN({ ...n, pid: e.target.value })}
            className="flex-1 min-w-0 h-9 rounded-md bg-input border border-border px-2 text-xs">
            <option value="">+ incluir item…</option>
            {products.filter((p) => turno.items[p.id]).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <BufferedNumberInput value={n.qtd} decimal={false} className="w-12 h-9 text-xs" aria-label="Quantidade a incluir no descarte"
            onChange={(q) => setN({ ...n, qtd: q })} />
          <Button variant="secondary" className="h-9 px-2 text-xs" disabled={!n.pid || n.qtd <= 0}
            onClick={() => { definir(n.pid, (turno.items[n.pid]?.descarte || 0) + n.qtd); setN({ pid: "", qtd: 1 }); }}>
            Incluir
          </Button>
        </div>
      )}
    </div>
  );
}
