import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Shell, TopBar, BottomNav, TurnoBloqueado, useBloqueioTurno } from "@/components/Shell";
import { useStore, usaTurnoEPonto, getAllProducts, valoresConsumoPonto, ehSoConsumo, type Ponto, type Turno } from "@/lib/store";
import { useFiltro } from "@/lib/filtros";
import { BRL, formatDateBR, todayISO } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { DatePickerBR } from "@/components/ui/date-picker-br";
import { ConsumoModal, DescarteModal, collectDescarte, somarConsumo } from "@/components/Modals";
import { FechamentoTurno, TurnoFechadoScreen } from "@/components/FechamentoTurno";

export const Route = createFileRoute("/ponto")({
  component: PontoPage,
  head: () => ({ meta: [{ title: "Ponto — Barraca Terminal" }, { name: "description", content: "Registro de ponto." }] }),
});

function hoursBetween(entrada: string, saida: string): number {
  if (!entrada || !saida) return 0;
  const [h1, m1] = entrada.split(":").map(Number);
  const [h2, m2] = saida.split(":").map(Number);
  let mins = h2 * 60 + m2 - (h1 * 60 + m1);
  if (mins < 0) mins += 24 * 60; // atravessa meia-noite
  return mins / 60;
}

// Período do dia pelo horário de entrada (mesma regra da Folha): manhã, tarde ou noite
function periodoDoHorario(entrada: string): "Manhã" | "Tarde" | "Noite" {
  const [h, m] = entrada.split(":").map(Number);
  const minutos = (h || 0) * 60 + (m || 0);
  if (minutos < 12 * 60) return "Manhã";
  if (minutos < 17 * 60) return "Tarde";
  return "Noite";
}

