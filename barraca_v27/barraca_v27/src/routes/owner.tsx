import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useStore } from "@/lib/store";

export const Route = createFileRoute("/owner")({
  component: OwnerLayout,
});

function OwnerLayout() {
  const { state } = useStore();
  const nav = useNavigate();
  useEffect(() => {
    if (!state.hidratado) return; // espera ler o login salvo (F5 não desloga)
    if (!state.currentUser) nav({ to: "/" });
    else if (state.currentUser.role !== "owner") nav({ to: "/turno" });
  }, [state.hidratado, state.currentUser, nav]);
  if (state.currentUser?.role !== "owner") return null;
  return <Outlet />;
}
