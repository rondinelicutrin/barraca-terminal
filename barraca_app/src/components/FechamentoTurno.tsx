import { useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useStore, veResultadoCaixa, turnoFechadoNoBanco, getAllProducts, esperadoTurno, arrecadadoTurno, nomeMaquina, ehSoConsumo, sobraOverflow, maqAbaixoDaBase, valorComparadoMaq, buscarHistoricoRecente, turnoAnteriorDe, mudancasDeHeranca, type Turno, type TaxasMaquininha } from "@/lib/store";
import { BRL, shiftLabel } from "@/lib/format";
import { ConsumoTurnoEditor, DescarteTurnoEditor } from "@/components/ConsumoTurnoEditor";
import { TopBar } from "@/components/Shell";
import { EXCLUIR_DO_TOTAL_PASTEL } from "@/lib/products";
import { Button } from "@/components/ui/button";
import { processar, descartarPendentes } from "@/lib/fila";
import { LIMITE_RECONTAGEM, vendasForaDoNormal, produtosParaRecontar, diferencaDoTurno, jaRecontado } from "@/lib/conferencia";
import { BufferedNumberInput } from "@/components/ui/buffered-number-input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { montarRelatorioSobras, type GrupoEntradas } from "@/lib/relatorio-sobras";
import { montarFechamentoImpresso, baixarFechamentoPdf, baixarFechamentoCsv, temFaltaNoCaixa, ALERTA_FALTA, consumoPorPessoaDoTurno } from "@/lib/fechamento-impresso";

// Campos do caixa que precisam estar preenchidos (aceita 0) antes de fechar o turno.
// Todos os campos de cada maquininha em uso são obrigatórios: no turno da noite os dois valores
// (até 00:00 e após 00:00); nos demais, o valor exibido. A maquininha 2 só entra se estiver marcada como em uso.
export function camposObrigatoriosDoTurno(t: Turno, taxas: TaxasMaquininha): { key: string; label: string }[] {
  const lista: { key: string; label: string }[] = [
    { key: "dinheiroFinal",  label: "Dinheiro Final"  },
    { key: "dinheiroMalote", label: "Dinheiro Malote" },
    { key: "moedasFinal",    label: "Moedas Final"    },
    { key: "pix",            label: "Pix manual"      },
  ];
  const maqs: ("maq1" | "maq2")[] = t.caixa.maq2Ativa ? ["maq1", "maq2"] : ["maq1"];
  for (const m of maqs) {
    const nome = nomeMaquina(taxas, m);
    if (t.shift === "noite") {
      lista.push({ key: `${m}.ate00`, label: `${nome}: até 00:00` });
      lista.push({ key: `${m}.apos00`, label: `${nome}: após 00:00` });
    } else {
      lista.push({ key: `${m}.display`, label: `${nome}: valor exibido` });
    }
  }
  return lista;
}

