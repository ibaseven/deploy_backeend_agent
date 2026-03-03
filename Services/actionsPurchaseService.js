// Services/actionsPurchaseService.js - VERSION DIOKOLINK
const axios = require('axios');
const ActionsPurchase = require('../Models/ActionsPurchase');
// ✅ MIGRATION DIOKOLINK
const {
  initializePayment,
  checkPaymentStatus: checkDiokolinkStatus
} = require('./diokolinkService');
const User = require("../Models/User")
const Price = require('../Models/Price');
const VIPUser = require('../Models/VIPUser');
const MoratoriumConfig = require('../Models/MoratoriumConfig');
const MoratoriumPurchase = require('../Models/MoratoriumPurchase');


const calculateActionPrice = async (userId) => {
  try {
    const user = await User.findById(userId);
    if (!user) throw new Error("Utilisateur introuvable pour le calcul du prix");

    // ✅ Vérifier d'abord si le moratoire est actif
    const moratoriumConfig = await MoratoriumConfig.getConfig();

    if (moratoriumConfig && moratoriumConfig.actif) {
      // Prix fixe de 2500 FCFA pour le moratoire
      return {
        prix_unitaire: 2500,
        currency: "XOF",
        type: "MORATOIRE",
        entreprise_annee: new Date().getFullYear(),
        derniere_mise_a_jour: new Date(),
      };
    }

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
 * @param {string} userId - ID de l'utilisateur
 * @param {number} nombreActions - Nombre d'actions
 * @param {number} montantTotal - Montant total
 * @param {object} customMetadata - Métadonnées personnalisées (optionnel)
 */
/**
 * ✅ DIOKOLINK: Créer une facture DiokoLink
 */
const createDiokolinkInvoice = async (userId, nombreActions, montantTotal, customMetadata = {}) => {
  try {
    // Récupérer les infos utilisateur
    const user = await User.findById(userId);
    if (!user) {
      throw new Error('Utilisateur non trouvé');
    }

    // Générer une référence unique
    const reference = `ACT-${userId}-${Date.now()}`;

    // Préparer les informations client
    const customer = {
      name: `${user.firstName} ${user.lastName}`,
      email:`dioko@dioko.com`,
      phone: user.telephone
    };

    // Métadonnées personnalisées
    const metadata = {
      nombre_actions: nombreActions,
      user_id: userId.toString(),
      transaction_type: customMetadata.type || 'actions_purchase',
      installment_purchase_id: customMetadata.installment_purchase_id || null,
      user_info: {
        nom: customer.name,
        telephone: user.telephone
      },
      telephone_partenaire: customMetadata.telephone_partenaire
    };

    // Initialiser le paiement avec DiokoLink
    const response = await initializePayment(
      montantTotal,
      'link', // Type: génère une page de paiement
      customer,
      reference,
      null, // payment_method (null = l'utilisateur choisit)
      metadata
    );

    if (response.success) {
      return {
        success: true,
        token: response.transaction_id,
        response_text: response.payment_url,
        transaction_id: response.transaction_id,
        reference: reference
      };
    } else {
      throw new Error(response.error || 'Erreur création paiement DiokoLink');
    }

  } catch (error) {
    console.error('❌ Erreur création facture DiokoLink:', error.message);
    throw error;
  }
};

/**
 * ✅ DIOKOLINK: Vérifier le statut d'une transaction
 */
const verifyDiokolinkTransaction = async (transactionId) => {
  try {
    const response = await checkDiokolinkStatus(transactionId);

    if (response.success) {
      // Mapper la réponse DiokoLink au format attendu par le code existant
      return {
        response_code: response.status === 'success' ? '00' : '99',
        status: mapDiokolinkStatus(response.transaction.status),
        customer: {
          payment_method: response.transaction.payment_method || 'DiokoLink',
          name: response.transaction.customer?.name,
          email: response.transaction.customer?.email,
          phone: response.transaction.customer?.phone
        },
        invoice: {
          total_amount: response.transaction.amount
        },
        response_text: response.transaction.message || 'Transaction vérifiée',
        verified_at: new Date()
      };
    } else {
      throw new Error(response.error || 'Erreur vérification DiokoLink');
    }

  } catch (error) {
    console.error('❌ Erreur vérification DiokoLink:', error.message);
    throw error;
  }
};

/**
 * Mapper les statuts DiokoLink vers les statuts internes
 */
const mapDiokolinkStatus = (diokolinkStatus) => {
  const statusMapping = {
    'pending': 'pending',
    'success': 'completed',
    'failed': 'failed',
    'expired': 'cancelled',
    'cancelled': 'cancelled'
  };

  return statusMapping[diokolinkStatus] || 'pending';
};

/**
 * ✅ FONCTION CLÉE : Traiter la finalisation du paiement
 * SEULEMENT AJOUTER LES ACTIONS, PAS DE RECALCUL DE DIVIDENDES
 * Gère le mode moratoire si activé
 */
const processPaymentCompletion = async (actionsPurchase, paymentStatus) => {
  try {
  

    // 1. Récupérer l'utilisateur
    const user = await User.findById(actionsPurchase.user_id);
    if (!user) {
      throw new Error('Utilisateur non trouvé');
    }

    //('👤 Utilisateur trouvé:', user.firstName, user.lastName);
    //('📊 Actions actuelles:', user.nbre_actions || 0);
    //('💰 Dividendes actuels:', user.dividende || 0);

    // 2. Vérifier si le moratoire est actif
    const moratoriumConfig = await MoratoriumConfig.getConfig();

    if (moratoriumConfig.actif) {
      //('⏳ Mode moratoire actif - Actions en attente de validation');

      // Créer une entrée dans MoratoriumPurchase
      await MoratoriumPurchase.create({
        actionsPurchase_id: actionsPurchase._id,
        user_id: user._id,
        nombre_actions: actionsPurchase.nombre_actions,
        montant_total: actionsPurchase.montant_total,
        prix_unitaire: actionsPurchase.prix_unitaire,
        status: 'waiting'
      });

      // Mettre à jour la transaction comme completed mais avec note moratoire
      actionsPurchase.status = 'completed';
      actionsPurchase.paydunya_status = paymentStatus.status;
      actionsPurchase.payment_date = new Date();
      actionsPurchase.payment_method = paymentStatus.customer?.payment_method || 'unknown';

      actionsPurchase.paydunya_details = {
        customer: paymentStatus.customer,
        response_code: paymentStatus.response_code,
        response_text: paymentStatus.response_text,
        verified_at: new Date()
      };

      actionsPurchase.admin_notes = 'Achat en attente de validation (mode moratoire)';
      await actionsPurchase.save();

      // Vérifier automatiquement si le seuil est atteint
      if (moratoriumConfig.type_validation === 'automatique') {
        const stats = await MoratoriumPurchase.getTotalWaitingActions();

        if (stats.total_actions >= moratoriumConfig.seuil_actions) {
          //('✅ Seuil atteint! Validation automatique...');
          await MoratoriumPurchase.validateAllWaiting(
            null, // Pas d'admin (auto)
            `Validation automatique - Seuil de ${moratoriumConfig.seuil_actions} actions atteint`
          );
          await MoratoriumConfig.incrementerValidations();
        }
      }

      return {
        success: true,
        moratoire: true,
        totalActions: user.nbre_actions,
        actionsEnAttente: actionsPurchase.nombre_actions,
        message: 'Paiement reçu. Actions en attente de validation.'
      };

    } else {
      // Mode normal : ajouter les actions immédiatement
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
        moratoire: false,
        totalActions: user.nbre_actions,
        actionsAchetees: actionsPurchase.nombre_actions
      };
    }

  } catch (error) {
    console.error('❌ Erreur traitement paiement:', error);
    throw error;
  }
};

/**
 * Traiter l'échec du paiement
 */
const processPaymentFailure = async (actionsPurchase, paymentStatus) => {
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
const calculateSalesStats = async (periodeJours = null) => {
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
  createDiokolinkInvoice,        // ✅ DIOKOLINK
  verifyDiokolinkTransaction,    // ✅ DIOKOLINK
  processPaymentCompletion,
  processPaymentFailure,
  calculateSalesStats,

  // ✅ Alias pour compatibilité
  createPaydunyaInvoice: createDiokolinkInvoice,
  verifyPaydunyaTransaction: verifyDiokolinkTransaction
};