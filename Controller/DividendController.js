const User = require('../Models/User');
const Transaction = require('../Models/Transaction');
const Entreprise = require('../Models/Entreprise');
// ✅ MIGRATION DIOKOLINK
const { initializePayout, checkPaymentStatus } = require('../Services/diokolinkService');
const crypto = require('crypto');
const axios = require("axios");
const qs = require("qs");
const otpStore = {};


const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};


const generateIdTransaction = () => {
  return 'DIV_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
};
const verifyUserOTP = (userId, otpCode) => {
  // CORRECTION: Normaliser l'ID pour la recherche
  const normalizedUserId = normalizeId(userId);
  //('🔍 Vérification OTP pour userId:', { original: userId, normalized: normalizedUserId });
  //('📋 Cache OTP actuel:', Object.keys(otpStore));
  
  const storedOTP = otpStore[normalizedUserId];
  
  if (!storedOTP) {
    console.error('❌ Aucun OTP trouvé pour userId:', normalizedUserId);
    //('🔑 Clés disponibles dans otpStore:', Object.keys(otpStore));
    return { valid: false, message: 'Aucun code OTP trouvé' };
  }
  
  //('✅ OTP trouvé:', { code: storedOTP.code, expiresAt: storedOTP.expiresAt });
  
  if (new Date() > storedOTP.expiresAt) {
    console.warn('⏰ OTP expiré pour userId:', normalizedUserId);
    delete otpStore[normalizedUserId];
    return { valid: false, message: 'Code OTP expiré' };
  }
  
  if (storedOTP.code !== otpCode) {
    console.warn('❌ Code OTP incorrect:', { provided: otpCode, expected: storedOTP.code });
    return { valid: false, message: 'Code OTP incorrect' };
  }
  
  //('✅ Code OTP validé avec succès');
  return { valid: true, message: 'Code OTP validé' };
};


const INSTANCE_ID = process.env.ULTRAMSG_INSTANCE_ID;
const TOKEN = process.env.ULTRAMSG_TOKEN;


function formatPhoneNumber(telephone) {
  // Supprimer tous les caractères non numériques
  let cleaned = telephone.replace(/\D/g, '');
  
  // Si le numéro ne commence pas par l'indicatif du pays, ajouter 221 (pour le Sénégal)
  if (!cleaned.startsWith('221') && cleaned.length === 9) {
    cleaned = `221${cleaned}`;
  }
  
  return cleaned;
}


async function sendWhatsAppMessage(phoneNumber, message) {
  const INSTANCE_ID = process.env.ULTRAMSG_INSTANCE_ID;
  const TOKEN = process.env.ULTRAMSG_TOKEN;
  try {
    if (!INSTANCE_ID || !TOKEN) {
      throw new Error('ULTRAMSG_INSTANCE_ID et ULTRAMSG_TOKEN doivent être configurés dans .env');
    }
    const formattedPhone = formatPhoneNumber(phoneNumber);
    const data = qs.stringify({ token: TOKEN, to: formattedPhone, body: message });
    const response = await axios.post(
      `https://api.ultramsg.com/${INSTANCE_ID}/messages/chat`,
      data,
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );
    return { success: true, response: response.data };
  } catch (error) {
    if (error.response) {
      throw new Error(`Erreur API UltraMsg (${error.response.status}): ${JSON.stringify(error.response.data)}`);
    }
    throw error;
  }
}


async function sendOTPWithRetry(telephone, message, maxRetries = 2) {
  let lastError;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      //(`📱 Tentative ${attempt}/${maxRetries} d'envoi OTP`);
      const result = await sendWhatsAppMessage(telephone, message);
      //('✅ OTP envoyé avec succès');
      return { success: true, data: result };
    } catch (error) {
      console.error(`❌ Tentative ${attempt} échouée:`, error.message);
      lastError = error;
      
      if (attempt < maxRetries) {
        // Attendre 2 secondes avant de réessayer
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
  }
  
  return { success: false, error: lastError };
}


// exports.initiateDividendWithdrawal = async (req, res) => {
//   try {
//     const { phoneNumber, amount, paymentMethod } = req.body;
//     const actionnaireId = req.user.id;
    
//     //('🔍 Demande retrait dividendes:', { phoneNumber, amount, paymentMethod, actionnaireId });

//     // Vérifications de base
//     if (!phoneNumber || !amount || !paymentMethod) {
//       return res.status(400).json({ 
//         success: false, 
//         message: 'Paramètres manquants' 
//       });
//     }

//     // Validation du montant
//     const parsedAmount = parseFloat(amount);
//     if (isNaN(parsedAmount) || parsedAmount <= 0) {
//       return res.status(400).json({ 
//         success: false, 
//         message: 'Montant invalide' 
//       });
//     }

//     // Récupérer l'actionnaire
//     const actionnaire = await User.findById(actionnaireId);
//     if (!actionnaire || actionnaire.role !== 'actionnaire') {
//       return res.status(403).json({ 
//         success: false, 
//         message: 'Accès non autorisé' 
//       });
//     }

//     // Vérification renforcée du solde disponible
//     const availableDividend = parseFloat(actionnaire.dividende) || 0;
    
