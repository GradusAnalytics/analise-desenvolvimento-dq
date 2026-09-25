# Proxy da aba Insights IA

A página é pública (GitHub Pages), então a chave da API Anthropic não pode ficar no HTML. A aba **Insights IA** chama esta Lambda, e ela injeta a chave e repassa para `api.anthropic.com`.

| Recurso (conta AWS Analytics 381491825479, us-east-1) | Nome |
|---|---|
| Segredo com a chave | Secrets Manager `gradus/analise-desenvolvimento/anthropic-api-key` (texto puro `sk-ant-...`) |
| Função | Lambda `gradus-analise-ia-proxy` (Node.js 22, arm64, timeout 600 s, concorrência reservada 10) |
| Endpoint | Function URL `https://kfajcfoc4dowtzo5y3phgizeky0gojqt.lambda-url.us-east-1.on.aws` (auth NONE, streaming) |
| Permissões | Role `gradus-analise-ia-proxy-role`: logs + `GetSecretValue` só neste segredo |
| Logs | `/aws/lambda/gradus-analise-ia-proxy` (30 dias; sem conteúdo das mensagens) |

## Travas

- Origem: só `https://gradusanalytics.github.io` (CORS da Function URL e checagem no código).
- Rota: só `POST /v1/messages`.
- Modelo: só `claude-opus-5-5` (variável `ALLOWED_MODELS`).
- `max_tokens` até 32.000, sem ferramentas (`tools`, `mcp_servers` e `container` são recusados).

A URL é pública e a checagem de origem não impede chamadas feitas fora do navegador. Mantenha um limite de gasto no workspace da Anthropic dono da chave.

## Trocar a chave

Console AWS › Secrets Manager › `gradus/analise-desenvolvimento/anthropic-api-key` › *Retrieve secret value* › *Edit*, colar a chave e salvar. Vale em até 5 minutos, sem redeploy.

## Atualizar o código

```bash
cd proxy-ia && zip ../proxy.zip index.mjs
aws lambda update-function-code --profile analytics --function-name gradus-analise-ia-proxy --zip-file fileb://../proxy.zip
```
