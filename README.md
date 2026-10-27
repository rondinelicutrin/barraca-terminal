# Barraca Terminal

App de controle de vendas da barraca: turnos, caixa, maquininhas, ponto, consumo dos funcionários,
folha semanal e relatórios.

- **App no ar:** https://barraca-terminal.rvvm.workers.dev
- **Código:** pasta [`barraca_app`](barraca_app) (o nome da pasta é fixo; a versão fica no
  `barraca_app/package.json` e aparece na tela de login).

## Publicação

A Cloudflare publica sozinha a cada merge no `main`. Configuração do projeto `barraca-terminal`
(Workers & Pages → Settings → Build):

| Campo | Valor |
|---|---|
| Diretório raiz | `/barraca_app` |
| Comando de build | `npm install && npm run build` |
| Comando de implantação | `npx wrangler deploy --config .output/server/wrangler.json` |
| Variáveis de build | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `NODE_VERSION=22` |

## Rodar no computador

```sh
cd barraca_app
cp .env.example .env   # preencha com os dados do Supabase
npm install
npm run dev
```

## Banco (Supabase)

Os arquivos `.sql` em `barraca_app/` são rodados uma vez no SQL Editor do Supabase quando uma versão
pede (cada PR diz qual).