//  /*    //('💰 Vérification solde:', { 
//       availableDividend, 
//       requestedAmount: parsedAmount,
//       sufficient: availableDividend >= parsedAmount 
//     }); */

//     // VÉRIFICATION CRITIQUE : Solde insuffisant
//     if (availableDividend < parsedAmount) {
//       //('❌ SOLDE INSUFFISANT - Transaction bloquée');
//       return res.status(400).json({ 
//         success: false, 
//         message: `Solde insuffisant. Disponible: ${availableDividend.toLocaleString()} FCFA, Demandé: ${parsedAmount.toLocaleString()} FCFA`,
//         error_type: 'insufficient_balance',
//         data: {
//           available_amount: availableDividend,
//           requested_amount: parsedAmount,
//           shortage: parsedAmount - availableDividend
//         }
//       });
//     }

//     //('✅ Solde suffisant, continuation...');

//     // Vérification d'un montant minimum (optionnel)
//     const minimumAmount = 100; // Montant minimum ajusté pour plus de flexibilité
//     //('🔢 Vérification montant minimum:', { parsedAmount, minimumAmount, valid: parsedAmount >= minimumAmount });
    
//     if (parsedAmount < minimumAmount) {
//       //('❌ Montant inférieur au minimum requis');
//       return res.status(400).json({ 
//         success: false, 
//         message: `Montant minimum requis: ${minimumAmount} FCFA`,
//         error_type: 'minimum_amount_not_met',
//         data: {
//           requested_amount: parsedAmount,
//           minimum_required: minimumAmount
//         }
//       });
//     }

//     //('✅ Montant minimum validé, début double vérification...');

//     // Double vérification avant l'appel Paydunya
//     let finalCheck;
//     try {
//       finalCheck = await User.findById(actionnaireId);
//      /*  //('🔄 Double vérification utilisateur:', { 
//         found: !!finalCheck, 
//         dividende: finalCheck?.dividende 
//       }); */
//     } catch (dbError) {
//       console.error('❌ Erreur lors de la double vérification DB:', dbError);
//       return res.status(500).json({ 
//         success: false, 
//         message: 'Erreur lors de la vérification du solde',
//         error_type: 'database_error'
//       });
//     }

//     if (!finalCheck) {
//       //('❌ Utilisateur non trouvé lors de la double vérification');
//       return res.status(404).json({ 
//         success: false, 
//         message: 'Utilisateur non trouvé',
//         error_type: 'user_not_found'
//       });
//     }

//     const currentDividend = parseFloat(finalCheck.dividende) || 0;
//   /*   //('💰 Double vérification solde:', { 
//       currentDividend, 
//       parsedAmount, 
//       sufficient: currentDividend >= parsedAmount 
//     }); */
    
//     // DOUBLE VÉRIFICATION CRITIQUE : Protection contre les modifications concurrentes
//     if (currentDividend < parsedAmount) {
//       //('❌ SOLDE INSUFFISANT lors de la double vérification - Transaction bloquée');
//       return res.status(400).json({ 
//         success: false, 
//         message: 'Solde modifié pendant la transaction. Veuillez réessayer.',
//         error_type: 'balance_changed_insufficient',
//         data: {
//           current_balance: currentDividend,
//           requested_amount: parsedAmount,
//           shortage: parsedAmount - currentDividend
//         }
//       });
//     }

//     //('✅ Double vérification passée, début appel Paydunya...');

//     // Appel Paydunya avec logs détaillés
//     /* //('🚀 Début appel Paydunya avec paramètres:', {
//       phoneNumber,
//       amount: parsedAmount,
//       paymentMethod,
//       actionnaireId
//     });
//  */
//     let transferResult;
//     try {
//       transferResult = await paydounyaService.transferToAgentFromPaydunya(
//         phoneNumber,
//         parsedAmount,
//         paymentMethod,
//         actionnaireId,
//         'https://www.diokogroup.com'
//       );
      
//       //('📥 Réponse complète Paydunya:', JSON.stringify(transferResult, null, 2));
      
//     } catch (paydounyaError) {
//       console.error('❌ Erreur lors de l\'appel Paydunya:', paydounyaError);
//       return res.status(400).json({ 
//         success: false, 
//         message: `Erreur technique Paydunya: ${paydounyaError.message}`,
//         error_type: 'paydunya_call_failed'
//       });
//     }

//     // Vérification détaillée de la réponse Paydunya
//     if (!transferResult) {
//       console.error('❌ Réponse Paydunya nulle');
//       return res.status(400).json({ 
//         success: false, 
//         message: 'Aucune réponse de Paydunya',
//         error_type: 'paydunya_no_response'
//       });
//     }

//     if (!transferResult.success) {
//       console.error('❌ Échec Paydunya:', transferResult);
//       return res.status(400).json({ 
//         success: false, 
//         message: `Erreur Paydunya: ${transferResult.error || 'Erreur inconnue'}`,
//         error_type: 'paydunya_failed',
//         paydunya_response: transferResult
//       });
//     }

//     // Extraire les données avec logs détaillés
//     const disburse_token = transferResult.disburse_token || transferResult.data?.disburse_token;
//     const disburse_invoice = transferResult.data?.invoice_token || transferResult.invoice_token || disburse_token;

