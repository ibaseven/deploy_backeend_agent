// Controller/packPurchaseController.js
const axios = require('axios');
const qs = require('qs');
const AWS = require('aws-sdk');
const { PackPurchase, PACKS_CONFIG } = require('../Models/PackPurchase');
const User = require('../Models/User');
const { generateContractPDF } = require('../Services/contractGenerator');

// ─── AWS S3 ──────────────────────────────────────────────────────────────────
const s3 = new AWS.S3({
  accessKeyId:     process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region:          process.env.AWS_REGION,
});

async function uploadPDFToS3(pdfBuffer, fileName) {
  const s3Key = `contrats/${fileName}`;
  await s3.putObject({
    Bucket: process.env.AWS_BUCKET_NAME,
    Key: s3Key,
    Body: pdfBuffer,
    ContentType: 'application/pdf',
  }).promise();
  return `https://${process.env.AWS_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${s3Key}`;
}

// ─── WHATSAPP ─────────────────────────────────────────────────────────────────
const INSTANCE_ID = process.env.ULTRAMSG_INSTANCE_ID;
const TOKEN       = process.env.ULTRAMSG_TOKEN;
const ADMIN_PHONE = '221773878232';

async function sendWhatsApp(to, message) {
  try {
    if (!INSTANCE_ID || !TOKEN) return;
    const data = qs.stringify({ token: TOKEN, to: to.replace(/\D/g, ''), body: message });
    await axios.post(`https://api.ultramsg.com/${INSTANCE_ID}/messages/chat`, data, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
  } catch (e) { console.error('❌ WhatsApp error:', e.message); }
}

async function sendPDFWhatsApp(to, pdfUrl, fileName, caption) {
  try {
    if (!INSTANCE_ID || !TOKEN) return;
    const data = qs.stringify({ token: TOKEN, to: to.replace(/\D/g, ''), filename: fileName, document: pdfUrl, caption });
    await axios.post(`https://api.ultramsg.com/${INSTANCE_ID}/messages/document`, data, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
  } catch (e) { console.error('❌ PDF WhatsApp error:', e.message); }
}

// ─── PAYDUNYA ─────────────────────────────────────────────────────────────────
const PAYDUNYA_BASE = process.env.PAYDUNYA_MODE === 'live'
  ? 'https://app.paydunya.com/api/v1'
  : 'https://app.paydunya.com/sandbox-api/v1';

function getPaydunyaHeaders() {
  return {
    'PAYDUNYA-MASTER-KEY':  process.env.PAYDUNYA_MASTER_KEY,
    'PAYDUNYA-PRIVATE-KEY': process.env.PAYDUNYA_PRIVATE_KEY,
    'PAYDUNYA-PUBLIC-KEY':  process.env.PAYDUNYA_PUBLIC_KEY,
    'PAYDUNYA-TOKEN':       process.env.PAYDUNYA_TOKEN,
    'Content-Type': 'application/json',
  };
}

// ─── HELPER : CRÉDITER ACTIONS + ENVOYER CONTRAT ─────────────────────────────
async function creditActionsAndSendContract(packPurchase, user) {
  // 1. Ajouter les actions
  user.nbre_actions = (user.nbre_actions || 0) + packPurchase.nbre_actions;
  await user.save();

  // 2. Générer et envoyer le contrat PDF
  try {
    const prixUnitaire = packPurchase.nbre_actions > 0
      ? Math.round(packPurchase.montant_fcfa / packPurchase.nbre_actions)
      : 0;
    const purchaseData = {
      _id:            packPurchase._id,
      nombre_actions: packPurchase.nbre_actions,
      nbre_actions:   packPurchase.nbre_actions,
      montant_total:  packPurchase.montant_fcfa,
      montant:        packPurchase.montant_fcfa,
      prix_unitaire:  prixUnitaire,
      price_per_share: prixUnitaire,
      pack_nom:       packPurchase.pack_nom,
      createdAt:      packPurchase.createdAt,
    };
    const pdfBuffer = await generateContractPDF(purchaseData, user);
    const fileName  = `ContratPack_${packPurchase._id}_${Date.now()}.pdf`;
    const pdfUrl    = await uploadPDFToS3(pdfBuffer, fileName);

    await sendPDFWhatsApp(
      user.telephone,
      pdfUrl,
      fileName,
      `Félicitations ${user.firstName} ${user.lastName} ! Voici votre contrat pour le Pack ${packPurchase.pack_nom} — ${packPurchase.nbre_actions} actions créditées. Merci — Équipe Dioko`
    );

    packPurchase.contract_sent = true;
    await packPurchase.save();
    console.log(`✅ Contrat Pack ${packPurchase.pack_nom} envoyé à ${user.telephone}`);
  } catch (err) {
    console.error('❌ Erreur envoi contrat pack:', err.message);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * GET /packs  — liste des packs disponibles
 */
module.exports.getAvailablePacks = async (req, res) => {
  return res.status(200).json({ success: true, packs: PACKS_CONFIG });
};

/**
 * POST /packs/acheter-cfa  — initier achat CFA via PayDunya
 */
module.exports.initiatePackPurchaseCFA = async (req, res) => {
  try {
    const userId  = req.user.id || req.user._id;
    const { pack_nom } = req.body;

    const pack = PACKS_CONFIG.find(p => p.nom === pack_nom);
    if (!pack) return res.status(400).json({ success: false, message: 'Pack invalide.' });

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ success: false, message: 'Utilisateur introuvable.' });
    if (user.isBlocked || user.status !== 'active') {
      return res.status(403).json({ success: false, message: 'Compte bloqué ou inactif.' });
    }

    // Créer l'entrée en base (pending)
    const packPurchase = await PackPurchase.create({
      user_id:        userId,
      pack_nom:       pack.nom,
      nbre_actions:   pack.nbre_actions,
      montant_fcfa:   pack.montant_fcfa,
      montant_usd:    pack.montant_usd,
      payment_method: 'fcfa',
    });

    // Créer la facture PayDunya
    const callbackUrl = `${process.env.BACKEND_URL || 'https://api.actionnaire.diokoclient.com'}/packs/callback`;
    const invoiceData = {
      invoice: {
        total_amount: pack.montant_fcfa,
        description:  `Pack ${pack.nom} — ${pack.nbre_actions} actions Dioko`,
      },
      store: {
        name:        'Dioko',
        tagline:     "Plateforme d'investissement en actions",
        phone:       process.env.COMPANY_PHONE || '221775968426',
        email:       process.env.COMPANY_EMAIL || 'contact@dioko.com',
        website_url: process.env.FRONTEND_URL  || 'https://actionnaire.diokoclient.com',
      },
      actions: {
        cancel_url:   process.env.FRONTEND_URL || 'https://actionnaire.diokoclient.com',
        return_url:   `${process.env.FRONTEND_URL || 'https://actionnaire.diokoclient.com'}/dashboard/acheter-pack?status=success`,
        callback_url: callbackUrl,
      },
      custom_data: {
        pack_purchase_id: packPurchase._id.toString(),
        user_id:          userId.toString(),
        type:             'pack_purchase',
        pack_nom:         pack.nom,
      },
    };

    const response = await axios.post(
      `${PAYDUNYA_BASE}/checkout-invoice/create`,
      invoiceData,
      { headers: getPaydunyaHeaders(), timeout: 30000 }
    );

    if (response.data.response_code !== '00') {
      await PackPurchase.findByIdAndDelete(packPurchase._id);
      throw new Error(response.data.response_text || 'Erreur PayDunya');
    }

    const token = response.data.token;
    packPurchase.paydunya_token = token;
    await packPurchase.save();

    return res.status(200).json({
      success:         true,
      message:         'Facture créée',
      redirect_url:    response.data.response_text, // URL de paiement PayDunya
      transaction_id:  token,
      pack_purchase_id: packPurchase._id,
    });

  } catch (error) {
    console.error('❌ initiatePackPurchaseCFA:', error.message);
    return res.status(500).json({ success: false, message: error.message || 'Erreur serveur.' });
  }
};

/**
 * POST /packs/callback  — callback PayDunya (public)
 */
module.exports.handlePackPaydunyaCallback = async (req, res) => {
  try {
    // PayDunya envoie { data: { payment_link_token, custom_data, ... } }
    // data peut être un objet ou une string JSON
    let data = req.body.data;
    if (!data) {
      console.error('❌ Pack callback — body vide:', JSON.stringify(req.body));
      return res.status(400).json({ success: false, message: 'Données manquantes.' });
    }
    if (typeof data === 'string') {
      try { data = JSON.parse(data); } catch (e) {
        console.error('❌ Pack callback — JSON invalide:', data);
        return res.status(400).json({ success: false, message: 'JSON invalide.' });
      }
    }

    // Extraire le token de paiement
    const token = data.payment_link_token || data.invoice?.token || data.token;
    if (!token) {
      console.error('❌ Pack callback — token manquant:', JSON.stringify(data));
      return res.status(400).json({ success: false, message: 'Token manquant.' });
    }

    //console.log('📦 Pack callback reçu — token:', token, '| custom_data:', JSON.stringify(data.custom_data));

    // Vérifier le statut via PayDunya
    const verifyRes = await axios.get(
      `${PAYDUNYA_BASE}/checkout-invoice/confirm/${token}`,
      { headers: getPaydunyaHeaders(), timeout: 15000 }
    );
    const payStatus = verifyRes.data;
   // console.log('📊 PayDunya status:', payStatus.status, '| response_code:', payStatus.response_code);

    if (payStatus.response_code !== '00' || payStatus.status !== 'completed') {
      return res.status(200).json({ success: false, message: 'Paiement non complété.' });
    }

    // Trouver le PackPurchase — via custom_data ou via le token stocké en DB
    const packPurchaseId = data.custom_data?.pack_purchase_id
      || payStatus.custom_data?.pack_purchase_id;

    let packPurchase = null;
    if (packPurchaseId) {
      packPurchase = await PackPurchase.findById(packPurchaseId);
    }
    if (!packPurchase) {
      // Fallback : chercher par token PayDunya stocké en DB
      packPurchase = await PackPurchase.findOne({ paydunya_token: token });
    }

    if (!packPurchase) {
      console.error('❌ Pack callback — PackPurchase introuvable. token:', token, 'id:', packPurchaseId);
      return res.status(404).json({ success: false, message: 'Commande introuvable.' });
    }

    if (packPurchase.status === 'completed') {
      return res.status(200).json({ success: true, message: 'Déjà traité.' });
    }

    const user = await User.findById(packPurchase.user_id);
    if (!user) return res.status(404).json({ success: false, message: 'Utilisateur introuvable.' });

    // Marquer complété
    packPurchase.status = 'completed';
    packPurchase.processed_at = new Date();
    await packPurchase.save();

    // Créditer actions + envoyer contrat
    await creditActionsAndSendContract(packPurchase, user);

    console.log(`✅ Pack ${packPurchase.pack_nom} activé pour ${user.firstName} ${user.lastName} — ${packPurchase.nbre_actions} actions créditées`);
    return res.status(200).json({ success: true, message: 'Pack activé.' });

  } catch (error) {
    console.error('❌ handlePackPaydunyaCallback:', error.message);
    return res.status(500).json({ success: false, message: 'Erreur serveur.' });
  }
};

/**
 * GET /packs/transaction/:token/status  — vérifier statut paiement CFA
 */
module.exports.checkPackPaymentStatus = async (req, res) => {
  try {
    const { token } = req.params;
    const packPurchase = await PackPurchase.findOne({ paydunya_token: token });
    if (!packPurchase) return res.status(404).json({ success: false, message: 'Transaction introuvable.' });

    return res.status(200).json({
      success: true,
      status:  packPurchase.status,
      pack:    packPurchase.pack_nom,
      nbre_actions: packPurchase.nbre_actions,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Erreur serveur.' });
  }
};

/**
 * POST /packs/acheter-crypto  — demande achat crypto
 */
module.exports.initiatePackPurchaseCrypto = async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const { pack_nom, adresse_usdt } = req.body;

    const pack = PACKS_CONFIG.find(p => p.nom === pack_nom);
    if (!pack) return res.status(400).json({ success: false, message: 'Pack invalide.' });

    if (!adresse_usdt || adresse_usdt.trim().length < 10) {
      return res.status(400).json({ success: false, message: 'Adresse USDT TRC20 invalide.' });
    }

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ success: false, message: 'Utilisateur introuvable.' });
    if (user.isBlocked || user.status !== 'active') {
      return res.status(403).json({ success: false, message: 'Compte bloqué ou inactif.' });
    }

    // Vérifier qu'il n'a pas déjà une demande en attente pour ce pack
    const existing = await PackPurchase.findOne({ user_id: userId, pack_nom: pack.nom, payment_method: 'crypto', status: 'pending' });
    if (existing) {
      return res.status(400).json({ success: false, message: `Vous avez déjà une demande en attente pour le Pack ${pack.nom}.` });
    }

    const packPurchase = await PackPurchase.create({
      user_id:        userId,
      pack_nom:       pack.nom,
      nbre_actions:   pack.nbre_actions,
      montant_fcfa:   pack.montant_fcfa,
      montant_usd:    pack.montant_usd,
      payment_method: 'crypto',
      adresse_usdt:   adresse_usdt.trim(),
    });

    // Notifier l'admin
    const msg = `🛒 Nouvelle demande achat Pack ${pack.nom}\n👤 ${user.firstName} ${user.lastName} (${user.telephone})\n💰 ${pack.montant_usd}$ (${pack.montant_fcfa.toLocaleString('fr-FR')} FCFA)\n📊 ${pack.nbre_actions} actions\n📬 ${adresse_usdt.trim()}`;
    sendWhatsApp(ADMIN_PHONE, msg);

    return res.status(201).json({
      success: true,
      message: `Demande pour le Pack ${pack.nom} soumise. L'admin vérifiera votre paiement et activera vos actions.`,
      pack_purchase_id: packPurchase._id,
    });

  } catch (error) {
    console.error('❌ initiatePackPurchaseCrypto:', error.message);
    return res.status(500).json({ success: false, message: 'Erreur serveur.' });
  }
};

