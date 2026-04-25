/**
 * Script d'envoi SMS via L'AfricaMobile à tous les actionnaires
 * Usage : node scripts/sendPromoActionnaires.js
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const mongoose = require('mongoose');
const axios = require('axios');

// ── Config ──────────────────────────────────────────────────────────────────
const LAM_ACCOUNT_ID = process.env.LAM_ACCOUNT_ID;
const LAM_PASSWORD   = process.env.LAM_PASSWORD;
const MONGODB_URI    = process.env.MONGODB_URI;

// Délai entre chaque SMS (ms) — évite le rate limit
const DELAI_MS = 500;

// ── Message à envoyer ────────────────────────────────────────────────────────
const MESSAGE = `Chers actionnaires,
La promo continue jusqu'au 25 Avril
1 action = 1 000 FCFA
Profitez-en vite !
Équipe Dioko`;

// ── Modèle User minimal ──────────────────────────────────────────────────────
const userSchema = new mongoose.Schema({
  firstName:  String,
  lastName:   String,
  telephone:  String,
  role:       String,
  status:     String,
  isBlocked:  Boolean,
});
const User = mongoose.model('User', userSchema);

// ── Formater le numéro sénégalais pour L'AfricaMobile ───────────────────────
// Retourne null si le numéro n'est pas sénégalais
const formatPhone = (tel) => {
  if (!tel) return null;
  const clean = tel.replace(/[\s\-\(\)\.]/g, '');

  // Numéro local : 7XXXXXXXX (9 chiffres commençant par 7)
  if (/^7[0-9]{8}$/.test(clean)) return `+221${clean}`;

  // Avec indicatif sans + : 2217XXXXXXXX
  if (/^2217[0-9]{8}$/.test(clean)) return `+${clean}`;

  // Avec indicatif complet : +2217XXXXXXXX
  if (/^\+2217[0-9]{8}$/.test(clean)) return clean;

  // Pas sénégalais → on ignore
  return null;
};

// ── Envoi SMS via L'AfricaMobile ─────────────────────────────────────────────
const envoyerSMS = async (telephone, message) => {
  const to = formatPhone(telephone);
  if (!to) throw new Error('Numéro invalide');

  const payload = {
    accountid: LAM_ACCOUNT_ID,
    password:  LAM_PASSWORD,
    sender:    'Dioko Group',
    ret_id:    `dioko_${Date.now()}`,
    priority:  '2',
    text:      message,
    to: [{ ret_id_1: to }],
  };

  const response = await axios.post(
    'https://lamsms.lafricamobile.com/api',
    payload,
    { headers: { 'Content-Type': 'application/json' }, timeout: 10000 }
  );

  return response.data;
};

// ── Pause ────────────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// ── Script principal ─────────────────────────────────────────────────────────
const main = async () => {
  if (!LAM_ACCOUNT_ID || !LAM_PASSWORD) {
    console.error('❌ LAM_ACCOUNT_ID ou LAM_PASSWORD manquant dans .env');
    process.exit(1);
  }

  console.log('🔌 Connexion à MongoDB...');
  await mongoose.connect(MONGODB_URI);
  console.log('✅ Connecté\n');

  // Récupérer tous les actionnaires actifs
  const actionnaires = await User.find({
    role:      'actionnaire',
    status:    'active',
    isBlocked: { $ne: true },
    telephone: { $exists: true, $ne: null },
  }).select('firstName lastName telephone');

  console.log(`📋 ${actionnaires.length} actionnaires trouvés\n`);
  console.log(`📩 Message :\n${MESSAGE}\n`);
  console.log('─'.repeat(50));

  let succes = 0;
  let echecs = 0;

  for (let i = 0; i < actionnaires.length; i++) {
    const a = actionnaires[i];
    const nom = `${a.firstName} ${a.lastName}`;

    try {
      await envoyerSMS(a.telephone, MESSAGE);
      succes++;
      console.log(`✅ [${i + 1}/${actionnaires.length}] ${nom} — ${a.telephone}`);
    } catch (error) {
      echecs++;
      console.error(`❌ [${i + 1}/${actionnaires.length}] ${nom} — ${a.telephone} : ${error.message}`);
    }

    // Pause entre chaque envoi
    if (i < actionnaires.length - 1) {
      await sleep(DELAI_MS);
    }
  }

  console.log('\n' + '─'.repeat(50));
  console.log(`📊 Résultat final :`);
  console.log(`   ✅ Envoyés  : ${succes}`);
  console.log(`   ❌ Échoués  : ${echecs}`);
  console.log(`   📋 Total    : ${actionnaires.length}`);

  await mongoose.disconnect();
  console.log('\n🔌 Déconnecté de MongoDB');
};

main().catch((err) => {
  console.error('❌ Erreur fatale :', err.message);
  mongoose.disconnect();
  process.exit(1);
});