//    /*  //('📊 Extraction des données:', { 
//       disburse_token, 
//       disburse_invoice,
//       transferResult_keys: Object.keys(transferResult),
//       transferResult_data_keys: transferResult.data ? Object.keys(transferResult.data) : null
//     }); */

//     if (!disburse_token) {
//       console.error('❌ disburse_token manquant dans la réponse:', transferResult);
//       return res.status(400).json({
//         success: false,
//         message: 'Réponse Paydunya incomplète - disburse_token manquant',
//         error_type: 'missing_disburse_token',
//         paydunya_response: transferResult
//       });
//     }

//     //('✅ disburse_token obtenu:', disburse_token);

//     // Générer référence et OTP
//     const normalizedId = normalizeId(actionnaireId);
//     const reference = `DIV_${Date.now()}_${normalizedId.slice(-6)}`;
//     const otp = generateOTP();
//     const expiration = new Date(Date.now() + 5 * 60 * 1000);
//     otpStore[normalizedId] = {
//       code: otp,
//       expiresAt: expiration,
//       reference: reference,
//       amount: parsedAmount, // Utiliser le montant parsé
//       phoneNumber: phoneNumber,
//       paymentMethod: paymentMethod,
//       type: 'dividend_withdrawal',
//       disburse_invoice: disburse_token,
//     };
    
//     //('💾 OTP stocké:', { userId: normalizedId, code: otp });

//     // Envoyer OTP
//     if (actionnaire.telephone) {
//       const otpMessage = `Code Dioko: ${otp} pour retrait ${parsedAmount.toLocaleString()} FCFA vers ${phoneNumber}. Expire dans 5min.`;
      
//       try {
//         await sendOTPWithRetry(actionnaire.telephone, otpMessage, 1);
//         //('✅ OTP envoyé');
//       } catch (error) {
//         console.warn('⚠️ Échec envoi OTP:', error.message);
//       }
//     }

//     return res.json({
//       success: true,
//       message: 'Retrait initié. Code envoyé par WhatsApp.',
//       data: {
//         reference: reference,
//         amount: parsedAmount,
//         phoneNumber: phoneNumber,
//         paymentMethod: paymentMethod,
//         disburse_invoice: disburse_token,
//         disburse_token: disburse_token,
//         status: 'pending_otp',
//         current_dividend: currentDividend,
//         remaining_dividend: currentDividend - parsedAmount
//       }
//     });

//   } catch (error) {
//     console.error('❌ Erreur:', error);
//     return res.status(500).json({ 
//       success: false, 
//       message: 'Erreur serveur',
//       error: error.message
//     });
//   }
// };



// exports.confirmDividendWithdrawal = async (req, res) => {
//   try {
//     const { otpCode, disburse_invoice } = req.body;
//     const actionnaireId = req.user.id;
    
//     //('🔍 Confirmation retrait:', { otpCode: '***', disburse_invoice, actionnaireId });

//     if (!otpCode || !disburse_invoice) {
//       return res.status(400).json({
//         success: false, 
//         message: 'OTP et disburse_invoice requis'
//       });
//     }

//     // Vérifier l'actionnaire
//     const actionnaire = await User.findById(actionnaireId);
//     if (!actionnaire || actionnaire.role !== 'actionnaire') {
//       return res.status(403).json({ 
//         success: false, 
//         message: 'Accès non autorisé' 
//       });
//     }

//     // Vérifier l'OTP
//     const normalizedId = normalizeId(actionnaireId);
//     const otpData = otpStore[normalizedId];
    
//     if (!otpData) {
//       return res.status(400).json({
//         success: false,
//         message: 'Code OTP expiré ou introuvable'
//       });
//     }

//     if (otpData.code !== otpCode) {
//       return res.status(401).json({
//         success: false,
//         message: 'Code OTP incorrect'
//       });
//     }

//     if (new Date() > otpData.expiresAt) {
//       delete otpStore[normalizedId];
//       return res.status(400).json({
//         success: false,
//         message: 'Code OTP expiré'
//       });
//     }

//     // Vérifier cohérence
//     if (otpData.disburse_invoice !== disburse_invoice) {
//       //('⚠️ Incohérence détectée:', { otpStored: otpData.disburse_invoice, received: disburse_invoice });
//       // On continue quand même si c'est le même token
//       if (otpData.disburse_invoice !== disburse_invoice && !disburse_invoice.includes(otpData.disburse_invoice)) {
//         return res.status(400).json({
//           success: false,
//           message: 'Données incohérentes'
//         });
//       }
//     }

//     // Vérifier le solde encore une fois
//     const currentDividend = actionnaire.dividende || 0;
//     if (currentDividend < otpData.amount) {
//       delete otpStore[normalizedId];
//       return res.status(400).json({
//         success: false,
//         message: `Dividendes insuffisants: ${currentDividend} FCFA`
//       });
//     }

//     // Soumettre à Paydunya
//     //('💳 Soumission facture:', disburse_invoice);
//     const disbursementResult = await paydounyaService.submitDisburseInvoice(disburse_invoice);
    
//     //('📊 Réponse Paydunya:', disbursementResult);

