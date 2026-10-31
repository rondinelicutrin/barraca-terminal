import { useMemo, useState } from "react";
import { useStore, veResultadoCaixa, getAllProducts, esperadoTurno, arrecadadoTurno, nomeMaquina, ehSoConsumo, sobraOverflow, maqAbaixoDaBase, valorComparadoMaq, type Turno, type TaxasMaquininha } from "@/lib/store";
import { BRL, shiftLabel } from "@/lib/format";
import { TopBar } from "@/components/Shell";
import { EXCLUIR_DO_TOTAL_PASTEL } from "@/lib/products";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { montarRelatorioSobras, type GrupoEntradas } from "@/lib/relatorio-sobras";
import { montarFechamentoImpresso, baixarFechamentoPdf, baixarFechamentoCsv, temFaltaNoCaixa, ALERTA_FALTA } from "@/lib/fechamento-impresso";

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

// Dois botões (PDF e CSV) com o fechamento geral do turno, numa folha só
export function RelatorioSobrasBotoes({ turno }: { turno: Turno }) {
  const { state } = useStore();
  const gerar = (formato: "pdf" | "csv") => {
    // Funcionário comum baixa a versão às cegas (sem resultado e sem valores de venda)
    const f = montarFechamentoImpresso(turno, state, veResultadoCaixa(state.currentUser));
    if (formato === "pdf") baixarFechamentoPdf(f);
    else baixarFechamentoCsv(f);
  };
  return (
    <div className="grid grid-cols-2 gap-2">
      <Button onClick={() => gerar("pdf")}>📄 Fechamento (PDF)</Button>
      <Button variant="secondary" onClick={() => gerar("csv")}>📊 Fechamento (CSV)</Button>
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
  const consumoLancado = lancados("consumo"), consumoBarraca = lancados("consumoEst"), descarteLancado = lancados("descarte");

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
    setPerguntando(true);
  };

  const confirmarFechamento = () => {
    setPerguntando(false);
    dispatch({ type: "CLOSE_SHIFT" });
    onClosed({ ...t, closedAt: Date.now(), fechadoPor: state.currentUser?.username });
  };

  const vouLancar = () => {
    setPerguntando(false);
    // Leva até os botões de consumo e descarte (menu Ponto)
    setTimeout(() => document.getElementById("lancar-consumo-descarte")?.scrollIntoView({ behavior: "smooth", block: "center" }), 150);
  };

  const listaLancados = (rotulo: string, itens: string[], vazio: string) => (
    <div>
      <span className="font-semibold">{rotulo}: </span>
      {itens.length > 0 ? <span>{itens.join(", ")}</span> : <span className="text-warning font-semibold">{vazio}</span>}
    </div>
  );

  return (
    <div className="bg-card border border-border rounded-xl p-3 space-y-2">
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
      <Dialog open={perguntando} onOpenChange={setPerguntando}>
        <DialogContent className="max-w-[420px]">
          <DialogHeader><DialogTitle>Antes de fechar o turno</DialogTitle></DialogHeader>
          <div className="space-y-3 text-sm">
            <div className="bg-background border border-border rounded-lg p-2.5 space-y-1 text-xs">
              <div className="text-[11px] text-muted-foreground uppercase tracking-wide">Já lançado neste turno</div>
              {listaLancados("Consumo dos funcionários", consumoLancado, "nenhum lançado")}
              {consumoBarraca.length > 0 && listaLancados("Consumo da barraca", consumoBarraca, "")}
              {listaLancados("Descarte", descarteLancado, "nenhum lançado")}
            </div>
            <p className="font-semibold">
              Todo o CONSUMO (de cada funcionário e da barraca) e todos os DESCARTES (pastel que caiu, queimou ou estragou) deste turno já foram lançados?
            </p>
            <p className="text-xs text-muted-foreground">
              O que não for lançado muda o resultado do fechamento. Lembre também: pare as vendas e conte sobras, maquininhas e dinheiro no mesmo momento.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="secondary" onClick={vouLancar}>Lançar consumo/descarte</Button>
              <Button onClick={confirmarFechamento}>Sim, fechar turno</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <button
        onClick={() => confirm("Descartar este turno sem salvar?") && dispatch({ type: "DISCARD_SHIFT" })}
        className="w-full text-xs text-muted-foreground py-2 hover:text-destructive">
        Descartar
      </button>
    </div>
  );
}

// ── Tela pós-fechamento: acesso rápido ao relatório de sobras dos pastéis ──
export function TurnoFechadoScreen({ turno, onVoltar }: { turno: Turno; onVoltar: () => void }) {
  const { state } = useStore();
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

