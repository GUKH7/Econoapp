# 🚀 EconoApp

![NestJS](https://img.shields.io/badge/nestjs-%23E0234E.svg?style=for-the-badge&logo=nestjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/typescript-%23007ACC.svg?style=for-the-badge&logo=typescript&logoColor=white)
![Google Gemini](https://img.shields.io/badge/Google%20Gemini-8E75B2?style=for-the-badge&logo=google&logoColor=white)
![Prisma](https://img.shields.io/badge/Prisma-3982CE?style=for-the-badge&logo=Prisma&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-316192?style=for-the-badge&logo=postgresql&logoColor=white)
![Docker](https://img.shields.io/badge/docker-%232496ED.svg?style=for-the-badge&logo=docker&logoColor=white)

O **EconoApp** é uma solução inteligente de gestão financeira pessoal e empresarial, permitindo que usuários registrem e acompanhem suas finanças diretamente através do **Telegram**.

Utilizando Inteligência Artificial avançada (Google Gemini), o sistema é capaz de entender mensagens de voz e texto em linguagem natural para extrair dados financeiros automaticamente.

---

## ✨ Funcionalidades Principais

-   🤖 **IA com Google Gemini:** Extração automática de valor, descrição, produto e canal de vendas a partir de mensagens naturais.
-   📱 **Exclusivo Telegram:** Integração completa e otimizada com bot do Telegram.
-   💹 **Gestão de Canais de Venda:** Configuração de taxas de comissão por canal (ex: Shopee, Mercado Livre) com cálculo automático de valor líquido.
-   📊 **Relatórios Visuais:** Geração de gráficos de pizza e resumos detalhados de entradas, saídas e categorias.
-   📂 **Categorização Dinâmica:** Criação automática de categorias com cores persistentes para melhor visualização.
-   ⚙️ **Configurações via Bot:** Edição de perfil, gestão de canais e taxas diretamente pelo chat.

---

## 🛠️ Tecnologias Utilizadas

-   **Framework:** [NestJS](https://nestjs.com/)
-   **Linguagem:** TypeScript
-   **ORM:** [Prisma](https://www.prisma.io/)
-   **IA:** [Google Gemini (AI)](https://ai.google.dev/)
-   **Banco de Dados:** [PostgreSQL](https://www.postgresql.org/)
-   **Gráficos:** Chart.js (via `chartjs-node-canvas`)
-   **Documentação da API:** [Swagger](https://swagger.io/) & [Scalar](https://scalar.com/)
-   **Segurança:** JWT, Bcrypt & Helmet
-   **Logs:** [Pino](https://getpino.io/)
-   **Testes:** [Vitest](https://vitest.dev/)
-   **Validação:** [Zod](https://zod.dev/) & [Class-validator](https://github.com/typestack/class-validator)

---

## 📁 Estrutura do Projeto

```text
src/
├── common/         # Filtros, Pipes e Decorators compartilhados
├── config/         # Configurações de variáveis de ambiente e App
├── domain/         # Regras de negócio e lógica de domínio (finance)
├── modules/        # Módulos do NestJS (Telegram, Auth, etc.)
│   ├── auth/       # Autenticação e Gestão de Usuários
│   ├── categories/ # Gestão de Categorias e Cores
│   ├── channels/   # Gestão de Canais de Venda e Taxas
│   ├── dashboard/  # Lógica de relatórios e gráficos
│   ├── health/     # Monitoramento e integridade do sistema
│   ├── telegram/   # Bot Telegram: Scenes, Keyboards e Handlers
│   └── transactions/# Registro e gestão de movimentações financeiras
├── services/       # Integrações externas (AI/Gemini)
├── utils/          # Funções utilitárias e ajudantes
└── main.ts         # Inicialização do servidor NestJS
```

---

## 🚀 Como Executar

### Pré-requisitos
- Node.js (v18 ou superior)
- Docker (opcional para o banco de dados)
- Uma chave de API do Google Gemini
- Token de Bot do Telegram (via BotFather)

### Instalação

1.  Clone o repositório:
    ```bash
    git clone https://github.com/devhenrico/econoapp.git
    cd econoapp
    ```

2.  Instale as dependências:
    ```bash
    npm install
    ```

3.  Configure as variáveis de ambiente:
    Crie um arquivo `.env` na raiz baseado no `.env.example`.

4.  Configure o banco de dados:
    ```bash
    npx prisma migrate dev
    npx prisma generate
    ```

5.  Inicie o servidor de desenvolvimento:
    ```bash
    npm run dev
    ```

### Docker

Para subir o ambiente completo (PostgreSQL + backend) com Docker:

```bash
docker compose up -d
```

Para rodar as migrations dentro do container:

```bash
docker exec econoapp-backend npx prisma migrate dev
```

---

## 📋 Comandos do Bot

-   `/start` - Inicia o bot e apresenta o menu principal.
-   `/saldo` - Exibe o saldo líquido acumulado no mês.
-   `/resumo` - Gera um relatório visual com gráfico de categorias.
-   `/canais` - Gerencia canais de venda e suas respectivas taxas.
-   `/configuracoes` - Atalho para edição de perfil e preferências.
-   `/ajuda` - Lista todos os comandos disponíveis.

---

## 🧪 Testes

O projeto utiliza **Vitest** para testes unitários e de integração.

```bash
# Rodar todos os testes
npm run test

# Modo watch
npm run test:watch

# Cobertura
npm run test:coverage
```

---

## 📄 Licença

Este projeto está sob a licença MIT. Consulte o arquivo [LICENSE](LICENSE) para mais detalhes.