//     // ✅ MODIFICATION: Vérifier le succès en incluant 'pending'
//     const isSuccess = disbursementResult.success && 
//       disbursementResult.data?.response_code === '00' && 
//       (disbursementResult.data?.status === 'completed' || 
//        disbursementResult.data?.status === 'success' ||
//        disbursementResult.data?.status === 'pending' ||  // ← Ajout du statut 'pending'
//        disbursementResult.data?.description?.includes('Success'));

//     if (!isSuccess) {
//       return res.status(400).json({
//         success: false,
//         message: disbursementResult.data?.description || 'Transaction échouée',
//         paydunya_response: disbursementResult.data
//       });
//     }

//     // Supprimer l'OTP
//     delete otpStore[normalizedId];

//     // ✅ MODIFICATION: Déterminer le statut de la transaction
//     let transactionStatus = 'completed';
//     if (disbursementResult.data?.status === 'pending') {
//       transactionStatus = 'pending';
//     }

//     // Créer la transaction
//     const transaction = new Transaction({
//       type: 'dividend_withdrawal',
//       amount: otpData.amount,
//       userId: actionnaireId,
//       recipientPhone: otpData.phoneNumber,
//       paymentMethod: otpData.paymentMethod,
//       status: transactionStatus,  // ← Utiliser le statut dynamique
//       description: `Retrait dividendes ${otpData.amount} FCFA`,
//       reference: otpData.reference,
//       id_transaction: generateIdTransaction(),
//       paydounyaTransactionId: disburse_invoice,
//       paydounyaReferenceId: disbursementResult.data?.transaction_id, // ← Ajouter l'ID Paydunya
//       token: crypto.randomBytes(16).toString('hex')
//     });
    
//     await transaction.save();
//     //('✅ Transaction créée:', transaction._id);

//     // Mettre à jour les dividendes
//     const newDividend = Math.max(0, currentDividend - otpData.amount);
//     actionnaire.dividende = newDividend;
//     await actionnaire.save();
    
//     //(`💰 Dividendes mis à jour: ${currentDividend} → ${newDividend}`);

//     // ✅ MODIFICATION: Message adapté selon le statut
//     const responseMessage = transactionStatus === 'pending' 
//       ? 'Retrait en cours de traitement' 
//       : 'Retrait confirmé avec succès';

//     return res.json({
//       success: true,
//       message: responseMessage,
//       transaction: {
//         id: transaction._id,
//         reference: transaction.reference,
//         amount: otpData.amount,
//         status: transactionStatus,
//         paydunya_transaction_id: disbursementResult.data?.transaction_id
//       },
//       dividends: {
//         previous: currentDividend,
//         withdrawn: otpData.amount,
//         remaining: newDividend
//       }
//     });
    
//   } catch (error) {
//     console.error('❌ Erreur confirmation:', error);
//     return res.status(500).json({ 
//       success: false, 
//       message: 'Erreur serveur',
//       error: error.message
//     });
//   }
// };




// Fonction utilitaire pour normaliser les IDs (à ajouter si pas déjà présente)
const normalizeId = (id) => {
  return id.toString();
};

/**
 * Mapper les méthodes de paiement vers leurs équivalents payout
 * DiokoLink semble utiliser les MÊMES codes pour payment et payout
 */
