# EconoApp Web

Web app responsivo/PWA do EconoApp. Ele usa a mesma API NestJS do backend e foi pensado para ser empacotado como APK depois com Capacitor ou TWA.

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

## Observacao sobre Pessoal x Negocio

Nesta primeira versao web, a separacao entre `Pessoal` e `Negocio` e salva localmente no navegador para validar a experiencia. O proximo passo tecnico e persistir isso no backend, adicionando um campo de escopo nas transacoes ou uma entidade de contas/carteiras.
