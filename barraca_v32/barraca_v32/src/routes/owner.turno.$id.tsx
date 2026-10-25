import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Shell, TopBar, BottomNav } from "@/components/Shell";
import {
  useStore, getAllProducts, esperadoTurno, arrecadadoTurno, realMaq, dinheiroNoCaixa, nomeMaquina, maqAbaixoDaBase, valorComparadoMaq,
  type Turno, type ShiftItem,
} from "@/lib/store";
import { BRL, formatDateBR, shiftLabel } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { BufferedNumberInput } from "@/components/ui/buffered-number-input";

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
  const arrec = useMemo(() => (local ? arrecadadoTurno(local) : 0), [local]);

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
  const updCaixa = (patch: Partial<Turno["caixa"]>) =>
    setLocal({ ...local, caixa: { ...local.caixa, ...patch } });
  const updMaq = (which: "maq1" | "maq2", patch: any) =>
    setLocal({ ...local, caixa: { ...local.caixa, [which]: { ...local.caixa[which], ...patch } } });

  const save = () => {
    const abaixo = (local.caixa.maq2Ativa ? (["maq1", "maq2"] as const) : (["maq1"] as const))
      .filter((m) => maqAbaixoDaBase(local.caixa[m], local.shift));
    if (abaixo.length > 0) {
      alert(`O valor da maquininha só pode ser IGUAL OU MAIOR que o do turno anterior:\n\n` +
        abaixo.map((m) => `• ${nomeMaquina(state.taxasMaquininha, m)}: ${BRL(valorComparadoMaq(local.caixa[m], local.shift))} (turno anterior ${BRL(local.caixa[m].base)})`).join("\n"));
      return;
    }
    if (isAtivo) {
      dispatch({ type: "EDIT_ATIVO", turno: local });
    } else {
      dispatch({ type: "EDIT_HIST", id: local.id, turno: local });
    }
    alert("Turno atualizado!");
    nav({ to: "/owner/historico" });
  };

  return (
    <Shell>
      <TopBar title={`${formatDateBR(local.date)} · ${shiftLabel(local.shift)}${isAtivo ? " · em andamento" : ""}`}
        right={<button onClick={() => nav({ to: "/owner/historico" })} className="text-xs text-muted-foreground">Voltar</button>} />
      <div className="p-3 grid grid-cols-2 gap-2">
        <button onClick={() => setTab("produtos")}
          className={`h-9 rounded-md text-sm ${tab === "produtos" ? "bg-primary text-primary-foreground" : "bg-card border border-border"}`}>Produtos</button>
        <button onClick={() => setTab("caixa")}
          className={`h-9 rounded-md text-sm ${tab === "caixa" ? "bg-primary text-primary-foreground" : "bg-card border border-border"}`}>Caixa</button>
      </div>

      {tab === "produtos" ? (
        <div className="p-3 space-y-2">
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
                    <BufferedNumberInput
                      value={it.consumo} decimal={false} className="text-center"
                      onChange={(n) => updItem(p.id, { consumo: n })}
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
    if (n < base) alert(`O valor da ${nomeMaquina(state.taxasMaquininha, which)} só pode ser IGUAL OU MAIOR que o valor do turno anterior (${BRL(base)}).`);
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
        <div className="text-xs text-muted-foreground">Base: <span className="mono">{BRL(c.maq1.base)}</span></div>
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
