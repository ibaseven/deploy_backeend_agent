/**
 * Script : envoyer-contrat.js
 *
 * Usage :
 *   node scripts/envoyer-contrat.js                            → numéro par défaut, actions depuis la BDD
 *   node scripts/envoyer-contrat.js +221XXXXXXXXX              → numéro personnalisé, actions depuis la BDD
 *   node scripts/envoyer-contrat.js +221XXXXXXXXX 500          → numéro + 500 actions forcées
 *
 * Ce que fait le script :
 *  1. Cherche l'actionnaire par son numéro de téléphone en base
 *  2. Génère son contrat PDF (prix : 2 000 FCFA/action)
 *  3. Upload le PDF sur S3
 *  4. Envoie le PDF par WhatsApp via UltraMsg
 */

require('dotenv').config();

const mongoose = require('mongoose');
const AWS      = require('aws-sdk');
const axios    = require('axios');
const qs       = require('qs');

const connectDB               = require('../Config/db');
const User                    = require('../Models/User');
const { generateContractPDF } = require('../Services/contractGenerator');

// ─── Arguments ────────────────────────────────────────────────────────────────
const TELEPHONE_CIBLE   = process.argv[2] || '+221775968426';
const ACTIONS_FORCEES   = process.argv[3] ? parseInt(process.argv[3], 10) : null; // optionnel
const PRIX_PAR_ACTION   = 1000; // FCFA

// ─── AWS S3 ───────────────────────────────────────────────────────────────────
const s3 = new AWS.S3({
  accessKeyId:     process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region:          process.env.AWS_REGION,
});

async function uploadPDFToS3(pdfBuffer, fileName) {
  const s3Key = `contrats/${fileName}`;
  await s3.putObject({
    Bucket:      process.env.AWS_BUCKET_NAME,
    Key:         s3Key,
    Body:        pdfBuffer,
    ContentType: 'application/pdf',
  }).promise();
  return `https://${process.env.AWS_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${s3Key}`;
}

// ─── WhatsApp ─────────────────────────────────────────────────────────────────
async function sendPDFWhatsApp(telephone, pdfUrl, fileName, caption) {
  const INSTANCE_ID = process.env.ULTRAMSG_INSTANCE_ID;
  const TOKEN       = process.env.ULTRAMSG_TOKEN;

  if (!INSTANCE_ID || !TOKEN) {
    console.warn('⚠️  ULTRAMSG_INSTANCE_ID ou ULTRAMSG_TOKEN manquant — envoi WhatsApp ignoré.');
    return;
  }

  const tel  = telephone.replace(/\D/g, '');
  const data = qs.stringify({ token: TOKEN, to: tel, filename: fileName, document: pdfUrl, caption });
  const res  = await axios.post(
    `https://api.ultramsg.com/${INSTANCE_ID}/messages/document`,
    data,
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  );
  return res.data;
}

// ─── Formatage ────────────────────────────────────────────────────────────────
function fmt(n) {
  return new Intl.NumberFormat('fr-FR').format(n);
}

