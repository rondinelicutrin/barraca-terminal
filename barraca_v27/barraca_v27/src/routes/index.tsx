import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { useStore } from "@/lib/store";
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

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setErr("");
    // Login mestre — sempre funciona, mesmo se o Supabase estiver fora do ar
    if (u === "dono" && p === "barracaterminal") {
      dispatch({ type: "LOGIN", user: { role: "owner", username: "dono", nome: "Dono" } });
      nav({ to: "/owner" });
      return;
    }
    const f = state.funcionarios.find((x) => x.username === u && x.password === p);
    if (f && f.ativo === false) {
      setErr("Acesso desativado. Fale com o administrador.");
      return;
    }
    if (f) {
      // "role" vem do cadastro em Equipe: administrador cadastrado ali também entra no Painel
      dispatch({ type: "LOGIN", user: { role: f.role, username: f.username, nome: f.nome } });
      nav({ to: f.role === "owner" ? "/owner" : "/turno" });
      return;
    }
    setErr("Usuário ou senha inválidos");
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm bg-card border border-border rounded-2xl p-6 shadow-xl">
        <div className="text-center mb-6">
          <div className="text-5xl mb-2">🥟</div>
          <h1 className="text-2xl font-bold tracking-tight">Barraca Terminal</h1>
          <p className="text-sm text-muted-foreground">Controle de vendas</p>
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
          <Button type="submit" className="w-full">Entrar</Button>
        </form>
      </div>
    </div>
  );
}
