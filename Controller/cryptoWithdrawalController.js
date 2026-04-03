// Controller/cryptoWithdrawalController.js
const CryptoWithdrawal = require('../Models/CryptoWithdrawal');
const User = require('../Models/User');
const axios = require('axios');
const qs = require('qs');

const INSTANCE_ID = process.env.ULTRAMSG_INSTANCE_ID;
const TOKEN = process.env.ULTRAMSG_TOKEN;
const ADMIN_NOTIF_PHONE = '221773878232'; // numéro admin à notifier

async function notifyAdmin(message) {
  try {
    if (!INSTANCE_ID || !TOKEN) return;
    const data = qs.stringify({ token: TOKEN, to: ADMIN_NOTIF_PHONE, body: message });
    await axios.post(`https://api.ultramsg.com/${INSTANCE_ID}/messages/chat`, data, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
  } catch (err) {
    console.error('❌ Erreur notif WhatsApp admin:', err.message);
  }
}

/**
 * Actionnaire — soumettre une demande de retrait crypto
 */
module.exports.requestCryptoWithdrawal = async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const { montant_fcfa, adresse_usdt } = req.body;

    // Validation basique
    if (!montant_fcfa || !adresse_usdt) {
      return res.status(400).json({ success: false, message: 'Montant et adresse USDT TRC20 requis.' });
    }

    const montant = Number(montant_fcfa);
    if (isNaN(montant) || montant < 1000) {
      return res.status(400).json({ success: false, message: 'Montant minimum : 1 000 FCFA.' });
    }

    const adresse = adresse_usdt.trim();
    if (!adresse || adresse.length < 10) {
      return res.status(400).json({ success: false, message: 'Adresse USDT TRC20 invalide.' });
    }

    // Récupérer l'utilisateur et vérifier le solde dividendes
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'Utilisateur introuvable.' });
    }

    const dividendeActuel = user.dividende || 0;
    if (dividendeActuel < montant) {
      return res.status(400).json({
        success: false,
        message: `Solde insuffisant. Vous avez ${dividendeActuel.toLocaleString('fr-FR')} FCFA de dividendes disponibles.`,
      });
    }

    // Vérifier qu'il n'y a pas déjà une demande en attente
    const demandeEnAttente = await CryptoWithdrawal.findOne({ user_id: userId, status: 'pending' });
    if (demandeEnAttente) {
      return res.status(400).json({
        success: false,
        message: 'Vous avez déjà une demande en attente. Veuillez attendre son traitement avant d\'en soumettre une nouvelle.',
      });
    }

    // Créer la demande
    const retrait = await CryptoWithdrawal.create({
      user_id: userId,
      montant_fcfa: montant,
      adresse_usdt: adresse,
      dividende_avant: dividendeActuel,
    });

    // Notifier l'admin par WhatsApp
    const nomUser = `${user.firstName} ${user.lastName}`;
    const msg = `💎 Nouvelle demande de retrait crypto\n👤 ${nomUser} (${user.telephone})\n💰 ${montant.toLocaleString('fr-FR')} FCFA\n📬 ${adresse}`;
    notifyAdmin(msg);

    return res.status(201).json({
      success: true,
      message: 'Votre demande de retrait a été soumise. Le dépôt sera effectué dans votre compte d\'ici 24h.',
      retrait: {
        _id: retrait._id,
        montant_fcfa: retrait.montant_fcfa,
        adresse_usdt: retrait.adresse_usdt,
        crypto_type: retrait.crypto_type,
        status: retrait.status,
        createdAt: retrait.createdAt,
      },
    });
  } catch (error) {
    console.error('❌ Erreur requestCryptoWithdrawal:', error);
    return res.status(500).json({ success: false, message: 'Erreur serveur.' });
  }
};

/**
 * Actionnaire — historique de mes retraits crypto
 */
