# EconoApp Web

Web app responsivo/PWA do EconoApp. Ele usa a mesma API NestJS do backend e foi pensado para ser empacotado como APK depois com Capacitor ou TWA.

O servidor web tambem faz proxy de `/api/v1/*` para a API local em `http://localhost:3001`. Assim, para testar por tunel publico, basta expor a porta `5173`.

## Rodar localmente

```powershell
cd "C:\Users\Acer\Documents\New project\econoapp"
node web/server.js
```

Acesse:

```text
http://localhost:5173
```

No celular, use o IP da maquina:

```text
http://192.168.15.12:5173
```

## Túnel publico temporario

Exponha apenas o web server:

```powershell
cloudflared tunnel --url http://localhost:5173
```

Ou ferramenta equivalente. O app usara `/api/v1` no mesmo dominio publico.
