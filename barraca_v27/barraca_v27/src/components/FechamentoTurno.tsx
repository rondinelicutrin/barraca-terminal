import { useMemo } from "react";
import { useStore, getAllProducts, esperadoTurno, arrecadadoTurno, nomeMaquina, ehSoConsumo, type Turno, type TaxasMaquininha } from "@/lib/store";
import { BRL, shiftLabel } from "@/lib/format";
import { TopBar } from "@/components/Shell";
import { EXCLUIR_DO_TOTAL_PASTEL } from "@/lib/products";
import { Button } from "@/components/ui/button";
import { montarRelatorioSobras, baixarRelatorioSobrasPdf, baixarRelatorioSobrasCsv } from "@/lib/relatorio-sobras";

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

// Dois botões (PDF e CSV) com as sobras de todos os produtos de um turno
export function RelatorioSobrasBotoes({ turno }: { turno: Turno }) {
  const { state } = useStore();
  const gerar = (formato: "pdf" | "csv") => {
    const rel = montarRelatorioSobras(turno, getAllProducts(state), state.funcionarios);
    if (rel.grupos.length === 0) { alert("Nenhuma sobra registrada neste turno."); return; }
    if (formato === "pdf") baixarRelatorioSobrasPdf(rel);
    else baixarRelatorioSobrasCsv(rel);
  };
  return (
    <div className="grid grid-cols-2 gap-2">
      <Button onClick={() => gerar("pdf")}>📄 Sobras (PDF)</Button>
      <Button variant="secondary" onClick={() => gerar("csv")}>📊 Sobras (CSV)</Button>
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
  const { situacao, semPonto } = situacaoPonto(state, t);

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
    const naoPreenchidos = camposObrigatoriosDoTurno(t, state.taxasMaquininha)
      .filter(({ key }) => !(t.caixa.camposPreenchidos?.[key] ?? false))
      .map(({ label }) => label);
    if (naoPreenchidos.length > 0) {
      alert(`Preencha todos os campos do caixa (menu Turno → Caixa) antes de fechar.\n\nAinda faltam:\n${naoPreenchidos.map((l) => `• ${l}`).join("\n")}`);
      return;
    }
    if (confirm("Fechar turno? Não poderá mais editar campos aqui (o dono pode editar depois).")) {
      dispatch({ type: "CLOSE_SHIFT" });
      onClosed({ ...t, closedAt: Date.now() });
    }
  };

  return (
    <div className="bg-card border border-border rounded-xl p-3 space-y-2">
      <div className="text-sm font-semibold">Fechar o turno</div>
      <div className="text-[11px] text-muted-foreground">
        {t.date.split("-").reverse().join("/")} · {t.shift === "manha" ? "Manhã" : t.shift === "tarde" ? "Tarde" : "Noite"}
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

      <Button className="w-full" onClick={closeShift}>Fechar turno</Button>
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

  const rel = montarRelatorioSobras(turno, getAllProducts(state), state.funcionarios);

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
            Fechamento: {rel.fechadoPor}{rel.colegas.length > 0 ? ` · Colegas: ${rel.colegas.join(", ")}` : ""}
          </div>
        </div>

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
          <div className="text-sm font-medium">Relatório de sobras (todos os produtos)</div>
          <p className="text-[11px] text-muted-foreground">
            Inclui o nome de quem fechou o turno e dos colegas. Gere o arquivo e envie para o dono.
          </p>
          <RelatorioSobrasBotoes turno={turno} />
        </div>
        <Button variant="secondary" className="w-full" onClick={onVoltar}>Voltar</Button>
      </div>
    </>
  );
}