const mapToPayoutMethod = (paymentMethod) => {
  // Normaliser: remplacer les tirets par des underscores
  const normalized = paymentMethod.toLowerCase().replace(/-/g, '_');

  // Mapping des méthodes de paiement DiokoLink
  // Format: {frontend} -> {diokolink API PAYOUT codes}
  // Codes officiels DiokoLink avec suffixe _payout_paydunya
  const payoutMapping = {
    // ===== SÉNÉGAL =====
    'wave_senegal': 'wave_sn_payout_paydunya',
    'orange_money_senegal': 'om_sn_payout_paydunya',
    'free_money_senegal': 'free_sn_payout_paydunya',
    'wizall_money_senegal': 'free_sn_payout_paydunya', // Wizall non disponible en payout
    'expresso_senegal': 'free_sn_payout_paydunya', // Fallback vers Free

    // ===== CÔTE D'IVOIRE =====
    'wave_ci': 'wave_ci_payout_paydunya',
    'orange_money_ci': 'om_ci_payout_paydunya',
    'mtn_ci': 'mtn_ci_payout_paydunya',
    'moov_ci': 'moov_ci_payout_paydunya',

    // ===== BURKINA FASO =====
    'orange_money_burkina': 'om_bf_payout_paydunya',
    'moov_burkina_faso': 'moov_bf_payout_paydunya',

    // ===== BÉNIN =====
    'mtn_benin': 'mtn_bj_payout_paydunya',
    'moov_benin': 'moov_bj_payout_paydunya',

    // ===== TOGO =====
    't_money_togo': 'tmoney_tg_payout_paydunya',
    'moov_togo': 'moov_tg_payout_paydunya',

    // ===== MALI =====
    'orange_money_mali': 'om_ml_payout_paydunya',
    'moov_mali': 'moov_ml_payout_paydunya',

    // ===== FORMATS ALTERNATIFS =====
    'wave_sn': 'wave_sn_payout_paydunya',
    'orange_money_sn': 'om_sn_payout_paydunya',
    'om_sn': 'om_sn_payout_paydunya',
    'free_money_sn': 'free_sn_payout_paydunya',

    // Formats courts (Sénégal par défaut)
    'wave': 'wave_sn_payout_paydunya',
    'orange': 'om_sn_payout_paydunya',
    'orange_money': 'om_sn_payout_paydunya',
    'free': 'free_sn_payout_paydunya',
    'free_money': 'free_sn_payout_paydunya'
  };

  // Retourner la méthode mappée ou la version normalisée
  return payoutMapping[normalized] || normalized;
};
exports.confirmDividendWithdrawal = async (req, res) => {
  try {
    const { disburse_invoice } = req.body;
    const actionnaireId = req.user.id;

    if (!disburse_invoice) {
      return res.status(400).json({
        success: false, 
        message: 'disburse_invoice requis'
      });
    }

    // Vérifier l'actionnaire
    const actionnaire = await User.findById(actionnaireId);
    if (!actionnaire || actionnaire.role !== 'actionnaire') {
      return res.status(403).json({
        success: false,
        message: 'Accès non autorisé'
      });
    }

    // ✅ DIOKOLINK: Vérifier le statut du paiement
    const disbursementResult = await checkPaymentStatus(disburse_invoice);

    if (!disbursementResult.success) {
      return res.status(400).json({
        success: false,
        message: disbursementResult.error || 'Erreur vérification DiokoLink',
        diokolink_response: disbursementResult
      });
    }

    // Déterminer le statut de la transaction
    let transactionStatus = 'completed';
    if (disbursementResult.transaction?.status === 'pending') {
      transactionStatus = 'pending';
    } else if (disbursementResult.transaction?.status === 'success') {
      transactionStatus = 'completed';
    } else if (disbursementResult.transaction?.status === 'failed') {
      return res.status(400).json({
        success: false,
        message: 'Transaction échouée',
        diokolink_response: disbursementResult
      });
    }

    // Récupérer la transaction existante par disburse_invoice
    const transaction = await Transaction.findOne({
      paydounyaTransactionId: disburse_invoice,
      userId: actionnaireId
    });

    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: 'Transaction non trouvée'
      });
    }

    // Mettre à jour le statut de la transaction
    transaction.status = transactionStatus;
    transaction.paydounyaReferenceId = disbursementResult.transaction?.transaction_id || disburse_invoice;
    await transaction.save();

    // Récupérer le solde actuel
    const currentDividend = actionnaire.dividende || 0;

    // Message adapté selon le statut
    const responseMessage = transactionStatus === 'pending'
      ? 'Retrait en cours de traitement'
      : 'Retrait confirmé avec succès';

    return res.json({
      success: true,
      message: responseMessage,
      transaction: {
        id: transaction._id,
        reference: transaction.reference,
        amount: transaction.amount,
        status: transactionStatus,
        diokolink_transaction_id: disbursementResult.transaction?.transaction_id || disburse_invoice
      },
      dividends: {
        current: currentDividend
      }
    });
    
  } catch (error) {
    console.error('❌ Erreur confirmation:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Erreur serveur',
      error: error.message
    });
  }
};

