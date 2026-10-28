import { useEffect } from "react";

// Confere se saiu uma versão nova do app e recarrega a página para usá-la. Os lançamentos que ainda
// não foram enviados estão guardados no aparelho (fila) e continuam depois de recarregar.
const CHAVE = "barraca_recarregou_para";

async function conferirVersao() {
  try {
    const r = await fetch("/versao.json", { cache: "no-store" });
    if (!r.ok) return;
    const { versao } = (await r.json()) as { versao?: string };
    if (!versao || versao === __APP_VERSION__) return;
    // Evita recarregar sem parar se algum cache ainda entregar a versão antiga
    let jaTentou = false;
    try { jaTentou = sessionStorage.getItem(CHAVE) === versao; sessionStorage.setItem(CHAVE, versao); } catch { /* sem storage */ }
    if (!jaTentou) window.location.reload();
  } catch { /* sem internet: tenta depois */ }
}

export function useRecarregarSeNovaVersao() {
  useEffect(() => {
    void conferirVersao();
    const onVis = () => { if (document.visibilityState === "visible") void conferirVersao(); };
    document.addEventListener("visibilitychange", onVis);
    const timer = setInterval(conferirVersao, 5 * 60 * 1000);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", onVis); };
  }, []);
}