// ─── Script principal ─────────────────────────────────────────────────────────
async function main() {
  console.log('\n🔌 Connexion à la base de données...');
  await connectDB();
  await new Promise(r => setTimeout(r, 1500)); // attendre que Mongoose soit prêt

  console.log(`🔍 Recherche de l'actionnaire : ${TELEPHONE_CIBLE}`);

  // Chercher avec ou sans le +
  const user = await User.findOne({
    telephone: { $regex: TELEPHONE_CIBLE.replace(/\+/g, '\\+'), $options: 'i' }
  }).lean()
  ?? await User.findOne({
    telephone: { $regex: TELEPHONE_CIBLE.replace(/^\+/, ''), $options: 'i' }
  }).lean();

  if (!user) {
    console.error(`❌ Aucun actionnaire trouvé avec le numéro ${TELEPHONE_CIBLE}`);
    process.exit(1);
  }

  // Actions de la BDD
  const actionsEnBDD = user.nbre_actions || 0;

  // Nouvelles actions à céder (via CLI) — ou 0 si pas fourni
  const nouvellesActions = ACTIONS_FORCEES !== null ? ACTIONS_FORCEES : 0;

  // Total affiché dans le contrat = BDD + nouvelles
  const totalActionsApres = actionsEnBDD + nouvellesActions;

  // Ce qui figure dans "actions cédées" = nouvelles seulement (ou BDD si pas de CLI)
  const actionsCedees = ACTIONS_FORCEES !== null ? nouvellesActions : actionsEnBDD;

  const capitalTotal = 1000000;
  const pourcentage  = ((totalActionsApres / capitalTotal) * 100).toFixed(5);

  console.log(`\n✅ Actionnaire trouvé :`);
  console.log(`   Nom           : ${user.firstName} ${user.lastName}`);
  console.log(`   Téléphone     : ${user.telephone}`);
  console.log(`   Actions en BDD: ${fmt(actionsEnBDD)}`);
  console.log(`   Nouvelles     : ${fmt(nouvellesActions)}${ACTIONS_FORCEES !== null ? ' (CLI)' : ''}`);
  console.log(`   Total contrat : ${fmt(totalActionsApres)} actions`);
  console.log(`   Pourcentage   : ${pourcentage}% du capital`);
  console.log(`   Prix/action   : ${fmt(PRIX_PAR_ACTION)} FCFA\n`);

  // ── Données pour le contrat ──
  const prixParAction = PRIX_PAR_ACTION;
  const montantTotal  = actionsCedees * prixParAction;

  const purchaseData = {
    _id:             user._id,
    nombre_actions:  actionsCedees,       // actions cédées dans ce contrat
    nbre_actions:    actionsCedees,
    prix_unitaire:   prixParAction,
    price_per_share: prixParAction,
    montant_total:   montantTotal,
    montant:         montantTotal,
    createdAt:       user.createdAt || new Date(),
  };

  // On passe un user enrichi avec le total mis à jour
  const userPourContrat = { ...user, nbre_actions: totalActionsApres, nombre_actions: totalActionsApres };

  // ── Générer le PDF ──
  console.log('📄 Génération du contrat PDF...');
  const pdfBuffer = await generateContractPDF(purchaseData, userPourContrat);
  console.log(`   ✅ PDF généré (${Math.round(pdfBuffer.length / 1024)} Ko)`);

  // ── Upload S3 ──
  console.log('☁️  Upload sur S3...');
  const fileName = `Contrat_${user._id}_${Date.now()}.pdf`;
  const pdfUrl   = await uploadPDFToS3(pdfBuffer, fileName);
  console.log(`   ✅ URL : ${pdfUrl}`);

  // ── Envoi WhatsApp ──
  console.log(`📱 Envoi WhatsApp à ${user.telephone}...`);
  const caption = [
    `Bonjour ${user.firstName} ${user.lastName},`,
    ``,
    `Veuillez trouver ci-joint votre contrat de cession d'actions Dioko Group SAS.`,
    ``,
    `📊 Vous détenez actuellement *${fmt(totalActionsApres)} actions*, soit *${pourcentage}%* du capital social.`,
    `💰 Dividendes disponibles : *${fmt(user.dividende || 0)} FCFA*`,
    ``,
    `Merci pour votre confiance — Équipe Dioko`,
  ].join('\n');

  const waRes = await sendPDFWhatsApp(user.telephone, pdfUrl, fileName, caption);
  console.log(`   ✅ Réponse WhatsApp :`, waRes?.sent || waRes);

  console.log('\n🎉 Contrat envoyé avec succès !\n');
  process.exit(0);
}

main().catch(err => {
  console.error('\n❌ Erreur fatale :', err.message);
  process.exit(1);
});
