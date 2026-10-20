import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Shell, TopBar, BottomNav } from "@/components/Shell";
import { useStore, getAllProducts, valorConsumoPonto, ehSoConsumo, type Funcionario } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DatePickerBR } from "@/components/ui/date-picker-br";
import { BufferedNumberInput } from "@/components/ui/buffered-number-input";
import { BRL, formatDateBR, todayISO } from "@/lib/format";
import { baixarExcel } from "@/lib/excel";
import { gerarRelatorioPdf } from "@/lib/pdf";
import { baixarCsv } from "@/lib/csv";
import { Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useFiltro } from "@/lib/filtros";

export const Route = createFileRoute("/owner/funcionarios")({
  component: Funcionarios,
  head: () => ({ meta: [{ title: "Equipe — Barraca Terminal" }, { name: "description", content: "Cadastro de funcionários e folha semanal." }] }),
});

function hoursBetween(entrada: string, saida: string) {
  const [h1, m1] = entrada.split(":").map(Number);
  const [h2, m2] = saida.split(":").map(Number);
  let mins = h2 * 60 + m2 - (h1 * 60 + m1);
  if (mins < 0) mins += 24 * 60;
  return mins / 60;
}

function Funcionarios() {
  const { state, dispatch } = useStore();
  const [nome, setNome] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [taxaHora, setTaxaHora] = useState(0);
  const [role, setRole] = useState<"employee" | "owner">("employee");
  const [showFolha, setShowFolha] = useState(false);
  const [showRelatorio, setShowRelatorio] = useState(false);
  const [editando, setEditando] = useState<string | null>(null);

  const add = () => {
    if (!nome || !username || !password) return alert("Preencha todos os campos");
    if (state.funcionarios.some((f) => f.username === username) || username === "dono")
      return alert("Usuário já existe");
    const f: Funcionario = { id: crypto.randomUUID(), nome, username, password, taxaHora, role };
    dispatch({ type: "ADD_FUNC", f });
    setNome(""); setUsername(""); setPassword(""); setTaxaHora(0); setRole("employee");
  };

  // Desativar mantém todo o histórico (turnos, pontos, folha), mas a pessoa não consegue mais entrar
  // no app nem aparece para ser marcada em turnos/pontos. Dá para ativar de novo a qualquer momento.
  const alternarAtivo = (f: Funcionario) => {
    const inativo = f.ativo === false;
    if (!inativo) {
      if (state.currentUser?.username === f.username) { alert("Você não pode desativar o seu próprio acesso."); return; }
      if (!confirm(`Desativar ${f.nome}?\n\nEle não conseguirá mais entrar no app, mas todo o histórico (turnos, ponto, folha) é mantido. Você pode ativar de novo quando quiser.`)) return;
    }
    dispatch({ type: "UPDATE_FUNC", id: f.id, patch: { ativo: inativo } });
  };

  const cg = state.configGeral;

  return (
    <Shell>
      <TopBar
        title="Equipe"
        right={
          <div className="flex items-center gap-2.5 flex-wrap justify-end">
            <Link to="/owner/descontos" className="text-xs text-primary">🏷️ Descontos</Link>
            <button onClick={() => setShowRelatorio(true)} className="text-xs text-primary">📊 Relatório</button>
            <button onClick={() => setShowFolha(true)} className="text-xs text-primary">📋 Folha</button>
          </div>
        }
      />
      <div className="p-3 space-y-3">
        <div className="bg-card border border-border rounded-xl p-3 space-y-2">
          <h2 className="text-sm font-semibold">Valores padrão (transporte e refeição)</h2>
          <p className="text-[11px] text-muted-foreground -mt-1">
            Usados automaticamente em todo registro de ponto. O funcionário não edita esses valores.
          </p>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="text-[10px] text-muted-foreground uppercase tracking-wide">Transp. ida (R$)</label>
              <BufferedNumberInput value={cg.transporteIda} placeholder="0,00" className="mt-0.5 w-full"
                onChange={(n) => dispatch({ type: "SET_CONFIG_GERAL", patch: { transporteIda: n } })} />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground uppercase tracking-wide">Transp. volta (R$)</label>
              <BufferedNumberInput value={cg.transporteVolta} placeholder="0,00" className="mt-0.5 w-full"
                onChange={(n) => dispatch({ type: "SET_CONFIG_GERAL", patch: { transporteVolta: n } })} />
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground uppercase tracking-wide">Refeição (R$)</label>
              <BufferedNumberInput value={cg.refeicao} placeholder="0,00" className="mt-0.5 w-full"
                onChange={(n) => dispatch({ type: "SET_CONFIG_GERAL", patch: { refeicao: n } })} />
            </div>
          </div>
        </div>

        <div className="bg-card border border-border rounded-xl p-3 space-y-2">
          <h2 className="text-sm font-semibold">Novo funcionário</h2>
          <Input placeholder="Nome" value={nome} onChange={(e) => setNome(e.target.value)} />
          <Input placeholder="Usuário" value={username} onChange={(e) => setUsername(e.target.value)} autoCapitalize="none" />
          <Input placeholder="Senha" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <div>
            <label className="text-xs text-muted-foreground">Taxa por hora (R$)</label>
            <BufferedNumberInput value={taxaHora} placeholder="0,00" className="mt-1 w-full h-10"
              onChange={setTaxaHora} />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Tipo de acesso</label>
            <div className="mt-1 grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setRole("employee")}
                className={`h-10 rounded-md text-sm border ${role === "employee" ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-muted-foreground"}`}>
                Funcionário
              </button>
              <button type="button" onClick={() => setRole("owner")}
                className={`h-10 rounded-md text-sm border ${role === "owner" ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-muted-foreground"}`}>
                Administrador
              </button>
            </div>
            {role === "owner" && (
              <p className="text-[11px] text-warning mt-1">
                Administradores acessam o Painel de controle (como você), não só o Turno e o Ponto.
              </p>
            )}
          </div>
          <Button onClick={add} className="w-full">Cadastrar</Button>
        </div>

        <div>
          <h2 className="text-sm font-semibold mb-2">Cadastrados</h2>
          <div className="space-y-2">
            {state.funcionarios.length === 0 && <div className="text-sm text-muted-foreground">Nenhum ainda.</div>}
            {[...state.funcionarios].sort((x, y) => Number(x.ativo === false) - Number(y.ativo === false)).map((f) => {
              const inativo = f.ativo === false;
              return (
                <div
                  key={f.id}
                  className={`bg-card border border-border rounded-lg flex items-stretch hover:border-primary/50 transition-colors ${inativo ? "opacity-60" : ""}`}
                >
                  <button onClick={() => setEditando(f.id)} className="flex-1 text-left p-3 min-w-0">
                    <div className="text-sm font-medium flex items-center gap-1.5 flex-wrap">
                      {f.nome}
                      {f.role === "owner" && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/20 text-primary">Admin</span>}
                      {inativo && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-destructive/20 text-destructive">Desativado</span>}
                    </div>
                    <div className="text-xs text-muted-foreground mono">@{f.username} · {BRL(f.taxaHora)}/h · Editar ›</div>
                  </button>
                  <button
                    onClick={() => alternarAtivo(f)}
                    className={`px-3 text-xs border-l border-border rounded-r-lg ${inativo ? "text-success" : "text-muted-foreground hover:text-destructive"}`}
                  >
                    {inativo ? "Ativar" : "Desativar"}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <FolhaSemanal open={showFolha} onOpenChange={setShowFolha} />
      <RelatorioExcelDialog open={showRelatorio} onOpenChange={setShowRelatorio} />
      <EditFuncionarioDialog
        funcionarioId={editando}
        onOpenChange={(v) => { if (!v) setEditando(null); }}
      />
      <BottomNav />
    </Shell>
  );
}

// Cálculo padrão de folha: horas + diária + transporte + refeição (benefícios pagos ao
// funcionário), menos consumo/desconto, mais adicional
function calcularFolha(state: ReturnType<typeof useStore>["state"], f: Funcionario, meus: ReturnType<typeof useStore>["state"]["pontos"], products: ReturnType<typeof getAllProducts>) {
  let horas = 0, transp = 0, ref = 0, consumo = 0;
  const dias = new Set<string>();
  for (const p of meus) {
    if (ehSoConsumo(p)) { consumo += valorConsumoPonto(state, f.username, p.consumo); continue; }
    horas += hoursBetween(p.entrada, p.saida);
    transp += p.transporte;
    ref += p.refeicao;
    dias.add(p.date);
    consumo += valorConsumoPonto(state, f.username, p.consumo);
  }
  const diasTrabalhados = dias.size;
  const bruto = horas * f.taxaHora + diasTrabalhados * (f.valorDiaria ?? 0);
  const desconto = f.desconto ?? 0;
  const adicional = f.adicional ?? 0;
  // Transporte e refeição são benefícios pagos ao funcionário: somam no valor a receber.
  // Consumo e desconto são deduções: subtraem. Adicional soma.
  const liquido = Math.max(0, bruto + transp + ref - consumo - desconto + adicional);
  return { horas, diasTrabalhados, transp, ref, consumo, bruto, desconto, adicional, liquido };
}

// Diálogo de edição de um funcionário: valores pessoais de transporte/refeição, taxa por hora,
// diária, desconto, adicional — e o valor a receber calculado para o período selecionado.
function EditFuncionarioDialog({ funcionarioId, onOpenChange }: { funcionarioId: string | null; onOpenChange: (v: boolean) => void }) {
  const { state, dispatch } = useStore();
  const products = getAllProducts(state);
  const f = state.funcionarios.find((x) => x.id === funcionarioId) ?? null;
  const cg = state.configGeral;

  const [from, setFrom] = useFiltro("folha.from", () => {
    const d = new Date(); d.setDate(d.getDate() - 7);
    return d.toISOString().slice(0, 10);
  });
  const [to, setTo] = useFiltro("folha.to", todayISO());

  if (!f) return null;

  const meus = state.pontos.filter((p) => p.employeeUsername === f.username && p.date >= from && p.date <= to);
  const calc = calcularFolha(state, f, meus, products);

  const upd = (patch: Partial<Funcionario>) => dispatch({ type: "UPDATE_FUNC", id: f.id, patch });

  const remover = () => {
    if (confirm(`Remover ${f.nome}?`)) {
      dispatch({ type: "REMOVE_FUNC", id: f.id });
      onOpenChange(false);
    }
  };

  const baixarCsvArquivo = () => {
    baixarCsv(
      `valor-a-receber-${f.username}-${from}-a-${to}.csv`,
      ["Funcionário", "Período", "Horas", "Dias", "Bruto", "Transporte", "Refeição", "Consumo", "Desconto", "Adicional", "Valor a receber"],
      [[
        f.nome, `${formatDateBR(from)} a ${formatDateBR(to)}`, calc.horas.toFixed(2), calc.diasTrabalhados,
        calc.bruto.toFixed(2), calc.transp.toFixed(2), calc.ref.toFixed(2), calc.consumo.toFixed(2),
        calc.desconto.toFixed(2), calc.adicional.toFixed(2), calc.liquido.toFixed(2),
      ]],
    );
  };

  const baixarPdfArquivo = () => {
    gerarRelatorioPdf({
      filename: `valor-a-receber-${f.username}-${from}-a-${to}.pdf`,
      title: `Valor a receber — ${f.nome}`,
      subtitle: `${formatDateBR(from)} a ${formatDateBR(to)}`,
      sections: [{
        columns: ["Item", "Valor"],
        rows: [
          ["Horas trabalhadas", calc.horas.toFixed(2)],
          ["Dias trabalhados", String(calc.diasTrabalhados)],
          ["Bruto (horas + diária)", `R$ ${calc.bruto.toFixed(2)}`],
          ["Transporte (+)", `R$ ${calc.transp.toFixed(2)}`],
          ["Refeição (+)", `R$ ${calc.ref.toFixed(2)}`],
          ["Consumo (-)", `R$ ${calc.consumo.toFixed(2)}`],
          ["Desconto (-)", `R$ ${calc.desconto.toFixed(2)}`],
          ["Adicional (+)", `R$ ${calc.adicional.toFixed(2)}`],
        ],
        totalRow: ["Valor a receber", `R$ ${calc.liquido.toFixed(2)}`],
      }],
    });
  };

  const campo = (label: string, value: number, onChange: (n: number) => void, placeholder?: string) => (
    <div>
      <label className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</label>
      <BufferedNumberInput value={value} decimal placeholder={placeholder ?? "0,00"} className="mt-0.5 w-full"
        onChange={onChange} />
    </div>
  );

  return (
    <Dialog open={!!f} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[480px] max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{f.nome}</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="text-xs text-muted-foreground mono">@{f.username}</div>

          <div className="space-y-2">
            <h3 className="text-sm font-semibold">Tipo de acesso</h3>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => upd({ role: "employee" })}
                className={`h-10 rounded-md text-sm border ${f.role === "employee" ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-muted-foreground"}`}>
                Funcionário
              </button>
              <button type="button" onClick={() => upd({ role: "owner" })}
                className={`h-10 rounded-md text-sm border ${f.role === "owner" ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-muted-foreground"}`}>
                Administrador
              </button>
            </div>
            {f.role === "owner" && (
              <p className="text-[11px] text-warning">
                Este usuário acessa o Painel de controle (como você), não só o Turno e o Ponto.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <h3 className="text-sm font-semibold">Valores de pagamento</h3>
            <div className="grid grid-cols-2 gap-2">
              {campo("Taxa por hora (R$)", f.taxaHora, (n) => upd({ taxaHora: n }))}
              {campo("Valor por diária (R$)", f.valorDiaria ?? 0, (n) => upd({ valorDiaria: n }))}
            </div>
            <div className="grid grid-cols-2 gap-2">
              {campo("Desconto (R$)", f.desconto ?? 0, (n) => upd({ desconto: n }))}
              {campo("Adicional (R$)", f.adicional ?? 0, (n) => upd({ adicional: n }))}
            </div>
          </div>

          <div className="space-y-2">
            <h3 className="text-sm font-semibold">Transporte e refeição (pessoal)</h3>
            <p className="text-[11px] text-muted-foreground -mt-1">
              Deixe em 0 para usar o padrão geral (Ida {BRL(cg.transporteIda)} · Volta {BRL(cg.transporteVolta)} ·
              Refeição {BRL(cg.refeicao)}).
            </p>
            <div className="grid grid-cols-3 gap-2">
              {campo("Transp. ida (R$)", f.transporteIda ?? 0, (n) => upd({ transporteIda: n || undefined }))}
              {campo("Transp. volta (R$)", f.transporteVolta ?? 0, (n) => upd({ transporteVolta: n || undefined }))}
              {campo("Refeição (R$)", f.refeicao ?? 0, (n) => upd({ refeicao: n || undefined }))}
            </div>
          </div>

          <div className="space-y-2 border-t border-border pt-3">
            <h3 className="text-sm font-semibold">Valor a receber</h3>
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
            <div className="bg-background border border-border rounded-lg p-3 text-xs text-muted-foreground mono space-y-0.5">
              <div className="flex justify-between"><span>Horas: {calc.horas.toFixed(2)}</span><span>Dias: {calc.diasTrabalhados}</span></div>
              <div className="flex justify-between"><span>Bruto</span><span>{BRL(calc.bruto)}</span></div>
              <div className="flex justify-between"><span>Transporte</span><span>+{BRL(calc.transp)}</span></div>
              <div className="flex justify-between"><span>Refeição</span><span>+{BRL(calc.ref)}</span></div>
              <div className="flex justify-between"><span>Consumo</span><span>-{BRL(calc.consumo)}</span></div>
              <div className="flex justify-between"><span>Desconto</span><span>-{BRL(calc.desconto)}</span></div>
              <div className="flex justify-between"><span>Adicional</span><span>+{BRL(calc.adicional)}</span></div>
            </div>
            <div className="flex justify-between items-center text-sm font-semibold">
              <span>Valor a receber</span>
              <span className="mono text-primary text-lg">{BRL(calc.liquido)}</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="secondary" onClick={baixarPdfArquivo}>📄 PDF</Button>
              <Button variant="secondary" onClick={baixarCsvArquivo}>📊 CSV</Button>
            </div>
          </div>

          <Button variant="secondary" onClick={remover} className="w-full text-destructive">
            <Trash2 className="w-4 h-4 mr-1.5" /> Remover funcionário
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function FolhaSemanal({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { state } = useStore();
  const [from, setFrom] = useFiltro("relatorio.from", () => {
    const d = new Date(); d.setDate(d.getDate() - 7);
    return d.toISOString().slice(0, 10);
  });
  const [to, setTo] = useFiltro("relatorio.to", todayISO());

  const products = getAllProducts(state);
  const rows = useMemo(() => {
    const pontos = state.pontos.filter((p) => p.date >= from && p.date <= to);
    return state.funcionarios.map((f) => {
      const meus = pontos.filter((p) => p.employeeUsername === f.username);
      const calc = calcularFolha(state, f, meus, products);
      return { f, ...calc, meus };
    });
  }, [state, from, to, products]);

  const exportCSV = () => {
    baixarCsv(
      `folha_${from}_${to}.csv`,
      ["Funcionário", "Horas", "Dias", "Bruto", "Transporte", "Refeição", "Consumo", "Desconto", "Adicional", "Líquido"],
      rows.map((r) => [r.f.nome, r.horas.toFixed(2), r.diasTrabalhados, r.bruto.toFixed(2), r.transp.toFixed(2), r.ref.toFixed(2), r.consumo.toFixed(2), r.desconto.toFixed(2), r.adicional.toFixed(2), r.liquido.toFixed(2)]),
    );
  };

  const exportPDF = () => {
    gerarRelatorioPdf({
      filename: `folha_${from}_${to}.pdf`,
      title: "Folha de pagamento",
      subtitle: `${formatDateBR(from)} a ${formatDateBR(to)}`,
      sections: [{
        columns: ["Funcionário", "Horas", "Dias", "Bruto", "Transp.", "Refeição", "Consumo", "Desc.", "Adic.", "Líquido"],
        rows: rows.map((r) => [
          r.f.nome, r.horas.toFixed(2), String(r.diasTrabalhados), `R$${r.bruto.toFixed(2)}`,
          `R$${r.transp.toFixed(2)}`, `R$${r.ref.toFixed(2)}`, `R$${r.consumo.toFixed(2)}`,
          `R$${r.desconto.toFixed(2)}`, `R$${r.adicional.toFixed(2)}`, `R$${r.liquido.toFixed(2)}`,
        ]),
      }],
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[480px] max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Folha (por período)</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <p className="text-[11px] text-muted-foreground">
            Escolha qualquer intervalo — um dia, uma semana, um mês ou um ano — para gerar a folha.
          </p>
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
          <div className="space-y-2">
            {rows.map((r) => (
              <div key={r.f.id} className="bg-card border border-border rounded-lg p-3">
                <div className="flex justify-between text-sm font-medium">
                  <span>{r.f.nome}</span>
                  <span className="mono text-primary">{BRL(r.liquido)}</span>
                </div>
                <div className="text-xs text-muted-foreground mono mt-1 grid grid-cols-2 gap-x-2">
                  <span>Horas: {r.horas.toFixed(2)}</span>
                  <span>Bruto: {BRL(r.bruto)}</span>
                  <span>Transp: +{BRL(r.transp)}</span>
                  <span>Ref: +{BRL(r.ref)}</span>
                  <span>Consumo: -{BRL(r.consumo)}</span>
                  <span>Desc/Adic: -{BRL(r.desconto)}/+{BRL(r.adicional)}</span>
                </div>
              </div>
            ))}
            {rows.length === 0 && <div className="text-sm text-muted-foreground">Nenhum funcionário.</div>}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" onClick={exportPDF}>📄 PDF</Button>
            <Button onClick={exportCSV}>📊 CSV</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Horário padrão de início de cada turno, usado só para estimar o atraso (não há turno vinculado ao Ponto)
function calcAtrasoMin(entrada: string): number {
  const [h, m] = entrada.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return 0;
  const minutos = h * 60 + m;
  let padrao: number;
  if (minutos < 12 * 60) padrao = 8 * 60;        // manhã: 08:00
  else if (minutos < 17 * 60) padrao = 14 * 60;  // tarde: 14:00
  else padrao = 18 * 60;                         // noite: 18:00
  return Math.max(0, minutos - padrao);
}

// Período do dia estimado a partir do horário de entrada (Ponto não guarda o turno diretamente)
function periodoPorHorario(entrada: string): string {
  const [h, m] = entrada.split(":").map(Number);
  if (Number.isNaN(h)) return "—";
  const minutos = h * 60 + m;
  if (minutos < 12 * 60) return "Manhã";
  if (minutos < 17 * 60) return "Tarde";
  return "Noite";
}

// Indica se o funcionário é pago por diária, por hora, ou ambos
function tipoPagamento(f?: Funcionario): string {
  if (!f) return "—";
  const temDiaria = (f.valorDiaria ?? 0) > 0;
  const temHora = f.taxaHora > 0;
  if (temDiaria && temHora) return "Diária + Hora";
  if (temDiaria) return "Diária";
  return "Hora";
}

// Relatório completo por período: detalhamento dia a dia + resumo de pagamento por funcionário,
// já com tudo somado (bruto, transporte, alimentação, consumo, desconto, adicional, valor a receber)
// — pronto para conferir o pagamento de cada funcionário e o total do período. Excel, PDF ou CSV.
function RelatorioExcelDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { state } = useStore();
  const products = getAllProducts(state);
  const [from, setFrom] = useFiltro("equipe-consumo.from", todayISO());
  const [to, setTo] = useFiltro("equipe-consumo.to", todayISO());

  const funcOf = (username: string) => state.funcionarios.find((x) => x.username === username);

  // Tabela 1: um registro por ponto batido, ordenado por data e depois nome
  const detalhes = useMemo(() => {
    return state.pontos
      .filter((p) => p.date >= from && p.date <= to)
      .map((p) => {
        const f = funcOf(p.employeeUsername);
        const consumo = valorConsumoPonto(state, p.employeeUsername, p.consumo);
        const soConsumo = ehSoConsumo(p);
        const horas = soConsumo ? 0 : hoursBetween(p.entrada, p.saida);
        const valorDia = soConsumo ? -consumo : horas * (f?.taxaHora ?? 0) + (f?.valorDiaria ?? 0) + p.transporte + p.refeicao - consumo;
        return {
          nome: f?.nome ?? p.employeeUsername,
          data: p.date,
          periodo: soConsumo ? "Consumo" : periodoPorHorario(p.entrada),
          entrada: p.entrada,
          saida: p.saida,
          atraso: soConsumo ? 0 : calcAtrasoMin(p.entrada),
          tipo: tipoPagamento(f),
          alimentacao: p.refeicao,
          transporte: p.transporte,
          consumo,
          valorDia: soConsumo ? valorDia : Math.max(0, valorDia),
        };
      })
      .sort((a, b) => a.data.localeCompare(b.data) || a.nome.localeCompare(b.nome));
  }, [state.pontos, state.funcionarios, from, to, products]);

  const totalDetalhes = useMemo(() => detalhes.reduce((s, r) => ({
    alimentacao: s.alimentacao + r.alimentacao,
    transporte: s.transporte + r.transporte,
    consumo: s.consumo + r.consumo,
    valorDia: s.valorDia + r.valorDia,
  }), { alimentacao: 0, transporte: 0, consumo: 0, valorDia: 0 }), [detalhes]);

  // Tabela 2: resumo de pagamento por funcionário (usa a mesma fórmula da Folha), ordenado por nome
  const resumo = useMemo(() => {
    const pontos = state.pontos.filter((p) => p.date >= from && p.date <= to);
    return state.funcionarios
      .map((f) => {
        const meus = pontos.filter((p) => p.employeeUsername === f.username);
        if (meus.length === 0) return null;
        const calc = calcularFolha(state, f, meus, products);
        return { f, tipo: tipoPagamento(f), ...calc };
      })
      .filter((r): r is NonNullable<typeof r> => r != null)
      .sort((a, b) => a.f.nome.localeCompare(b.f.nome));
  }, [state.pontos, state.funcionarios, from, to, products]);

  const totalResumo = useMemo(() => resumo.reduce((s, r) => ({
    horas: s.horas + r.horas, bruto: s.bruto + r.bruto, transp: s.transp + r.transp, ref: s.ref + r.ref,
    consumo: s.consumo + r.consumo, desconto: s.desconto + r.desconto, adicional: s.adicional + r.adicional,
    liquido: s.liquido + r.liquido,
  }), { horas: 0, bruto: 0, transp: 0, ref: 0, consumo: 0, desconto: 0, adicional: 0, liquido: 0 }), [resumo]);

  const semDados = detalhes.length === 0 && resumo.length === 0;

  const baixar = () => {
    if (semDados) { alert("Nenhum registro de ponto no período selecionado."); return; }
    baixarExcel(`relatorio-equipe-${from}-a-${to}.xlsx`, [
      {
        name: "Detalhamento", rows: [
          ...detalhes.map((r) => ({
            Funcionário: r.nome, Data: formatDateBR(r.data), Período: r.periodo, Entrada: r.entrada, Saída: r.saida,
            "Atraso (min)": r.atraso, Tipo: r.tipo, "Alimentação (R$)": Number(r.alimentacao.toFixed(2)),
            "Transporte (R$)": Number(r.transporte.toFixed(2)), "Consumo (R$)": Number(r.consumo.toFixed(2)),
            "Valor do dia (R$)": Number(r.valorDia.toFixed(2)),
          })),
          {
            Funcionário: "TOTAL", Data: "", Período: "", Entrada: "", Saída: "", "Atraso (min)": "", Tipo: "",
            "Alimentação (R$)": Number(totalDetalhes.alimentacao.toFixed(2)),
            "Transporte (R$)": Number(totalDetalhes.transporte.toFixed(2)),
            "Consumo (R$)": Number(totalDetalhes.consumo.toFixed(2)),
            "Valor do dia (R$)": Number(totalDetalhes.valorDia.toFixed(2)),
          },
        ],
      },
      {
        name: "Resumo pagamento", rows: [
          ...resumo.map((r) => ({
            Funcionário: r.f.nome, Tipo: r.tipo, "Dias": r.diasTrabalhados, "Horas": Number(r.horas.toFixed(2)),
            "Bruto (R$)": Number(r.bruto.toFixed(2)), "Transporte (R$)": Number(r.transp.toFixed(2)),
            "Alimentação (R$)": Number(r.ref.toFixed(2)), "Consumo (R$)": Number(r.consumo.toFixed(2)),
            "Desconto (R$)": Number(r.desconto.toFixed(2)), "Adicional (R$)": Number(r.adicional.toFixed(2)),
            "Valor a receber (R$)": Number(r.liquido.toFixed(2)),
          })),
          {
            Funcionário: "TOTAL DO PERÍODO", Tipo: "", Dias: "", Horas: Number(totalResumo.horas.toFixed(2)),
            "Bruto (R$)": Number(totalResumo.bruto.toFixed(2)), "Transporte (R$)": Number(totalResumo.transp.toFixed(2)),
            "Alimentação (R$)": Number(totalResumo.ref.toFixed(2)), "Consumo (R$)": Number(totalResumo.consumo.toFixed(2)),
            "Desconto (R$)": Number(totalResumo.desconto.toFixed(2)), "Adicional (R$)": Number(totalResumo.adicional.toFixed(2)),
            "Valor a receber (R$)": Number(totalResumo.liquido.toFixed(2)),
          },
        ],
      },
    ]);
  };

  const baixarPdfArquivo = () => {
    if (semDados) { alert("Nenhum registro de ponto no período selecionado."); return; }
    gerarRelatorioPdf({
      filename: `relatorio-equipe-${from}-a-${to}.pdf`,
      title: "Relatório da equipe",
      subtitle: `${formatDateBR(from)} a ${formatDateBR(to)}`,
      sections: [
        {
          heading: "Detalhamento por dia",
          columns: ["Funcionário", "Data", "Período", "Entrada", "Saída", "Atraso", "Tipo", "Alimentação", "Transporte", "Consumo", "Valor do dia"],
          rows: detalhes.map((r) => [
            r.nome, formatDateBR(r.data), r.periodo, r.entrada, r.saida, `${r.atraso}min`, r.tipo,
            `R$${r.alimentacao.toFixed(2)}`, `R$${r.transporte.toFixed(2)}`, `R$${r.consumo.toFixed(2)}`, `R$${r.valorDia.toFixed(2)}`,
          ]),
          totalRow: ["TOTAL", "", "", "", "", "", "", `R$${totalDetalhes.alimentacao.toFixed(2)}`, `R$${totalDetalhes.transporte.toFixed(2)}`, `R$${totalDetalhes.consumo.toFixed(2)}`, `R$${totalDetalhes.valorDia.toFixed(2)}`],
        },
        {
          heading: "Resumo de pagamento por funcionário",
          columns: ["Funcionário", "Tipo", "Dias", "Horas", "Bruto", "Transp.", "Alim.", "Consumo", "Desc.", "Adic.", "Valor a receber"],
          rows: resumo.map((r) => [
            r.f.nome, r.tipo, String(r.diasTrabalhados), r.horas.toFixed(2), `R$${r.bruto.toFixed(2)}`,
            `R$${r.transp.toFixed(2)}`, `R$${r.ref.toFixed(2)}`, `R$${r.consumo.toFixed(2)}`,
            `R$${r.desconto.toFixed(2)}`, `R$${r.adicional.toFixed(2)}`, `R$${r.liquido.toFixed(2)}`,
          ]),
          totalRow: ["TOTAL DO PERÍODO", "", "", totalResumo.horas.toFixed(2), `R$${totalResumo.bruto.toFixed(2)}`,
            `R$${totalResumo.transp.toFixed(2)}`, `R$${totalResumo.ref.toFixed(2)}`, `R$${totalResumo.consumo.toFixed(2)}`,
            `R$${totalResumo.desconto.toFixed(2)}`, `R$${totalResumo.adicional.toFixed(2)}`, `R$${totalResumo.liquido.toFixed(2)}`],
        },
      ],
    });
  };

  const baixarCsvArquivo = () => {
    if (semDados) { alert("Nenhum registro de ponto no período selecionado."); return; }
    const linhas: (string | number)[][] = [];
    linhas.push(["DETALHAMENTO POR DIA"]);
    linhas.push(["Funcionário", "Data", "Período", "Entrada", "Saída", "Atraso (min)", "Tipo", "Alimentação (R$)", "Transporte (R$)", "Consumo (R$)", "Valor do dia (R$)"]);
    for (const r of detalhes) {
      linhas.push([r.nome, formatDateBR(r.data), r.periodo, r.entrada, r.saida, r.atraso, r.tipo, r.alimentacao.toFixed(2), r.transporte.toFixed(2), r.consumo.toFixed(2), r.valorDia.toFixed(2)]);
    }
    linhas.push(["TOTAL", "", "", "", "", "", "", totalDetalhes.alimentacao.toFixed(2), totalDetalhes.transporte.toFixed(2), totalDetalhes.consumo.toFixed(2), totalDetalhes.valorDia.toFixed(2)]);
    linhas.push([]);
    linhas.push(["RESUMO DE PAGAMENTO POR FUNCIONÁRIO"]);
    linhas.push(["Funcionário", "Tipo", "Dias", "Horas", "Bruto (R$)", "Transporte (R$)", "Alimentação (R$)", "Consumo (R$)", "Desconto (R$)", "Adicional (R$)", "Valor a receber (R$)"]);
    for (const r of resumo) {
      linhas.push([r.f.nome, r.tipo, r.diasTrabalhados, r.horas.toFixed(2), r.bruto.toFixed(2), r.transp.toFixed(2), r.ref.toFixed(2), r.consumo.toFixed(2), r.desconto.toFixed(2), r.adicional.toFixed(2), r.liquido.toFixed(2)]);
    }
    linhas.push(["TOTAL DO PERÍODO", "", "", totalResumo.horas.toFixed(2), totalResumo.bruto.toFixed(2), totalResumo.transp.toFixed(2), totalResumo.ref.toFixed(2), totalResumo.consumo.toFixed(2), totalResumo.desconto.toFixed(2), totalResumo.adicional.toFixed(2), totalResumo.liquido.toFixed(2)]);
    baixarCsv(`relatorio-equipe-${from}-a-${to}.csv`, [], linhas);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[480px] max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Relatório da equipe</DialogTitle></DialogHeader>
        <div className="space-y-3">
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
          <p className="text-[11px] text-muted-foreground">
            Detalhamento dia a dia (data, período, entrada/saída, atraso, tipo de pagamento, alimentação,
            transporte, consumo) + resumo de pagamento por funcionário (bruto, desconto, adicional e valor a
            receber), com totais do período. Ordenado por data e nome. "Atraso" e "Período" são estimados a
            partir do horário de entrada (Manhã 08:00, Tarde 14:00, Noite 18:00).
          </p>
          {resumo.length > 0 && (
            <div className="bg-card border border-primary/40 rounded-lg p-3 text-sm space-y-1">
              <div className="font-semibold mb-1">Resumo rápido</div>
              {resumo.map((r) => (
                <div key={r.f.id} className="flex justify-between text-xs">
                  <span>{r.f.nome} <span className="text-muted-foreground">({r.tipo})</span></span>
                  <span className="mono">{BRL(r.liquido)}</span>
                </div>
              ))}
              <div className="flex justify-between text-sm font-semibold border-t border-border pt-1 mt-1">
                <span>Total do período</span>
                <span className="mono text-primary">{BRL(totalResumo.liquido)}</span>
              </div>
            </div>
          )}
          <Button onClick={baixar} className="w-full">📊 Baixar Excel (.xlsx)</Button>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" onClick={baixarPdfArquivo}>📄 PDF</Button>
            <Button variant="secondary" onClick={baixarCsvArquivo}>📊 CSV</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

