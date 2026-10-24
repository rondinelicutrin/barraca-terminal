// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { readFileSync } from "node:fs";

// Versão do app (package.json), mostrada na tela de login para conferir qual versão está no ar
const versao = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")).version as string;

// Publicação na Cloudflare: nome fixo do site. Sem isso o nome vinha da pasta (barraca_v31, v32...) e
// cada versão viraria um site novo, com outro endereço. ("wrangler" é repassado ao nitro, que o aceita,
// embora o tipo do @lovable.dev/vite-tanstack-config não o declare — por isso vai numa variável.)
const cloudflare = { deployConfig: true, nodeCompat: true, wrangler: { name: "barraca-terminal" } };

export default defineConfig({
  nitro: { cloudflare },
  vite: { define: { __APP_VERSION__: JSON.stringify(versao) } },
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
});