// Dois botões (PDF e CSV) com o fechamento geral do turno, numa folha só.
// Regra: o relatório só existe depois de o turno ser FECHADO (botão "Fechar turno" no menu Ponto). Antes,
// funcionários geravam e enviavam o relatório e esqueciam de fechar o turno.
export function RelatorioSobrasBotoes({ turno }: { turno: Turno }) {
  const { state } = useStore();
  const admin = veResultadoCaixa(state.currentUser);
  const [conferindo, setConferindo] = useState(false);
  const [naoChegou, setNaoChegou] = useState<"" | "pendente" | "sem-internet">("");
  if (!turno.closedAt) return <AvisoTurnoAberto />;
  // completo = com resultado e valores (só dono/administrador); senão a versão às cegas do funcionário.
  // Só gera depois que o SISTEMA confirma o turno fechado: o fechamento fica guardado no celular se
  // estiver sem internet (ou se o app foi fechado antes de enviar), e o relatório saía mesmo assim.
  const gerar = async (formato: "pdf" | "csv", completo: boolean) => {
    setConferindo(true);
    await processar(); // tenta enviar o que estiver na fila antes de conferir
    const fechado = await turnoFechadoNoBanco(turno.id);
    setConferindo(false);
    if (fechado !== true) { setNaoChegou(fechado === undefined ? "sem-internet" : "pendente"); return; }
    setNaoChegou("");
    const f = montarFechamentoImpresso(turno, state, completo);
    if (formato === "pdf") baixarFechamentoPdf(f);
    else baixarFechamentoCsv(f);
  };
  return (
    <div className="space-y-2">
      {naoChegou && (
        <div role="alert" className="bg-destructive/10 border-2 border-destructive rounded-xl p-3 space-y-1">
          <div className="text-sm font-bold text-destructive">
            {naoChegou === "sem-internet" ? "⚠️ SEM INTERNET: não deu para confirmar o fechamento" : "⚠️ O FECHAMENTO AINDA NÃO CHEGOU AO SISTEMA"}
          </div>
          <p className="text-xs">
            O relatório só pode ser gerado e enviado depois que o fechamento do turno chegar ao sistema. Deixe o app aberto,
            confira a internet e toque de novo no botão do relatório.
          </p>
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        <Button disabled={conferindo} onClick={() => gerar("pdf", admin)}>{conferindo ? "Conferindo…" : "📄 Fechamento (PDF)"}</Button>
        <Button disabled={conferindo} variant="secondary" onClick={() => gerar("csv", admin)}>📊 Fechamento (CSV)</Button>
      </div>
      {/* Dono/administrador também baixa o modelo do funcionário (sem valores), para reenviar depois de corrigir */}
      {admin && (
        <div className="space-y-1">
          <div className="text-[11px] text-muted-foreground">👤 Modelo do funcionário (sem resultado e sem valores):</div>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" disabled={conferindo} onClick={() => gerar("pdf", false)}>📄 PDF do funcionário</Button>
            <Button variant="secondary" disabled={conferindo} onClick={() => gerar("csv", false)}>📊 CSV do funcionário</Button>
          </div>
        </div>
      )}
    </div>
  );
}

export function AvisoTurnoAberto() {
  const nav = useNavigate();
  return (
    <div role="alert" className="bg-destructive/10 border-2 border-destructive rounded-xl p-3 space-y-2">
      <div className="text-sm font-bold text-destructive">⚠️ O TURNO AINDA ESTÁ ABERTO</div>
      <p className="text-xs">
        O relatório de fechamento (PDF/CSV) só pode ser gerado e enviado <b>depois de fechar o turno</b>.
        Vá no menu <b>Ponto</b> e toque em <b>"Fechar turno"</b>; o relatório aparece na tela de turno fechado.
      </p>
      <Button className="w-full" variant="destructive" onClick={() => {
        nav({ to: "/ponto" });
        setTimeout(() => document.getElementById("fechar-o-turno")?.scrollIntoView({ behavior: "smooth", block: "start" }), 400);
      }}>Ir para Fechar o turno</Button>
    </div>
  );
}

// Situação do ponto de quem trabalhou no turno (precisa de ponto na data do turno)
export function situacaoPonto(state: ReturnType<typeof useStore>["state"], t: Turno) {
  const pessoas = [t.employee, ...(t.outrosFuncionarios ?? [])];
  const situacao = pessoas.map((username) => ({
    username,
    nome: state.funcionarios.find((f) => f.username === username)?.nome ?? username,
    ok: state.pontos.some((p) => p.employeeUsername === username && p.date === t.date && !ehSoConsumo(p)),
  }));
  return { situacao, semPonto: situacao.filter((s) => !s.ok) };
}

// O que foi consumido (por pessoa, inclusive itens grátis como a água), o consumo da barraca e o descarte
export function ConsumoDoTurno({ turno }: { turno: Turno }) {
  const { state } = useStore();
  const products = getAllProducts(state);
  const admin = veResultadoCaixa(state.currentUser);
  const pessoas = consumoPorPessoaDoTurno(turno, state);
  const lista = (campo: "consumoEst" | "descarte") => products
    .map((p) => ({ p, q: turno.items[p.id]?.[campo] || 0 })).filter(({ q }) => q > 0).map(({ p, q }) => `${q}x ${p.name}`);
  const barraca = lista("consumoEst"), descarte = lista("descarte");
  return (
    <div className="bg-card border border-border rounded-xl p-3 space-y-1.5">
      <div className="text-sm font-medium">🍽 Consumo e descarte do turno</div>
      {pessoas.map((c) => (
        <div key={c.nome} className="text-xs flex justify-between gap-2">
          <span><span className="font-semibold">{c.nome}:</span> {c.itens || <span className="text-muted-foreground">nenhum consumo</span>}</span>
          {admin && c.itens && <span className="mono shrink-0">{BRL(c.valor)}</span>}
        </div>
      ))}
      {barraca.length > 0 && <div className="text-xs"><span className="font-semibold">Consumo da barraca:</span> {barraca.join(", ")}</div>}
      <div className="text-xs"><span className="font-semibold">Descarte:</span> {descarte.length > 0 ? descarte.join(", ") : <span className="text-muted-foreground">nenhum</span>}</div>
    </div>
  );
}

// Resumo das entradas (entrada + chegada) de cada produto lançado no turno
export function EntradasDoTurno({ grupos }: { grupos: GrupoEntradas[] }) {
  return (
    <div className="bg-card border border-border rounded-xl p-3">
      <div className="text-sm font-medium">📦 Entradas do turno</div>
      <div className="text-[10px] text-muted-foreground mb-1">entrada + chegada de cada produto lançado</div>
      {grupos.length === 0 ? (
        <div className="text-xs text-muted-foreground">Nenhuma entrada lançada neste turno.</div>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] text-muted-foreground uppercase">
              <th className="pb-1 font-normal">Produto</th>
              <th className="pb-1 font-normal text-right">Entrada</th>
              <th className="pb-1 font-normal text-right">Chegada</th>
              <th className="pb-1 font-normal text-right">Total</th>
            </tr>
          </thead>
          {grupos.map((g) => (
            <tbody key={g.categoria}>
              <tr><td colSpan={4} className="pt-2 pb-0.5 text-[11px] font-semibold text-primary uppercase">{g.categoria}</td></tr>
              {g.linhas.map((l) => (
                <tr key={l.produto} className="border-t border-border/50">
                  <td className="py-1">{l.produto}</td>
                  <td className="py-1 text-right mono text-muted-foreground">{l.entrada}</td>
                  <td className="py-1 text-right mono text-muted-foreground">{l.chegada}</td>
                  <td className="py-1 text-right mono font-semibold">{l.total}</td>
                </tr>
              ))}
              {g.total != null && (
                <tr className="border-t border-border font-semibold">
                  <td className="py-1" colSpan={3}>Total de pastéis <span className="text-[10px] font-normal text-muted-foreground">(sem casquinhas)</span></td>
                  <td className="py-1 text-right mono text-primary">{g.total}</td>
                </tr>
              )}
            </tbody>
          ))}
        </table>
      )}
    </div>
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

// Fechamento do turno (Esperado / Arrecadado / Diferença + botão Fechar) — fica no menu Ponto,
// junto com o registro de entrada, saída e consumo.
export function FechamentoTurno({ onClosed }: { onClosed: (t: Turno) => void }) {
  const { state, dispatch } = useStore();
  const t = state.turnoAtivo;
  const products = getAllProducts(state);
  const esperado = useMemo(() => (t ? esperadoTurno(t, products, true) : 0), [t, products]);
  const arrecadado = useMemo(() => (t ? arrecadadoTurno(t) : 0), [t]);
  if (!t) return null;
  const diff = arrecadado - esperado;
  const admin = veResultadoCaixa(state.currentUser);
  const { situacao, semPonto } = situacaoPonto(state, t);
  const [perguntando, setPerguntando] = useState(false);
  // O que já foi lançado de consumo e descarte no turno (mostrado na pergunta final para ninguém esquecer)
  const lancados = (campo: "consumo" | "consumoEst" | "descarte") => products
    .map((p) => ({ p, q: t.items[p.id]?.[campo] || 0 }))
    .filter(({ q }) => q > 0)
    .map(({ p, q }) => `${p.decimal ? String(q).replace(".", ",") : q}x ${p.name}`);
  const consumoBarraca = lancados("consumoEst");

  const closeShift = () => {
    if (semPonto.length > 0) {
      alert(
        `ATENÇÃO: NÃO É POSSÍVEL FECHAR O TURNO SEM BATER O PONTO.\n\n` +
        `FALTA REGISTRAR ENTRADA E SAÍDA (DATA ${t.date.split("-").reverse().join("/")}): ${semPonto.map((s) => s.nome).join(", ").toUpperCase()}.\n\n` +
        `USE O BOTÃO "REGISTRAR PONTO" ACIMA. SE CONSUMIU ALGUM PRODUTO, REGISTRE O CONSUMO NESSA MESMA TELA.`
      );
      return;
    }
    const produtosIncompletos = products.filter((p) => {
      const it = t.items[p.id];
      return !it || it.chegada == null || it.sobra == null;
    });
    if (produtosIncompletos.length > 0) {
      const nomes = produtosIncompletos.map((p) => p.name);
      const lista = nomes.length > 12 ? `${nomes.slice(0, 12).join(", ")} e mais ${nomes.length - 12}` : nomes.join(", ");
      alert(`Preencha Chegada e Sobra (pode ser 0) de todos os produtos, no menu Turno, antes de fechar.\n\nFaltam (${produtosIncompletos.length}): ${lista}`);
      return;
    }
    // Sobra maior que entrada + chegada (ex.: a chegada foi corrigida para menos depois) inflaria o estoque
    const sobraDemais = products.filter((p) => { const it = t.items[p.id]; return it && sobraOverflow(it); });
    if (sobraDemais.length > 0) {
      alert(`A sobra não pode ser maior que entrada + chegada. Corrija no menu Turno antes de fechar:\n\n${sobraDemais.map((p) => `• ${p.name}`).join("\n")}`);
      return;
    }
    // Maquininha nunca pode ficar menor que o valor do turno anterior (base)
    const maqsAbaixo = (t.caixa.maq2Ativa ? (["maq1", "maq2"] as const) : (["maq1"] as const))
      .filter((m) => maqAbaixoDaBase(t.caixa[m], t.shift));
    if (maqsAbaixo.length > 0) {
      alert(`ATENÇÃO: O VALOR DA MAQUININHA SÓ PODE SER IGUAL OU MAIOR QUE O DO TURNO ANTERIOR.\n\n` +
        maqsAbaixo.map((m) => `• ${nomeMaquina(state.taxasMaquininha, m)}: lançado ${BRL(valorComparadoMaq(t.caixa[m], t.shift))}, ` +
          `turno anterior ${BRL(t.caixa[m].base)}`).join("\n") +
        `\n\nCorrija no menu Turno → Caixa antes de fechar.`);
      return;
    }
    const naoPreenchidos = camposObrigatoriosDoTurno(t, state.taxasMaquininha)
      .filter(({ key }) => !(t.caixa.camposPreenchidos?.[key] ?? false))
      .map(({ label }) => label);
    if (naoPreenchidos.length > 0) {
      alert(`Preencha todos os campos do caixa (menu Turno → Caixa) antes de fechar.\n\nAinda faltam:\n${naoPreenchidos.map((l) => `• ${l}`).join("\n")}`);
      return;
    }
    // Última pergunta (Sim/Não): consumo e descarte esquecidos mudam o resultado do fechamento
    // A) Caixa não bate (diferença acima de R$ 30): antes de fechar, pede para recontar os produtos mais
    // suspeitos. Às cegas: não mostra o valor da diferença, só quais produtos conferir.
    if (!jaRecontado(t) && Math.abs(diferencaDoTurno(state, t)) > LIMITE_RECONTAGEM) {
      const pids = produtosParaRecontar(state, t);
      if (pids.length > 0) {
        setRecontagem(Object.fromEntries(pids.map((pid) => [pid, { chegada: t.items[pid]?.chegada ?? 0, sobra: null }])));
        return;
      }
    }
    setPerguntando(true);
  };

  const [conferindoAnterior, setConferindoAnterior] = useState(false);
  // Recontagem obrigatória: produto → chegada (pode corrigir) e sobra (contada de novo)
  const [recontagem, setRecontagem] = useState<Record<string, { chegada: number; sobra: number | null }> | null>(null);
  const foraDoNormal = vendasForaDoNormal(state, t);
  const confirmarRecontagem = () => {
    if (!recontagem) return;
    const faltando = Object.entries(recontagem).filter(([, v]) => v.sobra == null).map(([pid]) => products.find((p) => p.id === pid)?.name ?? pid);
    if (faltando.length > 0) { alert(`Conte de novo e digite a SOBRA de: ${faltando.join(", ")}.`); return; }
    const novos = { ...t.items };
    for (const [pid, v] of Object.entries(recontagem)) {
      const it = t.items[pid];
      if (!it) continue;
      const disp = it.entrada + v.chegada - (it.consumo || 0) - (it.descarte || 0) - (it.consumoEst || 0);
      if ((v.sobra as number) > disp) {
        alert(`${products.find((p) => p.id === pid)?.name}: a sobra (${v.sobra}) não pode ser maior que entrada + chegada − consumo/descarte (${disp}). Confira a chegada e a contagem.`);
        return;
      }
      novos[pid] = { ...it, chegada: v.chegada, sobra: v.sobra };
    }
    for (const [pid, v] of Object.entries(recontagem)) {
      if (t.items[pid]) dispatch({ type: "UPDATE_ITEM", productId: pid, patch: { chegada: v.chegada, sobra: v.sobra } });
    }
    dispatch({ type: "UPDATE_CAIXA", patch: { camposPreenchidos: { ...t.caixa.camposPreenchidos, recontagem: true } } });
    setRecontagem(null);
    const aindaNaoBate = Math.abs(diferencaDoTurno(state, { ...t, items: novos })) > LIMITE_RECONTAGEM;
    alert(aindaNaoBate
      ? "Recontagem registrada, mas ainda não está batendo.\n\nConfira também o dinheiro, as moedas, as maquininhas, o Pix e as chegadas. Se estiver tudo certo, toque em \"Fechar turno\" de novo (o fechamento fica marcado como recontado)."
      : "Recontagem registrada. Agora está batendo — toque em \"Fechar turno\" de novo.");
  };
  const confirmarFechamento = async () => {
    // Antes de fechar: o turno anterior no SISTEMA (pode ter sido fechado ou corrigido depois que este abriu)
    // precisa bater com o que este turno herdou — caixa anterior, moedas, maquininhas e entradas. Senão o
    // resultado sai errado (ex.: maquininhas herdadas da tarde em vez do "após 00:00" da noite).
    setConferindoAnterior(true);
    const recente = await buscarHistoricoRecente(3);
    setConferindoAnterior(false);
    if (!recente) {
      alert("SEM INTERNET: não foi possível conferir o turno anterior no sistema nem enviar o fechamento.\n\nConecte a internet e toque em \"Sim, fechar turno\" de novo.");
      return;
    }
    const anterior = turnoAnteriorDe({ ...state, historico: recente.historico }, t);
    if (anterior) {
      const m = mudancasDeHeranca(anterior, t, getAllProducts(state));
      const linhas = [
        ...(m.caixa ? [`• Dinheiro do caixa anterior: ${BRL(m.caixa.de)} → ${BRL(m.caixa.para)}`] : []),
        ...(m.moedas ? [`• Moedas inicial: ${BRL(m.moedas.de)} → ${BRL(m.moedas.para)}`] : []),
        ...m.bases.map((x) => `• ${nomeMaquina(state.taxasMaquininha, x.m)} (valor do turno anterior): ${BRL(x.de)} → ${BRL(x.para)}`),
        ...m.entradas.slice(0, 8).map((x) => `• Entrada de ${x.nome}: ${x.de} → ${x.para}`),
        ...(m.entradas.length > 8 ? [`• e mais ${m.entradas.length - 8} produto(s)`] : []),
      ];
      if (linhas.length > 0) {
        dispatch({
          type: "AJUSTAR_HERANCA", id: t.id,
          ...(m.caixa ? { caixaFimPrev: m.caixa.para } : {}),
          ...(m.moedas ? { moedasInicial: m.moedas.para } : {}),
          ...(m.bases.length ? { bases: Object.fromEntries(m.bases.map((x) => [x.m, x.para])) } : {}),
          ...(m.entradas.length ? { entradas: Object.fromEntries(m.entradas.map((x) => [x.id, x.para])) } : {}),
        });
        setPerguntando(false);
        alert(`O TURNO ANTERIOR (${shiftLabel(anterior.shift).replace(/^[^\p{L}]+/u, "")} de ${anterior.date.split("-").reverse().join("/")}) ESTAVA DIFERENTE NO SISTEMA.\n\n` +
          `Os valores herdados foram corrigidos:\n${linhas.join("\n")}\n\nConfira o caixa, as maquininhas e as sobras e toque em "Fechar turno" de novo.`);
        return;
      }
    }
    setPerguntando(false);
    dispatch({ type: "CLOSE_SHIFT" });
    onClosed({ ...t, closedAt: Date.now(), fechadoPor: state.currentUser?.username });
  };

  const listaLancados = (rotulo: string, itens: string[], vazio: string) => (
    <div>
      <span className="font-semibold">{rotulo}: </span>
      {itens.length > 0 ? <span>{itens.join(", ")}</span> : <span className="text-warning font-semibold">{vazio}</span>}
    </div>
  );

  return (
    <div id="fechar-o-turno" className="bg-card border border-border rounded-xl p-3 space-y-2">
      <div className="text-sm font-semibold">Fechar o turno</div>
      <div className="text-[11px] text-muted-foreground">
        {t.date.split("-").reverse().join("/")} · {t.shift === "manha" ? "Manhã" : t.shift === "tarde" ? "Tarde" : "Noite"}
      </div>
      {/* Venda feita na troca de turno caía no estoque de um turno e no dinheiro do outro (falta num, sobra no outro) */}
      <div role="note" className="text-xs bg-warning/10 border border-warning/50 rounded-lg p-2 space-y-0.5">
        <div className="font-semibold">⏸️ Antes de fechar: pare as vendas</div>
        <div className="text-muted-foreground">
          No mesmo momento: conte as sobras, leia as maquininhas e conte o dinheiro e as moedas. Só depois a próxima pessoa abre o turno dela.
        </div>
      </div>

      <div className="space-y-1">
        {situacao.map((s) => (
          <div key={s.username} className="flex justify-between text-xs">
            <span>{s.nome}</span>
            {s.ok
              ? <span className="text-success font-semibold">✓ Ponto registrado</span>
              : <span className="text-destructive font-extrabold uppercase">Falta o ponto</span>}
          </div>
        ))}
      </div>
      {semPonto.length > 0 && (
        <p className="text-destructive font-extrabold uppercase text-xs text-center bg-destructive/10 border-2 border-destructive rounded-lg p-2">
          ATENÇÃO: BATA O PONTO (ENTRADA E SAÍDA) DE {semPonto.map((s) => s.nome).join(", ").toUpperCase()} ANTES DE FECHAR O TURNO.
        </p>
      )}

      {!admin ? (
        <p className="border-t border-border pt-2 text-xs text-muted-foreground text-center">
          🔒 Confira se lançou tudo certo. O resultado do caixa é conferido pelo administrador.
        </p>
      ) : (
      <div className="border-t border-border pt-2 space-y-1">
        <Row label="Esperado"   value={BRL(esperado)} />
        <Row label="Arrecadado" value={BRL(arrecadado)} />
        <Row label="Diferença"  value={BRL(diff)}
          valueClass={Math.abs(diff) < 0.5 ? "text-success" : diff > 0 ? "text-warning" : "text-destructive"} />
        <div className="pt-1 text-center text-sm">
          {Math.abs(diff) < 0.5
            ? <span className="text-success">✓ Caixa conferido!</span>
            : diff > 0
              ? <span className="text-warning">Sobra de {BRL(diff)}</span>
              : <span className="text-destructive">⚠ Faltam {BRL(-diff)}</span>}
        </div>
      </div>
      )}

      <Button className="w-full" onClick={closeShift}>Fechar turno</Button>
      <Dialog open={recontagem != null} onOpenChange={(v) => { if (!v) setRecontagem(null); }}>
        <DialogContent className="max-w-[440px] max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Conte de novo antes de fechar</DialogTitle></DialogHeader>
          <div className="space-y-3 text-sm" id="recontagem">
            <p className="text-xs">
              <b>Algo não está batendo.</b> Pare, conte de novo <b>agora</b> estes produtos e digite a <b>SOBRA</b> que você contou.
              Confira também a <b>CHEGADA</b> (o que chegou de verdade neste turno).
            </p>
            {recontagem && Object.entries(recontagem).map(([pid, v]) => {
              const prod = products.find((p) => p.id === pid);
              const fora = foraDoNormal.find((f) => f.pid === pid);
              return (
                <div key={pid} className="bg-background border border-border rounded-lg p-2 space-y-1.5">
                  <div className="text-xs font-semibold">{prod?.name ?? pid}{fora && <span className="text-warning font-normal"> · vendeu {fora.vendido} (normal {fora.normalDe === fora.normalAte ? fora.normalAte : `${fora.normalDe} a ${fora.normalAte}`})</span>}</div>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="flex flex-col text-[10px] text-muted-foreground uppercase">Chegada
                      <BufferedNumberInput value={v.chegada} decimal={prod?.decimal} className="h-9 text-center" aria-label={`Chegada de ${prod?.name} (recontagem)`}
                        onChange={(n) => setRecontagem({ ...recontagem, [pid]: { ...v, chegada: n } })} />
                    </label>
                    <label className="flex flex-col text-[10px] text-muted-foreground uppercase">Sobra (contagem nova)
                      <input type="text" inputMode={prod?.decimal ? "decimal" : "numeric"} aria-label={`Sobra de ${prod?.name} (recontagem)`}
                        className="h-9 rounded-md px-2 text-sm mono text-center border bg-input border-border"
                        value={v.sobra == null ? "" : String(v.sobra).replace(".", ",")} placeholder="contar"
                        onChange={(e) => { const raw = e.target.value.trim(); const n = raw === "" ? null : Number(raw.replace(",", ".")); setRecontagem({ ...recontagem, [pid]: { ...v, sobra: n != null && Number.isFinite(n) ? n : null } }); }} />
                    </label>
                  </div>
                </div>
              );
            })}
            <Button className="w-full" onClick={confirmarRecontagem}>Confirmar recontagem</Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={perguntando} onOpenChange={setPerguntando}>
        <DialogContent className="max-w-[440px] max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Antes de fechar o turno</DialogTitle></DialogHeader>
          <div className="space-y-3 text-sm">
            {/* Conferência final: os mesmos blocos do Ponto, para incluir aqui mesmo o que faltou */}
            <ConsumoTurnoEditor local={t} setLocal={() => {}} isAtivo modo="ponto" />
            <DescarteTurnoEditor turno={t} />
            {(consumoBarraca.length > 0 || (t.saidas ?? []).length > 0) && (
              <div className="bg-background border border-border rounded-lg p-2.5 space-y-1 text-xs">
                {consumoBarraca.length > 0 && listaLancados("Consumo da barraca", consumoBarraca, "")}
                {(t.saidas ?? []).length > 0 && listaLancados("Saídas do caixa", (t.saidas ?? []).map((x) => `${x.nome} ${BRL(x.valor)}`), "")}
              </div>
            )}
            {foraDoNormal.length > 0 && (
              <div className="bg-warning/10 border border-warning/50 rounded-lg p-2 text-xs space-y-0.5" id="fora-do-normal">
                <div className="font-semibold text-warning">⚠ Venda fora do normal — confira a chegada e a sobra:</div>
                {foraDoNormal.map((f) => (
                  <div key={f.pid}>• <b>{f.nome}</b>: vendeu {f.vendido} (o normal neste período é {f.normalDe === f.normalAte ? f.normalAte : `${f.normalDe} a ${f.normalAte}`})</div>
                ))}
              </div>
            )}
            <p className="font-semibold">
              Todo o CONSUMO (de cada funcionário e da barraca) e todos os DESCARTES (pastel que caiu, queimou ou estragou) deste turno já foram lançados?
            </p>
            <p className="text-xs text-muted-foreground">
              O que não for lançado muda o resultado do fechamento. Lembre também: pare as vendas e conte sobras, maquininhas e dinheiro no mesmo momento.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="secondary" onClick={() => setPerguntando(false)}>Voltar</Button>
              <Button onClick={confirmarFechamento} disabled={conferindoAnterior}>{conferindoAnterior ? "Conferindo…" : "Sim, fechar turno"}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <button
        onClick={async () => {
          if (!confirm("Descartar este turno sem salvar?")) return;
          const fechado = await turnoFechadoNoBanco(t.id);
          if (fechado === true) {
            descartarPendentes([`turno:${t.id}`]);
            dispatch({ type: "SET_TURNO_ATIVO_FROM_DB", turnoAtivo: null });
            alert("Este turno já está FECHADO no sistema: ele saiu só deste celular. O fechamento verdadeiro continua guardado.");
            return;
          }
          if (fechado === undefined) { alert("SEM INTERNET: conecte para descartar o turno."); return; }
          dispatch({ type: "DISCARD_SHIFT" });
        }}
        className="w-full text-xs text-muted-foreground py-2 hover:text-destructive">
        Descartar
      </button>
    </div>
  );
}

// ── Tela pós-fechamento: acesso rápido ao relatório de sobras dos pastéis ──
// Confere no sistema se o fechamento chegou (o envio pode estar esperando a internet). Enquanto não chega,
// tenta enviar de novo a cada 5 segundos: o turno seguinte só pode abrir com este fechamento no sistema.
function useFechamentoNoSistema(id: string) {
  const [noSistema, setNoSistema] = useState<boolean | undefined>(undefined);
  useEffect(() => {
    let vivo = true, timer: ReturnType<typeof setTimeout> | undefined;
    const conferir = async () => {
      await processar();
      const ok = await turnoFechadoNoBanco(id);
      if (!vivo) return;
      setNoSistema(ok === true ? true : ok === false ? false : undefined);
      if (ok !== true) timer = setTimeout(conferir, 5000);
    };
    void conferir();
    return () => { vivo = false; if (timer) clearTimeout(timer); };
  }, [id]);
  return noSistema;
}

export function TurnoFechadoScreen({ turno, onVoltar }: { turno: Turno; onVoltar: () => void }) {
  const { state } = useStore();
  const noSistema = useFechamentoNoSistema(turno.id);
  const products = getAllProducts(state).filter((p) => p.category === "pastel");
  const linhas = products
    .map((p) => ({ p, item: turno.items[p.id] }))
    .filter(({ item }) => item && item.sobra != null);
  const totalPasteis = linhas
    .filter(({ p }) => !EXCLUIR_DO_TOTAL_PASTEL.has(p.id))
    .reduce((s, { item }) => s + (item!.sobra ?? 0), 0);

  const rel = montarRelatorioSobras(turno, getAllProducts(state), state.funcionarios, state.taxasMaquininha);

  return (
    <>
      <TopBar title="Turno fechado" />
      <div className="p-4 space-y-4">
        <div className="bg-card border border-success/40 rounded-xl p-4 text-center space-y-1">
          <div className="text-2xl">✅</div>
          <div className="text-sm font-medium">Turno fechado com sucesso!</div>
          <div className="text-xs text-muted-foreground">
            {shiftLabel(turno.shift)} · {turno.date.split("-").reverse().join("/")}
          </div>
          <div className="text-xs text-muted-foreground">
            {rel.abertoPor === rel.fechadoPor ? `Fechado por: ${rel.fechadoPor}` : `Aberto por: ${rel.abertoPor} · Fechado por: ${rel.fechadoPor}`}
            {rel.colegas.length > 0 ? ` · Colegas: ${rel.colegas.join(", ")}` : ""}
          </div>
        </div>

        {noSistema === true ? (
          <div className="text-xs text-success text-center font-semibold" id="fechamento-no-sistema">✅ Fechamento recebido pelo sistema. O próximo turno já pode abrir.</div>
        ) : (
          <div role="alert" id="fechamento-pendente" className="bg-destructive/10 border-2 border-destructive rounded-xl p-3 space-y-1">
            <div className="text-sm font-bold text-destructive">
              {noSistema === undefined ? "⏳ Enviando o fechamento para o sistema…" : "⚠️ O FECHAMENTO AINDA NÃO CHEGOU AO SISTEMA"}
            </div>
            <p className="text-xs">
              NÃO FECHE O APP. Confira a internet: o envio é tentado de novo sozinho. O próximo turno só consegue abrir depois que
              este fechamento chegar ao sistema.
            </p>
          </div>
        )}

        {/* Funcionário: só a falta é sinalizada, sem valores (caixa certo ou com sobra não mostram nada) */}
        {!veResultadoCaixa(state.currentUser) && temFaltaNoCaixa(rel.diferenca) && (
          <div role="alert" className="bg-destructive/10 border-2 border-destructive rounded-xl p-3 flex gap-3 items-start">
            <div className="text-2xl leading-none">⚠️</div>
            <div className="text-sm">
              <div className="font-bold text-destructive">{ALERTA_FALTA[0]}</div>
              <div className="text-xs text-muted-foreground mt-0.5">{ALERTA_FALTA[1]}</div>
            </div>
          </div>
        )}
        {veResultadoCaixa(state.currentUser) && (
        <div className="bg-card border border-border rounded-xl p-3 space-y-1">
          <div className="text-sm font-medium mb-1">Resultado do turno</div>
          <Row label="Esperado" value={BRL(rel.esperado)} />
          <Row label="Arrecadado" value={BRL(rel.arrecadado)} />
          <Row label="Diferença" value={BRL(rel.diferenca)}
            valueClass={Math.abs(rel.diferenca) < 0.5 ? "text-success" : rel.diferenca > 0 ? "text-warning" : "text-destructive"} />
          <div className="text-center text-sm pt-1">{rel.situacao}</div>
        </div>
        )}

        <div className="bg-card border border-border rounded-xl p-3">
          <div className="text-sm font-medium">🧾 Vendidos no turno</div>
          <div className="text-[10px] text-muted-foreground mb-1">entrada + chegada − sobra (consumo e descarte já descontados)</div>
          {rel.vendidos.map((x) => (
            <Row key={x.item} label={x.item} value={x.qtd} />
          ))}
        </div>

        <ConsumoDoTurno turno={turno} />

        <EntradasDoTurno grupos={rel.entradas} />

        <div className="bg-card border border-border rounded-xl p-3">
          <div className="text-sm font-medium mb-2">🥟 Sobras de pastéis neste fechamento</div>
          {linhas.length === 0 ? (
            <div className="text-xs text-muted-foreground">Nenhuma sobra de pastel registrada.</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] text-muted-foreground uppercase">
                  <th className="pb-1 font-normal">Sabor</th>
                  <th className="pb-1 font-normal text-right">Sobra</th>
                </tr>
              </thead>
              <tbody>
                {linhas.map(({ p, item }) => (
                  <tr key={p.id} className="border-t border-border/50">
                    <td className="py-1">{p.name}</td>
                    <td className="py-1 text-right mono">{item!.sobra}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-border font-semibold">
                  <td className="py-1.5">Total de pastéis</td>
                  <td className="py-1.5 text-right mono text-primary">{totalPasteis}</td>
                </tr>
                <tr>
                  <td colSpan={2} className="text-[10px] text-muted-foreground pt-0.5">
                    (não soma casquinha crua e frita)
                  </td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>

        <div className="bg-card border border-border rounded-xl p-3 space-y-2">
          <div className="text-sm font-medium">Relatório do fechamento (caixa, maquininhas, consumos e sobras)</div>
          <p className="text-[11px] text-muted-foreground">
            {veResultadoCaixa(state.currentUser)
              ? "Inclui o resultado (esperado × arrecadado), dinheiro, moedas, pix, maquininhas, vendidos de cada produto com os valores e o consumo dos funcionários."
              : "Inclui dinheiro, moedas, pix, maquininhas, entrada, sobra e vendidos de cada produto e o consumo. Gere o arquivo e envie para o dono."}
          </p>
          <RelatorioSobrasBotoes turno={turno} />
        </div>
        <Button variant="secondary" className="w-full" onClick={onVoltar}>Voltar</Button>
      </div>
    </>
  );
}