/**
 * GET /packs/mes-achats  — historique de l'actionnaire
 */
module.exports.getMyPackPurchases = async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const achats = await PackPurchase.find({ user_id: userId }).sort({ createdAt: -1 }).lean();
    return res.status(200).json({ success: true, achats });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Erreur serveur.' });
  }
};

/**
 * GET /packs/admin/achats  — tous les achats (admin)
 */
module.exports.getAllPackPurchases = async (req, res) => {
  try {
    const { status, payment_method } = req.query;
    const filter = {};
    if (status && ['pending', 'completed', 'rejected'].includes(status)) filter.status = status;
    if (payment_method && ['fcfa', 'crypto'].includes(payment_method)) filter.payment_method = payment_method;

    const achats = await PackPurchase.find(filter)
      .populate('user_id', 'firstName lastName telephone nbre_actions')
      .populate('admin_id', 'firstName lastName')
      .sort({ createdAt: -1 })
      .lean();

    return res.status(200).json({ success: true, achats });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Erreur serveur.' });
  }
};

/**
 * PUT /packs/admin/achats/:id/valider  — admin valide une demande crypto
 */
module.exports.validatePackPurchase = async (req, res) => {
  try {
    const adminId = req.user.id || req.user._id;
    const { id } = req.params;
    const { admin_note } = req.body;

    const packPurchase = await PackPurchase.findById(id);
    if (!packPurchase) return res.status(404).json({ success: false, message: 'Demande introuvable.' });
    if (packPurchase.status !== 'pending') return res.status(400).json({ success: false, message: 'Demande déjà traitée.' });
    if (packPurchase.payment_method !== 'crypto') return res.status(400).json({ success: false, message: 'Cette action est réservée aux achats crypto.' });

    const user = await User.findById(packPurchase.user_id);
    if (!user) return res.status(404).json({ success: false, message: 'Utilisateur introuvable.' });

    // Marquer complété
    packPurchase.status       = 'completed';
    packPurchase.admin_id     = adminId;
    packPurchase.admin_note   = admin_note || '';
    packPurchase.processed_at = new Date();
    await packPurchase.save();

    // Créditer actions + envoyer contrat
    await creditActionsAndSendContract(packPurchase, user);

    return res.status(200).json({
      success: true,
      message: `Pack ${packPurchase.pack_nom} validé. ${packPurchase.nbre_actions} actions créditées et contrat envoyé.`,
    });

  } catch (error) {
    console.error('❌ validatePackPurchase:', error.message);
    return res.status(500).json({ success: false, message: 'Erreur serveur.' });
  }
};

