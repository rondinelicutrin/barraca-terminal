import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Shell, TopBar, BottomNav } from "@/components/Shell";
import {
  useStore, getAllProducts, esperadoTurno, arrecadadoTurno, realMaq, dinheiroNoCaixa, nomeMaquina, maqAbaixoDaBase, valorComparadoMaq,
  turnoSeguinte, mudancasDeHeranca, turnoAnteriorDe, herdarDoAnterior,
  type Turno, type ShiftItem,
} from "@/lib/store";
import { BRL, formatDateBR, shiftLabel } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { BufferedNumberInput } from "@/components/ui/buffered-number-input";
import { DatePickerBR } from "@/components/ui/date-picker-br";
import { ConsumoTurnoEditor, ajustarFolhaConsumo } from "@/components/ConsumoTurnoEditor";
import { EntradasDoTurno, RelatorioSobrasBotoes } from "@/components/FechamentoTurno";
import { SaidasCaixa } from "@/components/SaidasCaixa";
import { entradasDoTurno } from "@/lib/relatorio-sobras";

export const Route = createFileRoute("/owner/turno/$id")({
  component: EditTurno,
  head: () => ({ meta: [{ title: "Editar turno — Barraca Terminal" }, { name: "description", content: "Editar turno fechado." }] }),
});

