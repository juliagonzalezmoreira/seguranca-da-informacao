require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const { sendEmail } = require('./notifications');
const User = require('./models/User');
const Incident = require('./models/Incident');
const { runBackup, restoreLatestBackup } = require('./backup');

const app = express();
app.use(express.json());

// Middleware de detecção de NoSQL injection
function payloadSuspeito(obj) {
  return Object.keys(obj).some(key => key.startsWith('$') || (typeof obj[key]==='object' && payloadSuspeito(obj[key])));
}
app.use((req, res, next) => {
  if (payloadSuspeito(req.body)) {
    handleIncident('Tentativa de Injeção NoSQL detectada').catch(console.error);
    return res.status(400).json({ error: 'Atividade maliciosa detectada.' });
  }
  next();
});

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('✅ MongoDB conectado'))
  .catch(console.error);

async function handleIncident(description) {
  // 1. Registrar incidente
  const incident = new Incident({ description });
  await incident.save();

  // 2. Notificar usuários
  const users = await User.find();
  for (const u of users) {
    await sendEmail(u.email, '🚨 Incidente de Segurança', `Olá ${u.name}, detectamos: ${description}`);
    incident.notifications.push({ userId: u._id, email: u.email, sentAt: new Date() });
  }
  await incident.save();

  // 3. Restaurar o último backup
  try {
    const { restoredDir } = await restoreLatestBackup();
    console.log('✅ Restaurado backup:', restoredDir);
  } catch (err) {
    console.error('❌ Erro ao restaurar backup:', err);
  }

  // 4. Criar backup pós-incidente
  try {
    const { backupDir } = await runBackup();
    console.log('✅ Backup pós-incidente concluído em:', backupDir);
  } catch (err) {
    console.error('❌ Erro ao criar backup:', err);
  }
}

// Rota para disparar incidente manual
app.post('/incident', async (req, res) => {
  const { description='Incidente manual'} = req.body;
  try {
    await handleIncident(description);
    res.status(200).json({ message: 'Incidente tratado: restauração e backup executados.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server rodando na porta ${PORT}`));