exports.initiateDividendWithdrawal = async (req, res) => {
  try {
    const { phoneNumber, amount, paymentMethod } = req.body;
    const actionnaireId = req.user.id;

    // Vérifications de base
    if (!phoneNumber || !amount || !paymentMethod) {
      return res.status(400).json({ 
        success: false, 
        message: 'Paramètres manquants' 
      });
    }

    // Validation du montant
    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      return res.status(400).json({ 
        success: false, 
        message: 'Montant invalide' 
      });
    }

    // Récupérer l'actionnaire
    const actionnaire = await User.findById(actionnaireId);
    if (!actionnaire || actionnaire.role !== 'actionnaire') {
      return res.status(403).json({ 
        success: false, 
        message: 'Accès non autorisé' 
      });
    }

    // Vérification renforcée du solde disponible
    const availableDividend = parseFloat(actionnaire.dividende) || 0;

    // VÉRIFICATION CRITIQUE : Solde insuffisant
    if (availableDividend < parsedAmount) {
      return res.status(400).json({ 
        success: false, 
        message: `Solde insuffisant. Disponible: ${availableDividend.toLocaleString()} FCFA, Demandé: ${parsedAmount.toLocaleString()} FCFA`,
        error_type: 'insufficient_balance',
        data: {
          available_amount: availableDividend,
          requested_amount: parsedAmount,
          shortage: parsedAmount - availableDividend
        }
      });
    }

    // Vérification d'un montant minimum (optionnel)
    const minimumAmount = 100;
    
    if (parsedAmount < minimumAmount) {
      return res.status(400).json({ 
        success: false, 
        message: `Montant minimum requis: ${minimumAmount} FCFA`,
        error_type: 'minimum_amount_not_met',
        data: {
          requested_amount: parsedAmount,
          minimum_required: minimumAmount
        }
      });
    }

    // Double vérification avant l'appel Paydunya
    let finalCheck;
    try {
      finalCheck = await User.findById(actionnaireId);
    } catch (dbError) {
      console.error('❌ Erreur lors de la double vérification DB:', dbError);
      return res.status(500).json({ 
        success: false, 
        message: 'Erreur lors de la vérification du solde',
        error_type: 'database_error'
      });
    }

    if (!finalCheck) {
      return res.status(404).json({ 
        success: false, 
        message: 'Utilisateur non trouvé',
        error_type: 'user_not_found'
      });
    }

    const currentDividend = parseFloat(finalCheck.dividende) || 0;
    
    // DOUBLE VÉRIFICATION CRITIQUE : Protection contre les modifications concurrentes
    if (currentDividend < parsedAmount) {
      return res.status(400).json({ 
        success: false, 
        message: 'Solde modifié pendant la transaction. Veuillez réessayer.',
        error_type: 'balance_changed_insufficient',
        data: {
          current_balance: currentDividend,
          requested_amount: parsedAmount,
          shortage: parsedAmount - currentDividend
        }
      });
    }

    // ✅ DIOKOLINK: Initialiser le décaissement
    const reference = `DIV-${actionnaireId.toString().slice(-6)}-${Date.now()}`;

    // Mapper la méthode de paiement vers sa version payout
    const payoutMethod = mapToPayoutMethod(paymentMethod);

    console.log('🔍 DEBUG PAYOUT:', {
      original_method: paymentMethod,
      mapped_method: payoutMethod,
      phoneNumber,
      amount: parsedAmount
    });

    const metadata = {
      user_id: actionnaireId.toString(),
      transaction_type: 'dividend_withdrawal',
      user_info: {
        nom: `${actionnaire.firstName} ${actionnaire.lastName}`,
        telephone: actionnaire.telephone
      },
      original_payment_method: paymentMethod
    };

    let disbursementResult;
    try {
      disbursementResult = await initializePayout(
        phoneNumber,
        parsedAmount,
        payoutMethod, // ← Utiliser la méthode payout mappée
        reference,
        metadata
      );

    } catch (diokolinkError) {
      console.error('❌ Erreur lors de l\'appel DiokoLink:', diokolinkError);
      return res.status(400).json({
        success: false,
        message: `Erreur technique DiokoLink: ${diokolinkError.message}`,
        error_type: 'diokolink_call_failed'
      });
    }

    // Vérification détaillée de la réponse DiokoLink
    if (!disbursementResult || !disbursementResult.success) {
      console.error('❌ Échec DiokoLink:', disbursementResult);
      return res.status(400).json({
        success: false,
        message: disbursementResult?.error || 'Erreur lors du décaissement',
        error_type: 'diokolink_failed',
        diokolink_response: disbursementResult
      });
    }

    const transaction_id = disbursementResult.transaction_id;

    if (!transaction_id) {
      console.error('❌ transaction_id manquant dans la réponse:', disbursementResult);
      return res.status(400).json({
        success: false,
        message: 'Réponse DiokoLink incomplète - transaction_id manquant',
        error_type: 'missing_transaction_id',
        diokolink_response: disbursementResult
      });
    }

    // Déterminer le statut de la transaction
    let transactionStatus = 'pending';
    if (disbursementResult.status === 'success') {
      transactionStatus = 'completed';
    } else if (disbursementResult.status === 'pending') {
      transactionStatus = 'pending';
    }

    // ✅ Créer la transaction DiokoLink
    const transaction = new Transaction({
      type: 'dividend_withdrawal',
      amount: parsedAmount,
      userId: actionnaireId,
      recipientPhone: phoneNumber,
      paymentMethod: paymentMethod,
      withdraw_mode: paymentMethod,
      status: transactionStatus,
      description: `Retrait dividendes ${parsedAmount} FCFA`,
      reference: reference,
      id_transaction: generateIdTransaction(),
      paydounyaTransactionId: transaction_id, // DiokoLink transaction_id
      paydounyaReferenceId: transaction_id, // DiokoLink transaction_id
      token: crypto.randomBytes(16).toString('hex')
    });
    
    await transaction.save();

    // Mettre à jour les dividendes
    const newDividend = Math.max(0, currentDividend - parsedAmount);
    actionnaire.dividende = newDividend;
    await actionnaire.save();

    // Message adapté selon le statut
    const responseMessage = transactionStatus === 'pending' 
      ? 'Retrait en cours de traitement' 
      : 'Retrait confirmé avec succès';

    return res.json({
      success: true,
      message: responseMessage,
      transaction: {
        id: transaction._id,
        reference: transaction.reference,
        amount: parsedAmount,
        status: transactionStatus,
        diokolink_transaction_id: transaction_id
      },
      dividends: {
        previous: currentDividend,
        withdrawn: parsedAmount,
        remaining: newDividend
      }
    });

  } catch (error) {
    console.error('❌ Erreur:', error);
    return res.status(500).json({
      success: false,
      message: 'Erreur serveur',
      error: error.message
    });
  }
};

