import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { useStore, normalizarUsuario, buscarTurnoAberto, type User } from "@/lib/store";
import { formatDateBR, shiftLabel } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/")({
  component: LoginPage,
});

function LoginPage() {
  const { state, dispatch } = useStore();
  const nav = useNavigate();
  const [u, setU] = useState("");
  const [p, setP] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => {
    if (state.currentUser) {
      nav({ to: state.currentUser.role === "owner" ? "/owner" : "/turno" });
    }
  }, [state.currentUser, nav]);

  const [entrando, setEntrando] = useState(false);

  const entrar = async (user: User, ativo: boolean) => {
    if (!ativo) {
      setErr("Acesso desativado. Fale com o administrador.");
      return;
    }
    // Turno aberto por outro funcionário: só quem abriu e o administrador entram até ele ser fechado
    if (user.role !== "owner") {
      const noBanco = await buscarTurnoAberto();
      const aberto = noBanco === undefined ? state.turnoAtivo : noBanco; // sem internet: usa o deste aparelho
      if (aberto && normalizarUsuario(aberto.employee) !== normalizarUsuario(user.username)) {
        const nome = state.funcionarios.find((f) => normalizarUsuario(f.username) === normalizarUsuario(aberto.employee))?.nome ?? aberto.employee;
        setErr(`Acesso bloqueado: o turno ${shiftLabel(aberto.shift)} de ${formatDateBR(aberto.date)} está aberto por ${nome}. ` +
          `Enquanto ele estiver aberto, só ${nome} e o administrador podem entrar.`);
        return;
      }
    }
    // "role" vem do cadastro em Equipe: administrador cadastrado ali também entra no Painel
    dispatch({ type: "LOGIN", user });
    nav({ to: user.role === "owner" ? "/owner" : "/turno" });
  };

  // Login antigo (só enquanto o seguranca_login.sql não foi rodado no Supabase): confere aqui no aparelho.
  // Depois do SQL, a senha do dono deixa de ser esta e as senhas não chegam mais ao app.
  const entrarModoAntigo = async () => {
    if (u.trim().toLowerCase() === "dono" && p === "barracaterminal") {
      return entrar({ role: "owner", username: "dono", nome: "Dono" }, true);
    }
    const f = state.funcionarios.find((x) => normalizarUsuario(x.username) === normalizarUsuario(u) && x.password === p);
    if (f) return entrar({ role: f.role, username: f.username, nome: f.nome }, f.ativo !== false);
    setErr("Usuário ou senha inválidos");
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr("");
    if (!u.trim() || !p) { setErr("Preencha usuário e senha"); return; }
    setEntrando(true);
    try {
      // A senha é conferida no banco (função verificar_login); o app nunca vê as senhas
      const { data, error } = await supabase.rpc("verificar_login", { p_usuario: u, p_senha: p });
      if (error) {
        // Função ainda não criada no banco → usa o login antigo
        if (error.code === "PGRST202" || error.code === "42883") return await entrarModoAntigo();
        setErr("Sem conexão com o servidor. Verifique a internet e tente de novo.");
        return;
      }
      if (!data) { setErr("Usuário ou senha inválidos"); return; }
      const r = data as { role: string; username: string; nome: string; ativo?: boolean };
      await entrar({ role: r.role === "owner" ? "owner" : "employee", username: r.username, nome: r.nome }, r.ativo !== false);
    } catch {
      setErr("Sem conexão com o servidor. Verifique a internet e tente de novo.");
    } finally {
      setEntrando(false);
    }
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm bg-card border border-border rounded-2xl p-6 shadow-xl">
        <div className="text-center mb-6">
          <div className="text-5xl mb-2">🥟</div>
          <h1 className="text-2xl font-bold tracking-tight">Barraca Terminal</h1>
          <p className="text-sm text-muted-foreground">Controle de vendas</p>
          <p className="text-[11px] text-muted-foreground mt-1">Versão {__APP_VERSION__.split(".")[0]}</p>
        </div>
        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="text-xs text-muted-foreground">Usuário</label>
            <Input value={u} onChange={(e) => setU(e.target.value)} autoFocus autoCapitalize="none" />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Senha</label>
            <Input type="password" value={p} onChange={(e) => setP(e.target.value)} />
          </div>
          {err && <p className="text-sm text-destructive">{err}</p>}
          <Button type="submit" className="w-full" disabled={entrando}>{entrando ? "Entrando..." : "Entrar"}</Button>
        </form>
      </div>
    </div>
  );
}