function EditTurno() {
  const { id } = Route.useParams();
  const { state, dispatch } = useStore();
  const nav = useNavigate();
  const isAtivo = state.turnoAtivo?.id === id;
  const orig = isAtivo ? state.turnoAtivo : state.historico.find((t) => t.id === id);
  const [tab, setTab] = useState<"produtos" | "caixa">("produtos");
  const [local, setLocal] = useState<Turno | null>(orig ?? null);
  // Ao recarregar a página (F5) o turno ainda não veio do banco na primeira exibição: assim que
  // chegar, carrega no formulário (antes ficava preso em "Turno não encontrado").
  useEffect(() => {
    if (!local && orig) setLocal(orig);
  }, [local, orig]);

  // Calculados antes de qualquer "return" (hooks sempre na mesma ordem — senão o React quebra)
  const products = getAllProducts(state);
  // useLivePrice=true: ao corrigir um turno, usamos os preços atuais (já corrigidos pelo dono)
  const esperado = useMemo(() => (local ? esperadoTurno(local, products, true) : 0), [local, products]);
  // As saídas do caixa são lançadas na hora (não esperam "Salvar"): vêm do turno atual, não do formulário
  const arrec = useMemo(() => (local ? arrecadadoTurno({ ...local, saidas: orig?.saidas }) : 0), [local, orig?.saidas]);

  if (!orig || !local) {
    return (
      <Shell>
        <TopBar title="Turno" />
        <div className="p-4 text-sm text-muted-foreground">Turno não encontrado.</div>
        <BottomNav />
      </Shell>
    );
  }

  const diff = arrec - esperado;

  const updItem = (pid: string, patch: Partial<ShiftItem>) =>
    setLocal({ ...local, items: { ...local.items, [pid]: { ...local.items[pid], ...patch } } });

  // "Consumo func." (aba Produtos): como antes, o dono muda o número aqui — e a diferença já vai para a folha da
  // pessoa (ponto do dia do turno), aparecendo no consumo dela e no fechamento. Turno com mais de uma pessoa:
  // pergunta de quem é. Diminuir tira da folha de quem tinha esse consumo.
  const [chaveConsumo, setChaveConsumo] = useState(0);
  const mudarConsumoFunc = (pid: string, nomeProd: string, n: number) => {
    const atualQ = local.items[pid]?.consumo || 0;
    const novoQ = Math.max(0, Math.round(n));
    const delta = novoQ - atualQ;
    if (delta === 0) return;
    const nomeDe = (u: string) => state.funcionarios.find((f) => f.username === u)?.nome ?? u;
    const pessoasTurno = [...new Set([local.employee, ...(local.outrosFuncionarios ?? []), ...(orig?.consumidores ?? [])])];
    if (delta > 0) {
      let u = pessoasTurno[0];
      if (pessoasTurno.length > 1) {
        const r = prompt(`De quem é o consumo de ${delta} ${nomeProd}?\n\n${pessoasTurno.map((x, i) => `${i + 1} - ${nomeDe(x)}`).join("\n")}\n\nDigite o número:`, "1");
        const i = r == null ? NaN : Number(r.trim()) - 1;
        if (!(i >= 0 && i < pessoasTurno.length)) { setChaveConsumo((k) => k + 1); return; }
        u = pessoasTurno[i];
      }
      ajustarFolhaConsumo(state, dispatch, u, local.date, pid, delta);
    } else {
      let resto = -delta;
      for (const u of pessoasTurno) {
        if (resto <= 0) break;
        resto += ajustarFolhaConsumo(state, dispatch, u, local.date, pid, -resto);
      }
    }
    // Estoque do turno: grava já (como o bloco de consumo), além de deixar no formulário para o "Salvar alterações"
    updItem(pid, { consumo: novoQ });
    if (isAtivo && state.turnoAtivo) dispatch({ type: "UPDATE_ITEM", productId: pid, patch: { consumo: novoQ } });
    else {
      const t = state.historico.find((h) => h.id === local.id);
      if (t) dispatch({ type: "EDIT_HIST", id: t.id, turno: { ...t, items: { ...t.items, [pid]: { ...t.items[pid], consumo: novoQ } } } });
    }
  };
  const updCaixa = (patch: Partial<Turno["caixa"]>) =>
    setLocal({ ...local, caixa: { ...local.caixa, ...patch } });
  const updMaq = (which: "maq1" | "maq2", patch: any) =>
    setLocal({ ...local, caixa: { ...local.caixa, [which]: { ...local.caixa[which], ...patch } } });

  // Corrigir data/período (ex.: turno da manhã aberto como "Tarde" por engano)
  const conflito = [...state.historico, ...(state.turnoAtivo ? [state.turnoAtivo] : [])]
    .find((x) => x.id !== local.id && x.date === local.date && x.shift === local.shift);
  const anterior = turnoAnteriorDe(state, local);
  const refazerHeranca = () => {
    if (!anterior) { alert("Não há turno fechado imediatamente anterior a este para copiar."); return; }
    if (!confirm(`Copiar do turno anterior (${formatDateBR(anterior.date)} · ${shiftLabel(anterior.shift)}):\n\n` +
      `• Entrada de cada produto = sobra dele\n• Dinheiro do caixa anterior = ${BRL((anterior.caixa.dinheiroFinal ?? 0) - (anterior.caixa.dinheiroMalote ?? 0))}\n` +
      `• Moedas inicial = ${BRL(anterior.caixa.moedasFinal ?? 0)}\n• Valor anterior das maquininhas\n\nDepois toque em "Salvar alterações".`)) return;
    setLocal(herdarDoAnterior(local, anterior));
  };

  const save = () => {
    if (conflito) {
      alert(`Já existe um turno ${shiftLabel(local.shift)} em ${formatDateBR(local.date)}. Escolha outra data ou período.`);
      return;
    }
    const abaixo = (local.caixa.maq2Ativa ? (["maq1", "maq2"] as const) : (["maq1"] as const))
      .filter((m) => maqAbaixoDaBase(local.caixa[m], local.shift));
    // Para o funcionário essa regra trava; o dono (correção) pode confirmar e salvar assim mesmo
    if (abaixo.length > 0 && !confirm(`O valor da maquininha está MENOR que o do turno anterior:\n\n` +
      abaixo.map((m) => `• ${nomeMaquina(state.taxasMaquininha, m)}: ${BRL(valorComparadoMaq(local.caixa[m], local.shift))} (turno anterior ${BRL(local.caixa[m].base)})`).join("\n") +
      `\n\nSalvar mesmo assim?`)) {
      return;
    }
    // Versão 69: maquininha 2 desmarcada com valor herdado → o próximo turno herdaria 0 e contaria de novo
    if (!local.caixa.maq2Ativa && (local.caixa.maq2.base ?? 0) > 0 && !confirm(
      `A ${nomeMaquina(state.taxasMaquininha, "maq2")} está DESMARCADA, mas tem ${BRL(local.caixa.maq2.base)} do turno anterior.\n\n` +
      `Se não vendeu nada nela, marque e repita ${BRL(local.caixa.maq2.base)} no visor — senão o próximo turno começa do zero e conta essas vendas de novo.\n\nSalvar mesmo assim?`)) {
      return;
    }
    if (isAtivo) {
      dispatch({ type: "EDIT_ATIVO", turno: local });
    } else {
      dispatch({ type: "EDIT_HIST", id: local.id, turno: local });
    }
    // O turno seguinte herdou deste o dinheiro que ficou no caixa, as moedas, o valor final das maquininhas e
    // a sobra de cada produto (como entrada). Se algo mudou na correção, oferece repassar para lá também
    // (senão o erro continuaria passando de turno em turno).
    const prox = isAtivo ? undefined : turnoSeguinte(state, local);
    if (prox) {
      const m = mudancasDeHeranca(local, prox, products);
      const linhas = [
        ...(m.caixa ? [`• Dinheiro do caixa anterior: ${BRL(m.caixa.de)} → ${BRL(m.caixa.para)}`] : []),
        ...(m.moedas ? [`• Moedas inicial: ${BRL(m.moedas.de)} → ${BRL(m.moedas.para)}`] : []),
        ...m.bases.map((x) => `• ${nomeMaquina(state.taxasMaquininha, x.m)} (valor do turno anterior): ${BRL(x.de)} → ${BRL(x.para)}`),
        ...m.entradas.slice(0, 10).map((x) => `• Entrada de ${x.nome}: ${x.de} → ${x.para}`),
        ...(m.entradas.length > 10 ? [`• e mais ${m.entradas.length - 10} produto(s)`] : []),
      ];
      if (linhas.length > 0 && confirm(
        `O turno seguinte (${formatDateBR(prox.date)} · ${shiftLabel(prox.shift)}) herdou valores deste turno que você alterou:\n\n` +
        linhas.join("\n") + `\n\nAtualizar lá também?`)) {
        dispatch({
          type: "AJUSTAR_HERANCA", id: prox.id,
          ...(m.caixa ? { caixaFimPrev: m.caixa.para } : {}),
          ...(m.moedas ? { moedasInicial: m.moedas.para } : {}),
          ...(m.bases.length ? { bases: Object.fromEntries(m.bases.map((x) => [x.m, x.para])) } : {}),
          ...(m.entradas.length ? { entradas: Object.fromEntries(m.entradas.map((x) => [x.id, x.para])) } : {}),
        });
      }
    }
    alert("Turno atualizado!");
    nav({ to: "/owner/historico" });
  };

  return (
    <Shell>
      <TopBar title={`${formatDateBR(local.date)} · ${shiftLabel(local.shift)}${isAtivo ? " · em andamento" : ""}`}
        right={<button onClick={() => nav({ to: "/owner/historico" })} className="text-xs text-muted-foreground">Voltar</button>} />
      <div className="px-3 pt-3">
        <div className="bg-card border border-border rounded-xl p-3 space-y-2">
          <div className="text-sm font-semibold">📅 Data e período do turno</div>
          <div className="space-y-2">
            <div><label className="text-xs text-muted-foreground">Data</label>
              <div className="mt-1"><DatePickerBR value={local.date} onChange={(d) => setLocal({ ...local, date: d })} /></div></div>
            <div className="grid grid-cols-3 gap-1">
              {(["manha", "tarde", "noite"] as const).map((sh) => (
                <button key={sh} type="button" onClick={() => setLocal({ ...local, shift: sh })}
                  className={`h-10 rounded-md text-xs border ${local.shift === sh ? "bg-primary text-primary-foreground border-primary" : "bg-background border-border text-muted-foreground"}`}>
                  {sh === "manha" ? "Manhã" : sh === "tarde" ? "Tarde" : "Noite"}
                </button>
              ))}
            </div>
          </div>
          {(local.date !== orig.date || local.shift !== orig.shift) && (
            <p className={`text-[11px] ${conflito ? "text-destructive font-semibold" : "text-warning"}`}>
              {conflito ? `Já existe um turno ${shiftLabel(local.shift)} em ${formatDateBR(local.date)}.`
                : `Será salvo como ${shiftLabel(local.shift)} de ${formatDateBR(local.date)}. Se as entradas devem vir do turno anterior a este, use o botão abaixo.`}
            </p>
          )}
          <Button variant="secondary" className="w-full h-auto min-h-10 whitespace-normal py-2" onClick={refazerHeranca} disabled={!anterior}>
            ↺ Refazer entradas e caixa pelo turno anterior{anterior ? ` (${formatDateBR(anterior.date).slice(0, 5)} · ${shiftLabel(anterior.shift).replace(/^[^\p{L}]+/u, "")})` : ""}
          </Button>
        </div>
      </div>
      <div className="px-3 pt-3">
        <ConsumoTurnoEditor local={local} setLocal={setLocal} isAtivo={isAtivo} />
      </div>
      <div className="p-3 grid grid-cols-2 gap-2">
        <button onClick={() => setTab("produtos")}
          className={`h-9 rounded-md text-sm ${tab === "produtos" ? "bg-primary text-primary-foreground" : "bg-card border border-border"}`}>Produtos</button>
        <button onClick={() => setTab("caixa")}
          className={`h-9 rounded-md text-sm ${tab === "caixa" ? "bg-primary text-primary-foreground" : "bg-card border border-border"}`}>Caixa</button>
      </div>

      {tab === "produtos" ? (
        <div className="p-3 space-y-2">
          <p className="text-[11px] text-muted-foreground">
            Consumo func.: ao mudar o número, a diferença já vai para a folha da pessoa do turno (e aparece no fechamento).
            Ex.: descarte lançado por engano → diminua o Descarte e aumente o Consumo func.
          </p>
          {products.map((p) => {
            const it = local.items[p.id];
            if (!it) return null;
            return (
              <div key={p.id} className="bg-card border border-border rounded-lg p-3">
                <div className="text-sm font-medium mb-2 flex items-center justify-between">
                  <span>{p.name}</span>
                  {p.saleable && <span className="mono text-xs text-muted-foreground">{BRL(p.price)}</span>}
                </div>
                <div className="grid grid-cols-3 gap-1.5">
                  <label className="flex flex-col">
                    <span className="text-[10px] text-muted-foreground uppercase">Entrada</span>
                    <BufferedNumberInput
                      value={it.entrada} decimal={p.decimal} className="text-center"
                      onChange={(n) => updItem(p.id, { entrada: n })}
                    />
                  </label>
                  <label className="flex flex-col">
                    <span className="text-[10px] text-muted-foreground uppercase">Chegada</span>
                    <BufferedNumberInput
                      value={it.chegada ?? 0} decimal={p.decimal} className="text-center"
                      onChange={(n) => updItem(p.id, { chegada: n })}
                    />
                  </label>
                  <label className="flex flex-col">
                    <span className="text-[10px] text-muted-foreground uppercase">Sobra</span>
                    <BufferedNumberInput
                      value={it.sobra ?? 0} decimal={p.decimal} className="text-center"
                      onChange={(n) => updItem(p.id, { sobra: n })}
                    />
                  </label>
                </div>
                <div className="grid grid-cols-2 gap-1.5 mt-1.5">
                  <label className="flex flex-col">
                    <span className="text-[10px] text-muted-foreground uppercase">Consumo func.</span>
                    {/* Mudar aqui leva a diferença para a folha da pessoa do turno (pergunta de quem, se houver mais de uma) */}
                    <BufferedNumberInput key={`${p.id}-${chaveConsumo}`}
                      value={it.consumo} decimal={false} className="text-center"
                      aria-label={`Consumo func. de ${p.name}`}
                      onChange={() => {}} onBlur={(n) => mudarConsumoFunc(p.id, p.name, n)}
                    />
                  </label>
                  <label className="flex flex-col">
                    <span className="text-[10px] text-muted-foreground uppercase">Descarte</span>
                    <BufferedNumberInput
                      value={it.descarte} decimal={false} className="text-center"
                      onChange={(n) => updItem(p.id, { descarte: n })}
                    />
                  </label>
                </div>
                {p.special && (
                  <label className="flex flex-col mt-1.5">
                    <span className="text-[10px] text-muted-foreground uppercase">Consumo barraca (gelo)</span>
                    <BufferedNumberInput
                      value={it.consumoEst ?? 0} decimal={false} className="text-center"
                      onChange={(n) => updItem(p.id, { consumoEst: n })}
                    />
                  </label>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <CaixaEdit local={local} updCaixa={updCaixa} updMaq={updMaq} />
      )}

      <div className="p-3 space-y-2">
        <div className="bg-card border border-border rounded-xl p-3 text-sm space-y-1">
          <div className="flex justify-between"><span className="text-muted-foreground">Esperado</span><span className="mono font-semibold">{BRL(esperado)}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Arrecadado</span><span className="mono font-semibold">{BRL(arrec)}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Diferença</span>
            <span className={`mono font-semibold ${Math.abs(diff) < 0.5 ? "text-success" : diff > 0 ? "text-warning" : "text-destructive"}`}>{BRL(diff)}</span></div>
        </div>
        <Button className="w-full" onClick={save}>Salvar alterações</Button>
        <EntradasDoTurno grupos={entradasDoTurno(local, products)} />
        {local.closedAt && (
          <div className="bg-card border border-border rounded-xl p-3 space-y-2">
            <div className="text-sm font-medium">Relatório do fechamento</div>
            <p className="text-[11px] text-muted-foreground">Entradas, vendidos, sobras, caixa, maquininhas e consumos deste turno (já com as alterações salvas).</p>
            <RelatorioSobrasBotoes turno={state.historico.find((h) => h.id === local.id) ?? local} />
          </div>
        )}
      </div>
      <BottomNav />
    </Shell>
  );
}

function CaixaEdit({ local, updCaixa, updMaq }: {
  local: Turno;
  updCaixa: (p: Partial<Turno["caixa"]>) => void;
  updMaq: (which: "maq1" | "maq2", p: any) => void;
}) {
  const { state } = useStore();
  const c = local.caixa;
  const isNoite = local.shift === "noite";
  // Saídas do caixa: lançadas na hora no turno guardado (aberto ou fechado), sem esperar "Salvar"
  const atual = state.turnoAtivo?.id === local.id ? state.turnoAtivo : state.historico.find((h) => h.id === local.id);
  const dinheiroRestante = dinheiroNoCaixa(c);
  const variacaoMoedas = (c.moedasFinal || 0) - (c.moedasInicial || 0);

  const money = (label: string, val: number, on: (n: number) => void, onBlur?: (n: number) => void) => (
    <div>
      <label className="text-xs text-muted-foreground">{label}</label>
      <BufferedNumberInput value={val} placeholder="0,00" className="mt-1 w-full h-10" onChange={on} onBlur={onBlur} />
    </div>
  );
  // Maquininha nunca menor que o turno anterior (base): avisa ao terminar de digitar
  const conferir = (which: "maq1" | "maq2") => (n: number) => {
    const base = c[which].base ?? 0;
    if (n < base) alert(`Atenção: o valor da ${nomeMaquina(state.taxasMaquininha, which)} está MENOR que o valor do turno anterior (${BRL(base)}).\n\n` +
      `Se o valor do turno anterior estiver errado, corrija o campo "Valor do turno anterior (base)" logo acima.`);
  };

  return (
    <div className="p-3 space-y-3">
      <div className="bg-card border border-border rounded-xl p-3 space-y-3">
        <div className="text-sm font-medium">💵 Dinheiro</div>
        {money("Dinheiro Final (todo o dinheiro contado)", c.dinheiroFinal, (n) => updCaixa({ dinheiroFinal: n }))}
        {money("Dinheiro Malote (parte enviada ao dono)", c.dinheiroMalote, (n) => updCaixa({ dinheiroMalote: n }))}
        <div className="text-xs text-muted-foreground">
          Fica no caixa: <span className="mono font-semibold text-success">{BRL(dinheiroRestante)}</span>
        </div>
        <div className="text-xs text-muted-foreground">
          Caixa anterior (ref.): <span className="mono">{BRL(c.caixaFimPrev)}</span>
        </div>
      </div>

      {atual && <SaidasCaixa turno={atual} />}

      <div className="bg-card border border-border rounded-xl p-3 space-y-3">
        <div className="text-sm font-medium">🪙 Moedas</div>
        {money("Moedas Inicial (herdado do turno anterior)", c.moedasInicial, (n) => updCaixa({ moedasInicial: n }))}
        {money("Moedas Final (contagem)", c.moedasFinal, (n) => updCaixa({ moedasFinal: n }))}
        <div className={`text-xs ${variacaoMoedas >= 0 ? "text-success" : "text-destructive"}`}>
          Variação: <span className="mono font-semibold">{variacaoMoedas >= 0 ? "+" : ""}{BRL(variacaoMoedas)}</span>
        </div>
      </div>

      <div className="bg-card border border-border rounded-xl p-3 space-y-3">
        <div className="text-sm font-medium">📱 Pix</div>
        {money("Pix manual", c.pix, (n) => updCaixa({ pix: n }))}
      </div>

      <div className="bg-card border border-border rounded-xl p-3 space-y-2">
        <div className="text-sm font-medium">{nomeMaquina(state.taxasMaquininha, "maq1")}</div>
        {money("Valor do turno anterior (base)", c.maq1.base, (n) => updMaq("maq1", { base: n }))}
        {!isNoite ? money("Valor exibido", c.maq1.display, (n) => updMaq("maq1", { display: n }), conferir("maq1")) :
          <div className="grid grid-cols-2 gap-2">
            {money("Até 00:00", c.maq1.ate00 ?? 0, (n) => updMaq("maq1", { ate00: n, display: n }), conferir("maq1"))}
            {money("Após 00:00", c.maq1.apos00 ?? 0, (n) => updMaq("maq1", { apos00: n }))}
          </div>}
        <div className="text-right text-sm">Real: <span className="mono font-semibold text-primary">{BRL(realMaq(c.maq1, local.shift))}</span></div>
      </div>

      <div className="bg-card border border-border rounded-xl p-3 space-y-2">
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={c.maq2Ativa} onCheckedChange={(v) => updCaixa({ maq2Ativa: !!v })} /> {nomeMaquina(state.taxasMaquininha, "maq2")}
        </label>
        {c.maq2Ativa && (
          <>
            {money("Valor do turno anterior (base)", c.maq2.base, (n) => updMaq("maq2", { base: n }))}
            {!isNoite ? money("Valor exibido", c.maq2.display, (n) => updMaq("maq2", { display: n }), conferir("maq2")) :
              <div className="grid grid-cols-2 gap-2">
                {money("Até 00:00", c.maq2.ate00 ?? 0, (n) => updMaq("maq2", { ate00: n, display: n }), conferir("maq2"))}
                {money("Após 00:00", c.maq2.apos00 ?? 0, (n) => updMaq("maq2", { apos00: n }))}
              </div>}
            <div className="text-right text-sm">Real: <span className="mono font-semibold text-primary">{BRL(realMaq(c.maq2, local.shift))}</span></div>
          </>
        )}
      </div>
    </div>
  );
}