module.exports.initiateDividendWithdrawalAdmin = async (req, res) => {
  try {
    const { phoneNumber, amount, paymentMethod } = req.body;
    const actionnaireId = req.user.id;

    // Vérifications de base
    if (!phoneNumber || !amount || !paymentMethod) {
      return res.status(400).json({
        success: false,
        message: 'Paramètres manquants'
      });
    }

    // Validation du montant
    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Montant invalide'
      });
    }

    // Récupérer l'utilisateur pour les métadonnées
    const user = await User.findById(actionnaireId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Utilisateur non trouvé'
      });
    }

    // ✅ DIOKOLINK: Initialiser le décaissement Admin
    const reference = `DIV-ADMIN-${actionnaireId.toString().slice(-6)}-${Date.now()}`;

    // Mapper la méthode de paiement vers sa version payout
    const payoutMethod = mapToPayoutMethod(paymentMethod);

    const metadata = {
      user_id: actionnaireId.toString(),
      transaction_type: 'dividend_withdrawal_admin',
      user_info: {
        nom: `${user.firstName} ${user.lastName}`,
        telephone: user.telephone
      },
      original_payment_method: paymentMethod
    };

    let disbursementResult;
    try {
      disbursementResult = await initializePayout(
        phoneNumber,
        parsedAmount,
        payoutMethod, // ← Utiliser la méthode payout mappée
        reference,
        metadata
      );

    } catch (diokolinkError) {
      console.error('❌ Erreur lors de l\'appel DiokoLink:', diokolinkError);
      return res.status(400).json({
        success: false,
        message: `Erreur technique DiokoLink: ${diokolinkError.message}`,
        error_type: 'diokolink_call_failed'
      });
    }

    // Vérification détaillée de la réponse DiokoLink
    if (!disbursementResult || !disbursementResult.success) {
      console.error('❌ Échec DiokoLink:', disbursementResult);
      return res.status(400).json({
        success: false,
        message: disbursementResult?.error || 'Erreur lors du décaissement',
        error_type: 'diokolink_failed',
        diokolink_response: disbursementResult
      });
    }

    const transaction_id = disbursementResult.transaction_id;

    if (!transaction_id) {
      console.error('❌ transaction_id manquant dans la réponse:', disbursementResult);
      return res.status(400).json({
        success: false,
        message: 'Réponse DiokoLink incomplète - transaction_id manquant',
        error_type: 'missing_transaction_id',
        diokolink_response: disbursementResult
      });
    }

    // Déterminer le statut de la transaction
    let transactionStatus = 'pending';
    if (disbursementResult.status === 'success') {
      transactionStatus = 'completed';
    } else if (disbursementResult.status === 'pending') {
      transactionStatus = 'pending';
    }

    // Créer la transaction
    const transaction = new Transaction({
      type: 'dividend_withdrawal',
      amount: parsedAmount,
      userId: actionnaireId,
      recipientPhone: phoneNumber,
      paymentMethod: paymentMethod,
      status: transactionStatus,
      description: `Retrait dividendes ${parsedAmount} FCFA (Admin)`,
      reference: reference,
      id_transaction: generateIdTransaction(),
      paydounyaTransactionId: transaction_id,
      paydounyaReferenceId: transaction_id,
      token: crypto.randomBytes(16).toString('hex')
    });

    await transaction.save();

    // Message adapté selon le statut
    const responseMessage = transactionStatus === 'pending'
      ? 'Retrait en cours de traitement'
      : 'Retrait confirmé avec succès';

    return res.json({
      success: true,
      message: responseMessage,
      transaction: {
        id: transaction._id,
        reference: transaction.reference,
        amount: parsedAmount,
        status: transactionStatus,
        diokolink_transaction_id: transaction_id
      }
    });

  } catch (error) {
    console.error('❌ Erreur:', error);
    return res.status(500).json({
      success: false,
      message: 'Erreur serveur',
      error: error.message
    });
  }
};


module.exports.confirmDividendWithdrawalAdmin = async (req, res) => {
  try {
    const { disburse_invoice } = req.body;
    const actionnaireId = req.user.id;

    if (!disburse_invoice) {
      return res.status(400).json({
        success: false,
        message: 'disburse_invoice requis'
      });
    }

    // ✅ DIOKOLINK: Vérifier le statut du paiement
    const disbursementResult = await checkPaymentStatus(disburse_invoice);

    if (!disbursementResult.success) {
      return res.status(400).json({
        success: false,
        message: disbursementResult.error || 'Erreur vérification DiokoLink',
        diokolink_response: disbursementResult
      });
    }

    // Déterminer le statut de la transaction
    let transactionStatus = 'completed';
    if (disbursementResult.transaction?.status === 'pending') {
      transactionStatus = 'pending';
    } else if (disbursementResult.transaction?.status === 'success') {
      transactionStatus = 'completed';
    } else if (disbursementResult.transaction?.status === 'failed') {
      return res.status(400).json({
        success: false,
        message: 'Transaction échouée',
        diokolink_response: disbursementResult
      });
    }

    // Récupérer la transaction existante par disburse_invoice
    const transaction = await Transaction.findOne({
      paydounyaTransactionId: disburse_invoice,
      userId: actionnaireId
    });

    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: 'Transaction non trouvée'
      });
    }

    // Mettre à jour le statut de la transaction
    transaction.status = transactionStatus;
    transaction.paydounyaReferenceId = disbursementResult.transaction?.transaction_id || disburse_invoice;
    await transaction.save();

    // Message adapté selon le statut
    const responseMessage = transactionStatus === 'pending'
      ? 'Retrait en cours de traitement'
      : 'Retrait confirmé avec succès';

    return res.json({
      success: true,
      message: responseMessage,
      transaction: {
        id: transaction._id,
        reference: transaction.reference,
        amount: transaction.amount,
        status: transactionStatus,
        diokolink_transaction_id: disbursementResult.transaction?.transaction_id || disburse_invoice
      },
    });

  } catch (error) {
    console.error('❌ Erreur confirmation:', error);
    return res.status(500).json({
      success: false,
      message: 'Erreur serveur',
      error: error.message
    });
  }
};
/**
 * Obtenir le solde de dividendes d'un actionnaire
 */
