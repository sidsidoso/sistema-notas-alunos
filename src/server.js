// Ponto de entrada: lê a configuração do ambiente e sobe o servidor HTTP.
import { abrirBanco } from './db.js';
import { criarApp } from './app.js';

// Carrega .env se existir (process.loadEnvFile existe desde o Node 20.12).
try { process.loadEnvFile?.(); } catch { /* sem .env: usa variáveis do ambiente */ }

const porta = Number(process.env.PORTA ?? 3000);
const caminhoBanco = process.env.BANCO ?? 'notas.db';

const db = abrirBanco(caminhoBanco);
let app;
try {
  app = criarApp({ db, segredoJwt: process.env.JWT_SEGREDO });
} catch (e) {
  console.error(`Configuração inválida: ${e.message} (veja .env.example)`);
  process.exit(1);
}

const servidor = app.listen(porta, () => {
  console.log(`API de notas ouvindo em http://localhost:${servidor.address().port} (banco: ${caminhoBanco})`);
});

// Encerramento gracioso: termina as requisições em andamento e fecha o banco.
for (const sinal of ['SIGINT', 'SIGTERM']) {
  process.on(sinal, () => {
    servidor.close(() => {
      db.close();
      process.exit(0);
    });
  });
}