function PontoPage() {
  const { state, dispatch } = useStore();
  const nav = useNavigate();
  const bloqueio = useBloqueioTurno();

  useEffect(() => {
    if (!state.hidratado) return; // espera ler o login salvo (F5 não desloga)
    if (!state.currentUser) nav({ to: "/" });
    else if (!usaTurnoEPonto(state.currentUser)) nav({ to: "/owner" });
  }, [state.hidratado, state.currentUser, nav]);

  // Ao abrir a tela, a data volta a ser a de hoje — mantém alinhado com o menu Turno e evita
  // ficar "preso" numa data antiga esquecida de uma sessão anterior.
  // Ao abrir, a data sugerida é a do turno aberto (ou hoje, sem turno). Pode ser trocada livremente.
  useEffect(() => {
    dispatch({ type: "SET_SELECTED_DATE", date: state.turnoAtivo?.date ?? todayISO() });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.turnoAtivo?.date]);

  const me = state.currentUser;

  const cg = state.configGeral;

  // Usa o valor pessoal do funcionário (definido pelo dono em Equipe) quando existir;
  // senão cai para o valor padrão geral.
  const transporteRefeicaoPara = (username: string) => {
    const f = state.funcionarios.find((x) => x.username === username);
    const ida = f?.transporteIda ?? cg.transporteIda;
    const volta = f?.transporteVolta ?? cg.transporteVolta;
    const refeicao = f?.refeicao ?? cg.refeicao;
    return { transporte: ida + volta, refeicao };
  };

  // Data compartilhada com o menu Turno — evita lançamentos em datas diferentes entre os dois menus
  const date = state.selectedDate;
  const setDate = (d: string) => { dispatch({ type: "SET_SELECTED_DATE", date: d }); setPerFrom(d); setPerTo(d); };
  const hoje = todayISO();
  const dataDiferente = date !== hoje;
  // Rascunhos do que ainda não foi registrado ficam guardados ao trocar de menu (e ao recarregar a página),
  // para não precisar lançar tudo de novo.
  // Rascunhos separados por usuário: no mesmo tablet, quem entra depois não vê (nem registra) o
  // rascunho de quem estava antes.
  const rascunho = `ponto.${me?.username ?? ""}`;
  const [entrada, setEntrada]   = useFiltro(`${rascunho}.entrada`, "18:00");
  const [saida, setSaida]       = useFiltro(`${rascunho}.saida`, "23:00");
  const [euPonto, setEuPonto]   = useFiltro(`${rascunho}.euPonto`, true);
  const [euConsumir, setEuConsumir] = useFiltro(`${rascunho}.euConsumir`, false);
  // Colegas: mapa username -> { nome, registrar (ponto), consumir (lançar consumo), entrada, saida }
  type Colega = { nome: string; registrar: boolean; consumir?: boolean; entrada: string; saida: string };
  const [colegas, setColegas] = useFiltro<Record<string, Colega>>(`${rascunho}.colegas`, {});
  const [consumo, setConsumo]   = useFiltro<Record<string, number>>(`${rascunho}.consumo`, {});
  const [consumoColegas, setConsumoColegas] = useFiltro<Record<string, Record<string, number>>>(`${rascunho}.consumoColegas`, {});
  // Período do "Consumo por período" também é lembrado
  const [perFrom, setPerFrom] = useFiltro("ponto.perFrom", () => state.selectedDate);
  const [perTo, setPerTo] = useFiltro("ponto.perTo", () => state.selectedDate);
  const [showConsumo, setShowConsumo] = useState(false);
  const [showConsumoColega, setShowConsumoColega] = useState<string | null>(null);
  const [showDescarte, setShowDescarte] = useState(false);
  const [turnoFechado, setTurnoFechado] = useState<Turno | null>(null);

  // Colegas NÃO são marcados automaticamente (antes já vinham com "registrar ponto" ligado e isso gerava
  // ponto lançado para quem não devia). Quem está fazendo o lançamento toca no nome do colega e decide:
  // ponto, consumo ou os dois.
  const turnoAtivo = state.turnoAtivo;
  const noTurno = new Set(turnoAtivo ? [turnoAtivo.employee, ...(turnoAtivo.outrosFuncionarios ?? [])] : []);

  // Só depois de todos os hooks: sair antes deles fazia o React quebrar ao recarregar a página (F5)
  if (!me) return null;
  if (bloqueio) return <TurnoBloqueado turno={bloqueio} />;

  const hours = hoursBetween(entrada, saida);

  // Outros funcionários cadastrados (excluindo o próprio)
  const outros = state.funcionarios.filter((f) => f.ativo !== false && f.username !== me.username);

  function toggleColega(username: string, nome: string) {
    if (colegas[username]) {
      const next = { ...colegas };
      delete next[username];
      setColegas(next);
      if (consumoColegas[username]) {
        const nc = { ...consumoColegas };
        delete nc[username];
        setConsumoColegas(nc);
      }
      return;
    }
    // Nada vem marcado: quem está lançando escolhe "Registrar ponto" e/ou "Lançar consumo" para o colega
    setColegas({ ...colegas, [username]: { nome, registrar: false, consumir: false, entrada: "18:00", saida: "23:00" } });
  }

  function updColega(username: string, patch: Partial<Colega>) {
    setColegas({ ...colegas, [username]: { ...colegas[username], ...patch } });
  }

  const qtdItens = (m: Record<string, number>) => Object.values(m).reduce((s, n) => s + n, 0);
  const nomeMe = state.funcionarios.find((f) => f.username === me.username)?.nome ?? me.username;
  // Tudo que já foi lançado (e ainda não registrado) para todas as pessoas: conta no limite de estoque
  const reservadoTotal = [consumo, ...Object.values(consumoColegas)].reduce(somarConsumo, {});
  const nomeProduto = (id: string) => getAllProducts(state).find((x) => x.id === id)?.name ?? id;
  // Lista curta do que foi lançado (aparece logo abaixo do botão de cada pessoa)
  const ResumoItens = ({ itens, vazio }: { itens: Record<string, number>; vazio?: string }) => {
    const lista = Object.entries(itens).filter(([, q]) => q > 0);
    if (lista.length === 0) return vazio ? <p className="text-[11px] text-muted-foreground">{vazio}</p> : null;
    return (
      <ul className="text-xs bg-background border border-border/60 rounded-md px-2 py-1 space-y-0.5">
        {lista.map(([id, q]) => (
          <li key={id} className="flex justify-between"><span>{nomeProduto(id)}</span><span className="mono">{q}×</span></li>
        ))}
      </ul>
    );
  };

  function save() {
    const dataBR = date.split("-").reverse().join("/");
    const nomeDe = (u: string) => state.funcionarios.find((f) => f.username === u)?.nome ?? u;
    // Ponto real já batido no mesmo período (registros só de consumo não contam)
    const jaBateu = (username: string, ent: string) =>
      state.pontos.some((p) => p.employeeUsername === username && p.date === date && !ehSoConsumo(p) && periodoDoHorario(p.entrada) === periodoDoHorario(ent));
    const itensDe = (m: Record<string, number>) =>
      Object.entries(m).filter(([, q]) => q > 0).map(([productId, qty]) => ({ productId, qty }));

    // Lista de quem vai ser lançado: eu + colegas marcados
    type Alvo = { username: string; ponto: boolean; ent: string; sai: string; itens: { productId: string; qty: number }[] };
    const alvos: Alvo[] = [
      { username: me!.username, ponto: euPonto, ent: entrada, sai: saida, itens: euConsumir ? itensDe(consumo) : [] },
      ...Object.entries(colegas).map(([u, c]) => ({
        username: u, ponto: c.registrar, ent: c.entrada, sai: c.saida,
        itens: c.consumir ? itensDe(consumoColegas[u] ?? {}) : [],
      })),
    ];

    // Colega tocado sem escolher nada: pergunta em vez de ignorar em silêncio
    const semEscolha = Object.entries(colegas).filter(([, c]) => !c.registrar && !c.consumir).map(([, c]) => c.nome);
    if (semEscolha.length > 0) {
      alert(`Escolha "Registrar ponto" e/ou "Lançar consumo" para: ${semEscolha.join(", ")}.\n\nSe não for lançar nada para essa pessoa, toque no nome dela de novo para tirar.`);
      return;
    }
    const querPonto = alvos.filter((a) => a.ponto);
    if (querPonto.some((a) => !a.ent || !a.sai)) { alert("Preencha entrada e saída!"); return; }
    if (alvos.every((a) => !a.ponto && a.itens.length === 0)) {
      alert("Nada para registrar: marque \"Registrar ponto\" e/ou \"Lançar consumo\" (com itens) para alguém.");
      return;
    }

    if (dataDiferente) {
      const ok = confirm(
        `ATENÇÃO: VOCÊ ESTÁ REGISTRANDO COM A DATA ${dataBR}, DIFERENTE DE HOJE (${hoje.split("-").reverse().join("/")}).\n\nTEM CERTEZA QUE É ISSO MESMO?`
      );
      if (!ok) return;
    }

    // Confirma para quem vai cada consumo antes de registrar (evita lançar o consumo de um no nome de outro)
    const comItens = alvos.filter((a) => a.itens.length > 0);
    if (comItens.length > 0) {
      const linhas = comItens.map((a) =>
        `• ${nomeDe(a.username).toUpperCase()}: ${a.itens.map((c) => `${c.qty}× ${nomeProduto(c.productId)}`).join(", ")}`);
      if (!confirm(`CONFIRA O CONSUMO DE CADA PESSOA:\n\n${linhas.join("\n")}\n\nEstá certo?`)) return;
    }

    const duplicados = querPonto.filter((a) => jaBateu(a.username, a.ent)).map((a) => a.username);
    const novosPontos = querPonto.filter((a) => !duplicados.includes(a.username));
    const comConsumo = alvos.filter((a) => a.itens.length > 0);

    if (novosPontos.length === 0 && comConsumo.length === 0) {
      alert(
        `O PONTO JÁ FOI BATIDO.\n\n${duplicados.map(nomeDe).join(", ")} já tem ponto registrado em ${dataBR} nesse período.\n\n` +
        `Não é possível bater o ponto duas vezes no mesmo período. Se foi um engano, peça ao administrador para corrigir.`
      );
      return;
    }

    // Soma o consumo de todo mundo por produto para dar baixa no estoque do turno de uma só vez
    // (cada dispatch lê a mesma "foto" do estado — somar um por um perderia itens).
    const consumoTotalPorProduto: Record<string, number> = {};
    for (const a of alvos) for (const c of a.itens) consumoTotalPorProduto[c.productId] = (consumoTotalPorProduto[c.productId] ?? 0) + c.qty;

    const nomesTodos = alvos.filter((a) => a.ponto).map((a) => a.username);
    for (const a of alvos) {
      const fezPonto = novosPontos.some((n) => n.username === a.username);
      if (!fezPonto && a.itens.length === 0) continue;
      if (fezPonto) {
        const { transporte, refeicao } = transporteRefeicaoPara(a.username);
        const p: Ponto = {
          id: crypto.randomUUID(), employeeUsername: a.username, date,
          entrada: a.ent, saida: a.sai, transporte, refeicao,
          colegas: nomesTodos.filter((u) => u !== a.username),
          consumo: a.itens,
        };
        dispatch({ type: "ADD_PONTO", p });
      } else {
        // Só consumo (sem bater ponto): registro com entrada = saída e sem transporte/refeição
        const p: Ponto = {
          id: crypto.randomUUID(), employeeUsername: a.username, date,
          entrada: "00:00", saida: "00:00", transporte: 0, refeicao: 0,
          colegas: [], consumo: a.itens,
        };
        dispatch({ type: "ADD_PONTO", p });
      }
    }

    // O consumo também sai do estoque do turno em andamento (se for do mesmo dia)
    if (state.turnoAtivo && state.turnoAtivo.date === date) {
      for (const [productId, qty] of Object.entries(consumoTotalPorProduto)) {
        const atual = state.turnoAtivo.items[productId]?.consumo ?? 0;
        dispatch({ type: "UPDATE_ITEM", productId, patch: { consumo: atual + qty } });
      }
    }

    setConsumo({});
    setConsumoColegas({});
    setColegas({});
    setEuConsumir(false);
    setEuPonto(true);
    const avisos: string[] = [];
    if (duplicados.length > 0) avisos.push(`Já tinham ponto neste período e não foi registrado de novo: ${duplicados.map(nomeDe).join(", ")}.`);
    if (comConsumo.length > 0) avisos.push(`Consumo lançado para: ${comConsumo.map((a) => nomeDe(a.username)).join(", ")}.`);
    alert(avisos.length > 0 ? `Registrado.\n\n${avisos.join("\n")}` : "Ponto registrado!");
  }

  if (turnoFechado) {
    return (
      <Shell>
        <TurnoFechadoScreen turno={turnoFechado} onVoltar={() => setTurnoFechado(null)} />
        <BottomNav />
      </Shell>
    );
  }

  return (
    <Shell>
      <TopBar title="Meu Ponto" />
      <div className="p-3 space-y-3 pb-24">

        {/* Formulário de ponto */}
        <div className="bg-card border border-border rounded-xl p-3 space-y-3">

          <div>
            <label className="text-xs text-muted-foreground">Data</label>
            <div className="mt-1">
              <DatePickerBR value={date} onChange={setDate} />
            </div>
            {turnoAtivo && date !== turnoAtivo.date && (
              <p className="text-[11px] text-muted-foreground mt-1">
                O turno aberto é de {formatDateBR(turnoAtivo.date)}. Para liberar o fechamento, o ponto precisa estar na data do turno.
              </p>
            )}
            {dataDiferente && (
              <p className="text-xs font-bold text-destructive mt-1.5 uppercase tracking-wide bg-destructive/10 border border-destructive/40 rounded-md px-2 py-1.5">
                ⚠️ ATENÇÃO: ESTA DATA É DIFERENTE DE HOJE ({hoje.split("-").reverse().join("/")}). CONFIRA ANTES DE REGISTRAR O PONTO.
              </p>
            )}
          </div>

          {/* Eu: registrar ponto e/ou lançar consumo (independentes) */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
            <span className="text-sm font-medium">{state.funcionarios.find((f) => f.username === me.username)?.nome ?? me.username}</span>
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
              <input type="checkbox" className="accent-primary" checked={euPonto} onChange={(e) => setEuPonto(e.target.checked)} />
              Registrar meu ponto
            </label>
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
              <input type="checkbox" className="accent-primary" checked={euConsumir} onChange={(e) => setEuConsumir(e.target.checked)} />
              Lançar meu consumo
            </label>
          </div>

          {euPonto && (<>
          {/* Horários — formato 24h (nativo do input type="time") */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-muted-foreground">Entrada (24h)</label>
              <input
                type="time"
                className="mt-1 w-full h-10 rounded-md bg-input px-3 text-sm mono"
                value={entrada}
                onChange={(e) => setEntrada(e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Saída (24h)</label>
              <input
                type="time"
                className="mt-1 w-full h-10 rounded-md bg-input px-3 text-sm mono"
                value={saida}
                onChange={(e) => setSaida(e.target.value)}
              />
            </div>
          </div>

          <div className="text-sm text-muted-foreground">
            Horas trabalhadas:{" "}
            <span className="mono text-foreground font-semibold">{hours.toFixed(2)}h</span>
          </div>
          </>)}

          {/* Colegas de turno */}
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Colegas no turno</label>
            <p className="text-[11px] text-muted-foreground mb-1.5">
              Toque no nome do colega e escolha o que lançar para ele: ponto, consumo ou os dois.
              {noTurno.size > 0 && " ● = está no turno aberto."}
            </p>
            {outros.length === 0 && (
              <span className="text-xs text-muted-foreground">Nenhum outro funcionário cadastrado.</span>
            )}
            <div className="flex flex-wrap gap-1.5">
              {outros.map((f) => {
                const on = !!colegas[f.username];
                return (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => toggleColega(f.username, f.nome)}
                    className={`text-sm px-3 h-9 rounded-full border transition-colors ${
                      on
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-card border-border text-muted-foreground"
                    }`}
                  >
                    {noTurno.has(f.username) ? "● " : ""}{f.nome}
                  </button>
                );
              })}
            </div>

            {/* Detalhes do ponto dos colegas selecionados */}
            {Object.entries(colegas).map(([username, col]) => (
              <div key={username} className="mt-3 bg-background border border-border rounded-lg p-3 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                  <span className="text-sm font-medium">{col.nome}</span>
                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
                    <input
                      type="checkbox"
                      checked={col.registrar}
                      onChange={(e) => updColega(username, { registrar: e.target.checked })}
                      className="accent-primary"
                    />
                    Registrar ponto
                  </label>
                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
                    <input
                      type="checkbox"
                      checked={!!col.consumir}
                      onChange={(e) => updColega(username, { consumir: e.target.checked })}
                      className="accent-primary"
                    />
                    Lançar consumo
                  </label>
                </div>

                {col.registrar && (
                  <div className="space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-xs text-muted-foreground">Entrada (24h)</label>
                        <input
                          type="time"
                          className="mt-1 w-full h-9 rounded-md bg-input px-3 text-sm mono"
                          value={col.entrada}
                          onChange={(e) => updColega(username, { entrada: e.target.value })}
                        />
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground">Saída (24h)</label>
                        <input
                          type="time"
                          className="mt-1 w-full h-9 rounded-md bg-input px-3 text-sm mono"
                          value={col.saida}
                          onChange={(e) => updColega(username, { saida: e.target.value })}
                        />
                      </div>
                    </div>
                    <div className="text-xs text-muted-foreground mono">
                      {hoursBetween(col.entrada, col.saida).toFixed(2)}h
                    </div>
                  </div>
                )}
                {col.consumir && (
                  <div className="space-y-1.5">
                    <Button
                      type="button"
                      variant="secondary"
                      className="w-full"
                      onClick={() => setShowConsumoColega(username)}
                    >
                      🍽 Lançar consumo de {col.nome} ({qtdItens(consumoColegas[username] ?? {})} itens)
                    </Button>
                    {ResumoItens({ itens: consumoColegas[username] ?? {} })}
                    {qtdItens(consumoColegas[username] ?? {}) > 0 && (
                      <button type="button" className="text-[11px] text-muted-foreground hover:text-destructive"
                        onClick={() => setConsumoColegas({ ...consumoColegas, [username]: {} })}>
                        Limpar consumo de {col.nome}
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Consumo e Descarte — lançados aqui no Ponto (não mais na tela de Turno), para ninguém
              esquecer de bater o ponto */}
          {euConsumir && (
            <div className="space-y-1.5">
              <Button variant="secondary" className="w-full" onClick={() => setShowConsumo(true)}>
                🍽 Lançar consumo de {nomeMe} (você) ({qtdItens(consumo)})
              </Button>
              {ResumoItens({ itens: consumo })}
              {qtdItens(consumo) > 0 && (
                <button type="button" className="text-[11px] text-muted-foreground hover:text-destructive" onClick={() => setConsumo({})}>
                  Limpar meu consumo
                </button>
              )}
            </div>
          )}
          <div className="space-y-1.5">
            <Button variant="secondary" className="w-full" onClick={() => setShowDescarte(true)} disabled={!state.turnoAtivo}>
              🗑 Descarte ({qtdItens(state.turnoAtivo ? collectDescarte(state.turnoAtivo.items) : {})})
            </Button>
            {ResumoItens({ itens: state.turnoAtivo ? collectDescarte(state.turnoAtivo.items) : {} })}
          </div>
          {!state.turnoAtivo && (
            <p className="text-[11px] text-muted-foreground -mt-1">
              O descarte só fica disponível com um turno aberto (ele dá baixa no estoque desse turno).
            </p>
          )}

          <Button className="w-full" onClick={save}>Registrar</Button>
        </div>

        {/* Fechamento do turno: Esperado, Arrecadado, Diferença e botão Fechar */}
        {turnoAtivo && <FechamentoTurno onClosed={setTurnoFechado} />}

        {/* Consumo detalhado — meu e dos colegas com quem trabalhei, com filtro de período */}
        <ConsumoDetalhado meuUsername={me.username} from={perFrom} to={perTo} setFrom={setPerFrom} setTo={setPerTo} />
      </div>

      <ConsumoModal
        open={showConsumo}
        onOpenChange={setShowConsumo}
        items={state.turnoAtivo?.items}
        hasActiveTurno={!!state.turnoAtivo}
        username={me.username}
        nomePessoa={`${nomeMe} (você)`}
        reservado={reservadoTotal}
        onSave={(v) => setConsumo(somarConsumo(consumo, v))}
      />
      <ConsumoModal
        open={showConsumoColega != null}
        onOpenChange={(v) => { if (!v) setShowConsumoColega(null); }}
        items={state.turnoAtivo?.items}
        hasActiveTurno={!!state.turnoAtivo}
        username={showConsumoColega ?? undefined}
        nomePessoa={showConsumoColega ? (colegas[showConsumoColega]?.nome ?? showConsumoColega) : undefined}
        reservado={reservadoTotal}
        onSave={(v) => {
          if (!showConsumoColega) return;
          setConsumoColegas({ ...consumoColegas, [showConsumoColega]: somarConsumo(consumoColegas[showConsumoColega] ?? {}, v) });
        }}
      />
      {state.turnoAtivo && (
        <DescarteModal
          open={showDescarte}
          onOpenChange={setShowDescarte}
          values={collectDescarte(state.turnoAtivo.items)}
          items={state.turnoAtivo.items}
          onSave={(v) => Object.entries(v).forEach(([pid, qty]) =>
            dispatch({ type: "UPDATE_ITEM", productId: pid, patch: { descarte: qty } }))}
        />
      )}
      <BottomNav />
    </Shell>
  );
}

// Consumo detalhado, com período selecionável — mostra o do próprio funcionário e, se ele
// trabalhou com colegas de turno, o consumo de cada colega também, separado por data.
// Essencial para os descontos de consumo por funcionário (diário, semanal ou mensal).
function ConsumoDetalhado({ meuUsername, from, to, setFrom, setTo }: {
  meuUsername: string; from: string; to: string; setFrom: (v: string) => void; setTo: (v: string) => void;
}) {
  const { state } = useStore();
  const products = getAllProducts(state);
  // Quem aparece: eu primeiro e depois todos que têm consumo lançado no período (com ou sem ponto batido)
  const pessoas = useMemo(() => {
    const set = new Set<string>();
    for (const p of state.pontos) if (p.date >= from && p.date <= to && p.consumo.length > 0) set.add(p.employeeUsername);
    set.delete(meuUsername);
    return [meuUsername, ...Array.from(set)];
  }, [state.pontos, from, to, meuUsername]);

  const nomeFunc = (username: string) => state.funcionarios.find((f) => f.username === username)?.nome ?? username;
  const valorItemQty = (username: string, pt: Ponto, productId: string) =>
    valoresConsumoPonto(state, username, pt.consumo)[productId] ?? 0;
  const nomeItem = (productId: string) => products.find((x) => x.id === productId)?.name ?? productId;

  const blocos = pessoas.map((username) => {
    const registros = state.pontos
      .filter((p) => p.employeeUsername === username && p.date >= from && p.date <= to && p.consumo.length > 0)
      .sort((a, b) => b.date.localeCompare(a.date));
    const total = registros.reduce((s, p) => s + p.consumo.reduce((s2, c) => s2 + valorItemQty(username, p, c.productId), 0), 0);
    return { username, registros, total };
  }).filter((b) => b.registros.length > 0);

  const totalGeral = blocos.reduce((s, b) => s + b.total, 0);

  return (
    <div className="bg-card border border-border rounded-xl p-3 space-y-3">
      <div className="text-sm font-semibold">🍽 Consumo por período</div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-xs text-muted-foreground">De</label>
          <div className="mt-1"><DatePickerBR value={from} onChange={setFrom} /></div>
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Até</label>
          <div className="mt-1"><DatePickerBR value={to} onChange={setTo} /></div>
        </div>
      </div>

      {blocos.length === 0 ? (
        <div className="text-xs text-muted-foreground">Nenhum consumo registrado nesse período.</div>
      ) : (
        <div className="space-y-3">
          {blocos.map(({ username, registros, total }) => (
            <div key={username} className="border-t border-border/50 pt-2 first:border-t-0 first:pt-0">
              <div className="flex justify-between items-center mb-1">
                <span className="text-sm font-medium">{nomeFunc(username)}</span>
                <span className="mono text-sm font-semibold text-primary">{BRL(total)}</span>
              </div>
              <div className="space-y-1.5">
                {registros.map((p) => {
                  const subtotal = p.consumo.reduce((s, c) => s + valorItemQty(username, p, c.productId), 0);
                  return (
                    <div key={p.id} className="bg-background border border-border/60 rounded-md p-2">
                      <div className="text-[11px] text-muted-foreground mb-0.5">{formatDateBR(p.date)}</div>
                      {p.consumo.map((c) => (
                        <div key={c.productId} className="flex justify-between text-xs">
                          <span>{c.qty}× {nomeItem(c.productId)}</span>
                          <span className="mono text-muted-foreground">{BRL(valorItemQty(username, p, c.productId))}</span>
                        </div>
                      ))}
                      <div className="flex justify-between text-[11px] mt-0.5 font-medium">
                        <span className="text-muted-foreground">Subtotal</span>
                        <span className="mono">{BRL(subtotal)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {blocos.length > 1 && (
        <div className="flex justify-between items-center border-t border-border pt-2 text-sm font-semibold">
          <span>Total geral do período</span>
          <span className="mono text-primary">{BRL(totalGeral)}</span>
        </div>
      )}
    </div>
  );
}