exports.getDividendBalance = async (req, res) => {
  try {
    const actionnaireId = req.user.id;
    
    const actionnaire = await User.findById(actionnaireId);
    if (!actionnaire) {
      return res.status(404).json({ 
        success: false, 
        message: 'Actionnaire non trouvé' 
      });
    }

    if (actionnaire.role !== 'actionnaire') {
      return res.status(403).json({ 
        success: false, 
        message: 'Seuls les actionnaires peuvent consulter leurs dividendes' 
      });
    }

    // Récupérer l'historique des retraits
    const withdrawalHistory = await Transaction.find({
      userId: actionnaireId,
      type: 'dividend_withdrawal',
      status: 'completed'
    }).sort({ createdAt: -1 }).limit(10);

    // Calculer le total retiré
    const totalWithdrawn = withdrawalHistory.reduce((sum, transaction) => sum + transaction.amount, 0);

    // Récupérer les infos de l'entreprise
    const entreprise = await Entreprise.findOne().sort({ annee: -1 });

    return res.json({
      success: true,
      actionnaire: {
        id: actionnaire._id,
        firstName: actionnaire.firstName,
        lastName: actionnaire.lastName,
        telephone: actionnaire.telephone,
        nbre_actions: actionnaire.nbre_actions,
        dividende_disponible: actionnaire.dividende || 0,
        total_retiré: totalWithdrawn
      },
      entreprise: entreprise ? {
        annee: entreprise.annee,
        total_benefice: entreprise.total_benefice
      } : null,
      historique_retraits: withdrawalHistory,
      formule_dividende: "dividende = benefice * nbre_actions / 100000"
    });

  } catch (error) {
    console.error('❌ Erreur récupération dividendes:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Erreur lors de la récupération des dividendes',
      error: error.message
    });
  }
};
exports.getDividendWithdrawalHistory = async (req, res) => {
  try {
    const actionnaireId = req.user.id;
    const { page = 1, limit = 20 } = req.query;

    const actionnaire = await User.findById(actionnaireId);
    if (!actionnaire || actionnaire.role !== 'actionnaire') {
      return res.status(403).json({ 
        success: false, 
        message: 'Accès non autorisé' 
      });
    }

    const withdrawals = await Transaction.find({
      userId: actionnaireId,
      type: 'dividend_withdrawal'
    })
    .sort({ createdAt: -1 })
    .limit(limit * 1)
    .skip((page - 1) * limit);

    const totalWithdrawals = await Transaction.countDocuments({
      userId: actionnaireId,
      type: 'dividend_withdrawal'
    });

    const totalAmount = await Transaction.aggregate([
      { $match: { userId: actionnaireId, type: 'dividend_withdrawal', status: 'completed' } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);

    return res.json({
      success: true,
      withdrawals,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(totalWithdrawals / limit),
        totalWithdrawals,
        limit: parseInt(limit)
      },
      statistics: {
        totalAmountWithdrawn: totalAmount[0]?.total || 0,
        currentDividendBalance: actionnaire.dividende || 0
      }
    });

  } catch (error) {
    console.error('❌ Erreur historique retraits:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Erreur lors de la récupération de l\'historique',
      error: error.message
    });
  }
};

module.exports.getTransactions = async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    
    //('🔍 Récupération transactions:', { userId, userRole });

    // Vérifier l'utilisateur
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Utilisateur introuvable'
      });
    }

    if (!['admin', 'actionnaire'].includes(user.role)) {
      return res.status(403).json({
        success: false,
        message: 'Accès non autorisé'
      });
    }

    // Construire le filtre selon le rôle
    let filter = {};
    
    // Si actionnaire, il ne voit que ses propres transactions
    if (user.role === 'actionnaire') {
      filter.userId = userId;
    }
    // Si admin, il voit toutes les transactions (pas de filtre)

    //('🔎 Filtre appliqué:', filter);

    // Récupérer les transactions
    const transactions = await Transaction.find(filter)
      .populate('userId', 'nom prenom email telephone')
      .sort({ createdAt: -1 })
      .lean();

    //(`✅ ${transactions.length} transactions récupérées`);

    return res.json({
      success: true,
      data: transactions,
      userRole: user.role,
      message: `${transactions.length} transaction(s) récupérée(s)`
    });

  } catch (error) {
    console.error('❌ Erreur récupération transactions:', error);
    return res.status(500).json({
      success: false,
      message: 'Erreur serveur',
      error: error.message
    });
  }
};