/**
 * PUT /packs/admin/achats/:id/rejeter  — admin rejette une demande crypto
 */
module.exports.rejectPackPurchase = async (req, res) => {
  try {
    const adminId = req.user.id || req.user._id;
    const { id } = req.params;
    const { admin_note } = req.body;

    const packPurchase = await PackPurchase.findById(id);
    if (!packPurchase) return res.status(404).json({ success: false, message: 'Demande introuvable.' });
    if (packPurchase.status !== 'pending') return res.status(400).json({ success: false, message: 'Demande déjà traitée.' });

    packPurchase.status       = 'rejected';
    packPurchase.admin_id     = adminId;
    packPurchase.admin_note   = admin_note || '';
    packPurchase.processed_at = new Date();
    await packPurchase.save();

    // Notifier l'utilisateur
    try {
      const user = await User.findById(packPurchase.user_id);
      if (user) {
        await sendWhatsApp(user.telephone, `❌ Votre demande pour le Pack ${packPurchase.pack_nom} a été rejetée.${admin_note ? `\nRaison : ${admin_note}` : ''}`);
      }
    } catch {}

    return res.status(200).json({ success: true, message: 'Demande rejetée.' });

  } catch (error) {
    console.error('❌ rejectPackPurchase:', error.message);
    return res.status(500).json({ success: false, message: 'Erreur serveur.' });
  }
};
