// Services/actionsPurchaseService.js - VERSION CORRIGÉE PROPREMENT
const axios = require('axios');
const ActionsPurchase = require('../Models/ActionsPurchase');
const { PAYDUNYA_CONFIG, getHeaders, validateConfig } = require('../Config/paydunyaci');
const User = require("../Models/User")
const Price = require('../Models/Price');
const VIPUser = require('../Models/VIPUser');
validateConfig();


const calculateActionPrice = async (userId) => {
  try {
    const user = await User.findById(userId);
    if (!user) throw new Error("Utilisateur introuvable pour le calcul du prix");

    // Vérifier si l'utilisateur est VIP
    const isVIP = await VIPUser.findOne({ 
      telephone: user.telephone, 
      actif: true 
    });

    // Récupérer le prix approprié depuis la base de données
    const priceType = isVIP ? 'VIP' : 'NORMAL';
    const priceData = await Price.findOne({ type: priceType, actif: true });

    if (!priceData) {
      throw new Error(`Prix ${priceType} non configuré`);
    }

    return {
      prix_unitaire: priceData.prix_unitaire,
      currency: priceData.currency,
      type: priceType,
      entreprise_annee: new Date().getFullYear(),
      derniere_mise_a_jour: new Date(),
    };
  } catch (error) {
    console.error("❌ Erreur lors du calcul du prix :", error);
    throw error;
  }
};







/**
 * Créer une facture PayDunya
 */
const createPaydunyaInvoiceCI = async (userId, nombreActions, montantTotal) => {
  try {
    //('🎯 Création facture PayDunya...');
    
    // Récupérer les infos utilisateur
    const user = await User.findById(userId);
    if (!user) {
      throw new Error('Utilisateur non trouvé');
    }

    //console.log('👤 Utilisateur:', user.firstName, user.lastName);
    //console.log('📊 Actions:', nombreActions);
    //console.log('💰 Montant:', montantTotal);

    // Construire l'URL complète
    const fullUrl = `${PAYDUNYA_CONFIG.BASE_URL}${PAYDUNYA_CONFIG.ENDPOINTS.CREATE_INVOICE}`;

    // Préparer les données de la facture
    const invoiceData = {
      invoice: {
        total_amount: montantTotal,
        description: `Achat de ${nombreActions} actions Dioko`
      },
      store: PAYDUNYA_CONFIG.STORE_INFO,
      actions: {
        cancel_url: PAYDUNYA_CONFIG.CANCEL_URL,
        return_url: PAYDUNYA_CONFIG.RETURN_URL,
        callback_url: `${PAYDUNYA_CONFIG.CALLBACK_URL}/actions/payment/callback` // ✅ CORRIGÉ
      },
      custom_data: {
        user_id: userId.toString(),
        nombre_actions: nombreActions,
        type: 'actions_purchase',
        user_info: {
          nom: `${user.firstName} ${user.lastName}`,
          telephone: user.telephone
        }
      }
    };

    //('📤 Données envoyées à PayDunya:', JSON.stringify(invoiceData, null, 2));
    //('🌐 URL:', fullUrl);

    // Faire la requête à PayDunya
    const response = await axios.post(fullUrl, invoiceData, {
      headers: getHeaders(),
      timeout: 30000
    });

    //('📥 Réponse PayDunya:', response.data);

    if (response.data.response_code === '00') {
      return {
        success: true,
        token: response.data.token,
        response_text: response.data.response_text, // URL de paiement
        description: response.data.description
      };
    } else {
      throw new Error(response.data.response_text || 'Erreur création facture PayDunya');
    }

  } catch (error) {
    console.error('❌ Erreur création facture PayDunya:', error.message);
    if (error.response) {
      console.error('Response data:', error.response.data);
      console.error('Response status:', error.response.status);
    }
    throw error;
  }
};

/**
 * Vérifier le statut d'une transaction PayDunya
 */
const verifyPaydunyaTransactionCI = async (transactionId) => {
  try {
    //('🔍 Vérification transaction PayDunya:', transactionId);

    const fullUrl = `${PAYDUNYA_CONFIG.BASE_URL}${PAYDUNYA_CONFIG.ENDPOINTS.CONFIRM_INVOICE}/${transactionId}`;
    
    const response = await axios.get(fullUrl, {
      headers: getHeaders(),
      timeout: 15000
    });

    /* console.log('📥 Statut PayDunya:', response.data); */
    return response.data;

  } catch (error) {
    console.error('❌ Erreur vérification PayDunya:', error.message);
    if (error.response) {
      console.error('Response data:', error.response.data);
    }
    throw error;
  }
};

/**
 * ✅ FONCTION CLÉE : Traiter la finalisation du paiement
 * SEULEMENT AJOUTER LES ACTIONS, PAS DE RECALCUL DE DIVIDENDES
 */
