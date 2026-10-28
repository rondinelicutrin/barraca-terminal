import { useEffect } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { AvisoEnvio } from "@/components/AvisoEnvio";
import { useStore, normalizarUsuario, type State } from "@/lib/store";
import { formatDateBR, shiftLabel } from "@/lib/format";
import { Home, ClipboardList, Package, LogOut, LayoutDashboard, Users, BarChart3, LineChart } from "lucide-react";

export function BottomNav() {
  const { state, dispatch } = useStore();
  const nav = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isOwner = state.currentUser?.role === "owner";

  // Se o administrador desativar esta pessoa enquanto ela está usando o app, ela é desconectada.
  const desativado = state.funcionarios.some((f) => f.username === state.currentUser?.username && f.ativo === false);
  useEffect(() => {
    if (desativado) { dispatch({ type: "LOGOUT" }); nav({ to: "/" }); }
  }, [desativado, dispatch, nav]);

  if (!state.currentUser) return null;

  const items = isOwner
    ? [
        { to: "/owner", label: "Painel", icon: LayoutDashboard },
        { to: "/owner/gestao", label: "Gestão", icon: LineChart },
        { to: "/owner/historico", label: "Histórico", icon: BarChart3 },
        { to: "/owner/funcionarios", label: "Equipe", icon: Users },
        { to: "/owner/produtos", label: "Produtos", icon: Package },
      ]
    : [
        { to: "/turno", label: "Turno", icon: Home },
        { to: "/ponto", label: "Ponto", icon: ClipboardList },
      ];

  return (
    <nav className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[520px] bg-card/95 backdrop-blur border-t border-border z-40 safe-bottom">
      <div className="flex items-center justify-around px-2 py-1.5">
        {items.map((it) => {
          const active = pathname === it.to || (it.to !== "/owner" && pathname.startsWith(it.to));
          const Icon = it.icon;
          return (
            <Link
              key={it.to}
              to={it.to}
              className={`flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-md text-[11px] ${active ? "text-primary" : "text-muted-foreground"}`}
            >
              <Icon className="w-5 h-5" />
              <span>{it.label}</span>
            </Link>
          );
        })}
        <button
          onClick={() => { dispatch({ type: "LOGOUT" }); nav({ to: "/" }); }}
          className="flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-md text-[11px] text-muted-foreground"
        >
          <LogOut className="w-5 h-5" />
          <span>Sair</span>
        </button>
      </div>
    </nav>
  );
}

export function TopBar({ title, right }: { title: string; right?: React.ReactNode }) {
  return (
    <header className="sticky top-0 z-30 bg-background/95 backdrop-blur border-b border-border">
      {/* No celular, se os links não couberem ao lado do título, eles descem para a linha de baixo */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 px-4 min-h-14 py-1">
        <div className="flex items-center gap-2 shrink-0 min-h-12">
          <span className="text-primary text-xl">🥟</span>
          <h1 className="font-semibold tracking-tight whitespace-nowrap">{title}</h1>
        </div>
        {right}
      </div>
      <AvisoEnvio />
    </header>
  );
}

export function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen w-full flex justify-center bg-background">
      <div className="w-full max-w-[520px] pb-[calc(5rem+env(safe-area-inset-bottom))] min-h-screen relative">{children}</div>
    </div>
  );
}

// Enquanto um turno está aberto, só quem o abriu (e o dono/administradores, que usam o Painel) pode usar
// as telas de Turno e Ponto. Evita que outro funcionário entre no turno da pessoa pelo celular dele e
// altere valores ou apague lançamentos dela.
export function turnoDeOutroFuncionario(state: State) {
  const t = state.turnoAtivo;
  const me = state.currentUser;
  if (!t || !me || me.role === "owner") return null;
  return normalizarUsuario(t.employee) === normalizarUsuario(me.username) ? null : t;
}

export function TurnoBloqueado() {
  const { state, dispatch } = useStore();
  const nav = useNavigate();
  const t = turnoDeOutroFuncionario(state);
  if (!t) return null;
  const nome = state.funcionarios.find((f) => normalizarUsuario(f.username) === normalizarUsuario(t.employee))?.nome ?? t.employee;
  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="max-w-sm w-full bg-card border border-destructive/50 rounded-2xl p-6 text-center space-y-3">
        <div className="text-4xl">🔒</div>
        <h1 className="text-lg font-semibold">Acesso bloqueado</h1>
        <p className="text-sm text-muted-foreground">
          O turno {shiftLabel(t.shift)} de {formatDateBR(t.date)} está aberto por <span className="text-foreground font-medium">{nome}</span>.
          Enquanto ele estiver aberto, só {nome} e o administrador podem usar o app.
        </p>
        <button type="button" className="w-full h-11 rounded-md bg-primary text-primary-foreground font-medium"
          onClick={() => { dispatch({ type: "LOGOUT" }); nav({ to: "/" }); }}>
          Sair
        </button>
      </div>
    </div>
  );
}