module.exports.getMyCryptoWithdrawals = async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;

    const retraits = await CryptoWithdrawal.find({ user_id: userId })
      .sort({ createdAt: -1 })
      .lean();

    return res.status(200).json({ success: true, retraits });
  } catch (error) {
    console.error('❌ Erreur getMyCryptoWithdrawals:', error);
    return res.status(500).json({ success: false, message: 'Erreur serveur.' });
  }
};

/**
 * Admin — voir toutes les demandes
 */
module.exports.getAllCryptoWithdrawals = async (req, res) => {
  try {
    const { status } = req.query;

    const filter = {};
    if (status && ['pending', 'accepted', 'rejected'].includes(status)) {
      filter.status = status;
    }

    const retraits = await CryptoWithdrawal.find(filter)
      .populate('user_id', 'firstName lastName telephone dividende')
      .populate('admin_id', 'firstName lastName')
      .sort({ createdAt: -1 })
      .lean();

    return res.status(200).json({ success: true, retraits });
  } catch (error) {
    console.error('❌ Erreur getAllCryptoWithdrawals:', error);
    return res.status(500).json({ success: false, message: 'Erreur serveur.' });
  }
};

/**
 * Admin — accepter une demande : déduire les dividendes
 */
module.exports.acceptCryptoWithdrawal = async (req, res) => {
  try {
    const adminId = req.user.id || req.user._id;
    const { id } = req.params;
    const { admin_note } = req.body;

    const retrait = await CryptoWithdrawal.findById(id);
    if (!retrait) {
      return res.status(404).json({ success: false, message: 'Demande introuvable.' });
    }
    if (retrait.status !== 'pending') {
      return res.status(400).json({ success: false, message: 'Cette demande a déjà été traitée.' });
    }

    // Récupérer l'utilisateur
    const user = await User.findById(retrait.user_id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'Utilisateur introuvable.' });
    }

    const dividendeActuel = user.dividende || 0;
    if (dividendeActuel < retrait.montant_fcfa) {
      return res.status(400).json({
        success: false,
        message: `Solde insuffisant. L'utilisateur n'a que ${dividendeActuel.toLocaleString('fr-FR')} FCFA de dividendes.`,
      });
    }

    // Déduire les dividendes
    const nouveauDividende = dividendeActuel - retrait.montant_fcfa;
    user.dividende = nouveauDividende;
    await user.save();

    // Mettre à jour la demande
    retrait.status = 'accepted';
    retrait.admin_id = adminId;
    retrait.admin_note = admin_note || '';
    retrait.processed_at = new Date();
    retrait.dividende_avant = dividendeActuel;
    retrait.dividende_apres = nouveauDividende;
    await retrait.save();

    return res.status(200).json({
      success: true,
      message: 'Demande acceptée. Les dividendes ont été déduits.',
      retrait,
      dividende_nouveau: nouveauDividende,
    });
  } catch (error) {
    console.error('❌ Erreur acceptCryptoWithdrawal:', error);
    return res.status(500).json({ success: false, message: 'Erreur serveur.' });
  }
};

/**
 * Admin — rejeter une demande
 */
module.exports.rejectCryptoWithdrawal = async (req, res) => {
  try {
    const adminId = req.user.id || req.user._id;
    const { id } = req.params;
    const { admin_note } = req.body;

    const retrait = await CryptoWithdrawal.findById(id);
    if (!retrait) {
      return res.status(404).json({ success: false, message: 'Demande introuvable.' });
    }
    if (retrait.status !== 'pending') {
      return res.status(400).json({ success: false, message: 'Cette demande a déjà été traitée.' });
    }

    retrait.status = 'rejected';
    retrait.admin_id = adminId;
    retrait.admin_note = admin_note || '';
    retrait.processed_at = new Date();
    await retrait.save();

    return res.status(200).json({
      success: true,
      message: 'Demande rejetée.',
      retrait,
    });
  } catch (error) {
    console.error('❌ Erreur rejectCryptoWithdrawal:', error);
    return res.status(500).json({ success: false, message: 'Erreur serveur.' });
  }
};