const processPaymentCompletionCI = async (actionsPurchase, paymentStatus) => {
  try {
  

    // 1. Récupérer l'utilisateur
    const user = await User.findById(actionsPurchase.user_id);
    if (!user) {
      throw new Error('Utilisateur non trouvé');
    }

    //('👤 Utilisateur trouvé:', user.firstName, user.lastName);
    //('📊 Actions actuelles:', user.nbre_actions || 0);
    //('💰 Dividendes actuels:', user.dividende || 0);

    // 2. ✅ SEULEMENT AJOUTER LES ACTIONS (pas de recalcul dividendes)
    user.nbre_actions = (user.nbre_actions || 0) + actionsPurchase.nombre_actions;
await user.save(); // Sauvegarde après ajout

    //('✅ Utilisateur mis à jour - Nouvelles actions:', nouvelleQuantiteActions);
    //('📊 Dividendes inchangés:', dividendeActuel);

    // 4. Mettre à jour la transaction
    actionsPurchase.status = 'completed';
    actionsPurchase.paydunya_status = paymentStatus.status;
    actionsPurchase.payment_date = new Date();
    actionsPurchase.payment_method = paymentStatus.customer?.payment_method || 'unknown';
    
    // Ajouter les détails PayDunya
    actionsPurchase.paydunya_details = {
      customer: paymentStatus.customer,
      response_code: paymentStatus.response_code,
      response_text: paymentStatus.response_text,
      verified_at: new Date()
    };

    await actionsPurchase.save();
    //('✅ Transaction mise à jour vers completed');

    return {
     success: true,
  totalActions: user.nbre_actions,
  actionsAchetees: actionsPurchase.nombre_actions
    };

  } catch (error) {
    console.error('❌ Erreur traitement paiement:', error);
    throw error;
  }
};

/**
 * Traiter l'échec du paiement
 */
const processPaymentFailureCI = async (actionsPurchase, paymentStatus) => {
  try {
    //('❌ Traitement échec paiement...');

    // Mettre à jour le statut de la transaction
    actionsPurchase.status = paymentStatus.status === 'cancelled' ? 'cancelled' : 'failed';
    actionsPurchase.paydunya_status = paymentStatus.status;
    actionsPurchase.failure_reason = paymentStatus.response_text || 'Paiement échoué';
    actionsPurchase.failed_at = new Date();

    await actionsPurchase.save();

    return {
      success: true,
      message: 'Échec du paiement traité',
      status: actionsPurchase.status
    };

  } catch (error) {
    console.error('❌ Erreur traitement échec:', error);
    throw error;
  }
};

/**
 * Calculer les statistiques de vente
 */
const calculateSalesStatsCI = async (periodeJours = null) => {
  try {
    // Statistiques globales
    const globalStats = await ActionsPurchase.aggregate([
      {
        $group: {
          _id: null,
          total_actions_vendues: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, '$nombre_actions', 0] } },
          total_revenus: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, '$montant_total', 0] } },
          nombre_transactions_completees: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } },
          nombre_transactions_en_attente: { $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] } },
          nombre_transactions_echouees: { $sum: { $cond: [{ $in: ['$status', ['failed', 'cancelled']] }, 1, 0] } },
          montant_moyen_transaction: { $avg: { $cond: [{ $eq: ['$status', 'completed'] }, '$montant_total', null] } }
        }
      }
    ]);

    let periodeStats = {};
    if (periodeJours) {
      const dateDebut = new Date();
      dateDebut.setDate(dateDebut.getDate() - periodeJours);

      const periodeStatsResult = await ActionsPurchase.aggregate([
        {
          $match: {
            createdAt: { $gte: dateDebut },
            status: 'completed'
          }
        },
        {
          $group: {
            _id: null,
            actions_vendues_periode: { $sum: '$nombre_actions' },
            revenus_periode: { $sum: '$montant_total' },
            transactions_periode: { $sum: 1 }
          }
        }
      ]);

      periodeStats = periodeStatsResult.length > 0 ? periodeStatsResult[0] : {
        actions_vendues_periode: 0,
        revenus_periode: 0,
        transactions_periode: 0
      };
    }

    return {
      global: globalStats.length > 0 ? globalStats[0] : {
        total_actions_vendues: 0,
        total_revenus: 0,
        nombre_transactions_completees: 0,
        nombre_transactions_en_attente: 0,
        nombre_transactions_echouees: 0,
        montant_moyen_transaction: 0
      },
      periode: periodeStats
    };

  } catch (error) {
    console.error('❌ Erreur calcul statistiques:', error);
    throw error;
  }
};

module.exports = {
  calculateActionPrice,
  // calculateDividende, // ✅ SUPPRIMÉ - Pas de calcul de dividendes
  createPaydunyaInvoiceCI,
  verifyPaydunyaTransactionCI,
  processPaymentCompletionCI,
  processPaymentFailureCI,
  calculateSalesStatsCI
};