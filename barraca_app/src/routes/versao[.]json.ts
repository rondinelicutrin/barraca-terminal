import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";

// Versão publicada do app. O aparelho compara com a versão que está rodando e, se o site foi
// atualizado, recarrega sozinho (no celular a aba fica aberta por dias com a versão antiga).
export const Route = createFileRoute("/versao.json")({
  server: {
    handlers: {
      GET: async () =>
        new Response(JSON.stringify({ versao: __APP_VERSION__ }), {
          headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
        }),
    },
  },
});
