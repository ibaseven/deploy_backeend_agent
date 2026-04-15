const User = require('../Models/User');
const Transaction = require('../Models/Transaction');
const Entreprise = require('../Models/Entreprise');
const { sendWhatsAppMessage } = require('../Controller/UserControler');
const Price = require('../Models/Price'); // Ajustez le chemin
const VIPUser = require('../Models/VIPUser'); // Ajustez le chemin
const { sendWhatsAppMessageSafe } = require('./actionsPurchaseController');
const { generateContractPDF } = require('../Services/contractGenerator');
const qs = require("qs");
const AWS = require("aws-sdk");
const s3 = new AWS.S3({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION,
});

const uploadPDFToS3 = async function (pdfBuffer, fileName) {
  const s3Key = `contrats/${fileName}`;

  const params = {
    Bucket: process.env.AWS_BUCKET_NAME,
    Key: s3Key,
    Body: pdfBuffer,
    ContentType: "application/pdf",
  };

  await s3.putObject(params).promise();

  // URL propre accessible publiquement
  const cleanUrl = `https://${process.env.AWS_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${s3Key}`;

  return {
    cleanUrl,
    s3Key,
  };
};
 // Assure-toi du bon chemin
// Prix fixe par action (comme dans votre système PayDunya)

// Fonction pour calculer les dividendes
const calculateDividende = async (nbre_actions) => {
  try {
    const entreprise = await Entreprise.findOne().sort({ annee: -1 });
    
    if (!entreprise) {
      //('Aucune entreprise trouvée pour le calcul des dividendes');
      return 0;
    }

    const dividende = (entreprise.total_benefice * nbre_actions) / 100000;
    return dividende;
    
  } catch (error) {
    console.error('Erreur calcul dividende:', error);
    return 0;
  }
};

// Fonction pour générer un ID de transaction
const generateTransactionId = () => {
  return 'DIV_BUY_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
};

/**
 * Simuler un achat d'actions avec les dividendes
 */
exports.simulateActionsPurchaseWithDividends = async (req, res) => {
  try {
    const userId = req.user?.id || req.userData?.id;
    const { nombre_actions } = req.body;
    
    //('🧮 Simulation achat actions avec dividendes:', { userId, nombre_actions });

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Utilisateur non authentifié"
      });
    }

    // Validation du nombre d'actions
    if (!nombre_actions || nombre_actions <= 0) {
      return res.status(400).json({
        success: false,
        message: "Le nombre d'actions doit être supérieur à 0"
      });
    }

    if (nombre_actions > 1000) {
      return res.status(400).json({
        success: false,
        message: "Impossible d'acheter plus de 1000 actions à la fois avec les dividendes"
      });
    }

    // Récupérer l'utilisateur
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "Utilisateur non trouvé"
      });
    }

    // Vérifier que c'est un actionnaire
    if (user.role !== 'actionnaire') {
      return res.status(403).json({
        success: false,
        message: "Seuls les actionnaires peuvent acheter des actions avec leurs dividendes"
      });
    }

    // Vérifier que l'utilisateur n'est pas bloqué
    if (user.isBlocked) {
      return res.status(403).json({
        success: false,
        message: "Votre compte est bloqué. Contactez l'administrateur."
      });
    }

    // Calculer le coût total
    const montantTotal = nombre_actions * PRIX_UNITAIRE_ACTION;
    const dividendesActuels = user.dividende || 0;
    const actionsActuelles = user.nbre_actions || 0;

  ('💰 Vérification dividendes:', {
      dividendesActuels,
      montantTotal,
      deficit: montantTotal - dividendesActuels
    });

    // Vérifier si les dividendes sont suffisants
    if (dividendesActuels < montantTotal) {
      return res.status(400).json({
        success: false,
        message: `Dividendes insuffisants. Disponible: ${dividendesActuels.toLocaleString()} FCFA, Requis: ${montantTotal.toLocaleString()} FCFA`,
        data: {
          dividendes_actuels: dividendesActuels,
          montant_requis: montantTotal,
          deficit: montantTotal - dividendesActuels,
          nombre_actions_possibles: Math.floor(dividendesActuels / PRIX_UNITAIRE_ACTION)
        }
      });
    }

    // ✅ LOGIQUE SIMPLE : Dividendes après = Dividendes actuels - Montant utilisé
    const dividendesApres = dividendesActuels - montantTotal;
    const nouvelleQuantiteActions = actionsActuelles + nombre_actions;

    // Préparer la simulation
    const simulation = {
      achat_possible: true,
      cout_total: montantTotal,
      nombre_actions: nombre_actions,
      prix_unitaire: PRIX_UNITAIRE_ACTION,
      
      // Situation avant
      dividendes_avant: dividendesActuels,
      actions_avant: actionsActuelles,
      
      // Situation après (logique simple)
      dividendes_apres: dividendesApres,
      actions_apres: nouvelleQuantiteActions,
      
      // Résumé
      montant_utilise: montantTotal,
      gain_actions: nombre_actions,
      perte_dividendes: montantTotal,
      
      type_calcul: 'simple',
      explication: `Dividendes après achat = ${dividendesActuels} - ${montantTotal} = ${dividendesApres}`
    };

    //('📊 Simulation résultats:', simulation);

    return res.status(200).json({
      success: true,
      message: "Simulation d'achat d'actions avec dividendes (logique simple)",
      simulation,
      user_info: {
        nom: `${user.firstName} ${user.lastName}`,
        telephone: user.telephone,
        actions_actuelles: actionsActuelles,
        dividendes_actuels: dividendesActuels
      }
    });

  } catch (error) {
    console.error('❌ Erreur simulation achat actions:', error);
    res.status(500).json({
      success: false,
      message: "Erreur lors de la simulation",
      error: error.message
    });
  }
};

/**
 * Acheter des actions avec les dividendes
 */



const calculateActionPrice = async (userId) => {
  try {
    const user = await User.findById(userId);
    if (!user) throw new Error("Utilisateur introuvable pour le calcul du prix");

    // Vérifier si l'utilisateur est VIP dans la base de données
    const isVIP = await VIPUser.findOne({ 
      telephone: user.telephone, 
      actif: true 
    });

    // Déterminer le type de prix
    const priceType = isVIP ? 'VIP' : 'NORMAL';

    // Récupérer le prix depuis la base de données
    const priceData = await Price.findOne({ type: priceType, actif: true });
    
    if (!priceData) {
      throw new Error(`Prix ${priceType} non trouvé ou inactif dans la base de données`);
    }

    return {
      prix_unitaire: priceData.prix_unitaire,
      currency: priceData.currency || "XOF",
      type: priceType,
      is_vip: !!isVIP,
      entreprise_annee: new Date().getFullYear(),
      derniere_mise_a_jour: new Date(),
    };
  } catch (error) {
    console.error("❌ Erreur lors du calcul du prix :", error);
    throw error;
  }
};

exports.purchaseActionsWithDividends = async (req, res) => {
  try {
    const userId = req.user?.id || req.userData?.id;
    let { nombre_actions } = req.body;

    if (!userId) return res.status(401).json({ success: false, message: "Utilisateur non authentifié" });
    if (!nombre_actions || nombre_actions <= 0) return res.status(400).json({ success: false, message: "Le nombre d'actions doit être supérieur à 0" });

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ success: false, message: "Utilisateur non trouvé" });
    if (user.role !== 'actionnaire') return res.status(403).json({ success: false, message: "Seuls les actionnaires peuvent acheter des actions avec leurs dividendes" });
    if (user.isBlocked) return res.status(403).json({ success: false, message: "Votre compte est bloqué. Contactez l'administrateur." });

    const pricingInfo = await calculateActionPrice(userId);
    const PRIX_UNITAIRE_ACTION = pricingInfo.prix_unitaire;

    const dividendesActuels = user.dividende || 0;
    const actionsActuelles = user.nbre_actions || 0;

    const maxActionsAchetables = Math.floor(dividendesActuels / PRIX_UNITAIRE_ACTION);
    if (maxActionsAchetables === 0) {
      return res.status(400).json({
        success: false,
        message: `Dividendes insuffisants pour acheter même une action. Disponible: ${dividendesActuels.toLocaleString()} FCFA`,
        data: { dividendes_actuels: dividendesActuels, prix_unitaire: PRIX_UNITAIRE_ACTION }
      });
    }

    if (nombre_actions > maxActionsAchetables) nombre_actions = maxActionsAchetables;

    const montantTotal = nombre_actions * PRIX_UNITAIRE_ACTION;
    const dividendesApres = dividendesActuels - montantTotal;
    const nouvelleQuantiteActions = actionsActuelles + nombre_actions;

    const transaction = new Transaction({
      type: 'dividend_purchase',
      amount: montantTotal,
      userId,
      recipientPhone: user.telephone,
      paymentMethod: 'dividendes',
      status: 'completed',
      description: `Achat de ${nombre_actions} actions avec dividendes`,
      reference: generateTransactionId(),
      id_transaction: generateTransactionId(),
      token: require('crypto').randomBytes(16).toString('hex'),
      metadata: {
        nombre_actions,
        prix_unitaire: PRIX_UNITAIRE_ACTION,
        dividendes_avant: dividendesActuels,
        dividendes_apres: dividendesApres,
        actions_avant: actionsActuelles,
        actions_apres: nouvelleQuantiteActions,
        type_calcul: 'auto_max'
      }
    });

    await transaction.save();
    await User.findByIdAndUpdate(userId, { nbre_actions: nouvelleQuantiteActions, dividende: dividendesApres });

   try {
  console.log("📄 Génération du contrat PDF...");
 const purchaseData = {
    nombre_actions: nombre_actions,  // Actions achetées maintenant
    prix_unitaire: PRIX_UNITAIRE_ACTION,
    montant_total: montantTotal,
    transaction_id: transaction._id,
    reference: transaction.reference,
    date: new Date()
  };
  const pdfBuffer = await generateContractPDF(purchaseData,user);

  const fileName = `ContratActions_${transaction._id}_${Date.now()}.pdf`;
  const pdfResult = await uploadPDFToS3(pdfBuffer, fileName);
  const pdfUrl = pdfResult.cleanUrl || pdfResult;

  console.log("✅ PDF uploadé sur S3:", pdfUrl);

  await sendWhatsAppMessageSafe(
    user.telephone,
    `Félicitations ${user.firstName} !
Voici le lien pour télécharger votre contrat d'actions officiel :
${pdfUrl}

Voici votre contrat d'actions officiel.
Actions : ${nombre_actions.toLocaleString()}
Montant : ${montantTotal.toLocaleString()} FCFA

Merci pour votre confiance !`
  );

  console.log("✅ Contrat PDF envoyé par WhatsApp");
} catch (pdfError) {
  console.error("❌ Erreur envoi contrat PDF:", pdfError.message);
}
const purchaseData = {
    nombre_actions: nombre_actions,  // Actions achetées maintenant
    prix_unitaire: PRIX_UNITAIRE_ACTION,
    montant_total: montantTotal,
    transaction_id: transaction._id,
    reference: transaction.reference,
    date: new Date()
  };
        const adminMessage = `
Client : ${user.firstName} ${user.lastName}
Téléphone : ${user.telephone}
Email : ${user.email}
Nombre d'actions : ${purchaseData.nombre_actions.toLocaleString()}
Montant total : ${purchaseData.montant_total.toLocaleString()} FCFA
`;
try {
          const response = await sendWhatsAppMessageSafe(
            "+221773878232",
            adminMessage
          );
        } catch (err) {
          console.error("❌ ERREUR lors de l'envoi du message WhatsApp admin");
          console.error("📛 Code erreur :", err.code || "N/A");
          console.error("📛 Détails :", err.message);
          console.error("📛 Stack error :", err.stack);
        }

    return res.status(200).json({
      success: true,
      message: "Achat d'actions avec dividendes réussi",
      transaction: {
        id: transaction._id,
        reference: transaction.reference,
        nombre_actions,
        montant_total: montantTotal,
        status: 'completed',
        date: transaction.createdAt
      },
      user_update: {
        actions_avant: actionsActuelles,
        actions_apres: nouvelleQuantiteActions,
        dividendes_avant: dividendesActuels,
        dividendes_apres: dividendesApres,
        gain_actions: nombre_actions,
        montant_utilise: montantTotal,
        prix_unitaire: PRIX_UNITAIRE_ACTION,
        calcul_type: 'auto_max'
      }
    });

  } catch (error) {
    console.error('❌ Erreur achat actions avec dividendes:', error);
    res.status(500).json({ success: false, message: "Erreur lors de l'achat d'actions", error: error.message });
  }
};




/**
 * Obtenir les options d'achat disponibles pour un actionnaire
 */
exports.getActionsPurchaseOptions = async (req, res) => {
  try {
    const userId = req.user?.id || req.userData?.id;
    
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Utilisateur non authentifié"
      });
    }

    // Récupérer l'utilisateur
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "Utilisateur non trouvé"
      });
    }

    if (user.role !== 'actionnaire') {
      return res.status(403).json({
        success: false,
        message: "Seuls les actionnaires peuvent voir ces options"
      });
    }

    if (user.isBlocked) {
      return res.status(403).json({
        success: false,
        message: "Votre compte est bloqué. Contactez l'administrateur."
      });
    }

    const dividendesActuels = user.dividende || 0;
    const actionsActuelles = user.nbre_actions || 0;
    const maxActionsAchetables = Math.floor(dividendesActuels / PRIX_UNITAIRE_ACTION);

   /*  //('💰 Calcul options d\'achat:', {
      utilisateur: `${user.firstName} ${user.lastName}`,
      dividendesActuels,
      actionsActuelles,
      maxActionsAchetables
    }); */

    // Calculer des options d'achat
    const options = [];
    
    if (maxActionsAchetables > 0) {
      const quantities = [1, 5, 10, 25, 50, 100].filter(q => q <= maxActionsAchetables);
      
      for (const qty of quantities) {
        const cout = qty * PRIX_UNITAIRE_ACTION;
        const nouvelleQuantiteActions = actionsActuelles + qty;
        
        // ✅ LOGIQUE SIMPLE : Dividendes après = Dividendes actuels - Coût
        const dividendesApres = dividendesActuels - cout;
        
        options.push({
          nombre_actions: qty,
          cout_total: cout,
          actions_resultantes: nouvelleQuantiteActions,
          dividendes_apres: dividendesApres,
          type_calcul: 'simple',
          explication: `${dividendesActuels} - ${cout} = ${dividendesApres}`
        });
      }
      
      // Ajouter l'option "Maximum possible"
      if (maxActionsAchetables > 100) {
        const cout = maxActionsAchetables * PRIX_UNITAIRE_ACTION;
        const nouvelleQuantiteActions = actionsActuelles + maxActionsAchetables;
        const dividendesApres = dividendesActuels - cout;
        
        options.push({
          nombre_actions: maxActionsAchetables,
          cout_total: cout,
          actions_resultantes: nouvelleQuantiteActions,
          dividendes_apres: dividendesApres,
          type_calcul: 'simple',
          explication: `${dividendesActuels} - ${cout} = ${dividendesApres}`,
          is_maximum: true
        });
      }
    }

    return res.status(200).json({
      success: true,
      message: "Options d'achat d'actions avec dividendes",
      user_info: {
        nom: `${user.firstName} ${user.lastName}`,
        actions_actuelles: actionsActuelles,
        dividendes_actuels: dividendesActuels,
        max_actions_achetables: maxActionsAchetables
      },
      pricing: {
        prix_unitaire: PRIX_UNITAIRE_ACTION,
        currency: 'XOF'
      },
      options: options,
      conseils: {
        recommandation: maxActionsAchetables > 0 ? 
          "Vous pouvez acheter des actions avec vos dividendes" : 
          "Vos dividendes sont insuffisants pour acheter des actions",
        minimum_requis: PRIX_UNITAIRE_ACTION,
        actions_minimum: 1,
        logique: "Dividendes après achat = Dividendes actuels - Montant utilisé"
      }
    });

  } catch (error) {
    console.error('❌ Erreur récupération options:', error);
    res.status(500).json({
      success: false,
      message: "Erreur lors de la récupération des options",
      error: error.message
    });
  }
};

/**
 * Obtenir l'historique des achats d'actions avec dividendes
 */
exports.getDividendPurchaseHistory = async (req, res) => {
  try {
    const userId = req.user?.id || req.userData?.id;
    const { page = 1, limit = 20 } = req.query;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Utilisateur non authentifié"
      });
    }

    // Récupérer l'utilisateur
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "Utilisateur non trouvé"
      });
    }

    if (user.role !== 'actionnaire') {
      return res.status(403).json({
        success: false,
        message: "Seuls les actionnaires peuvent voir cet historique"
      });
    }

    // Récupérer les transactions
    const transactions = await Transaction.find({
      userId: userId,
      type: 'dividend_purchase'
    })
    .sort({ createdAt: -1 })
    .limit(limit * 1)
    .skip((page - 1) * limit);

    const totalTransactions = await Transaction.countDocuments({
      userId: userId,
      type: 'dividend_purchase'
    });

    // Calculer les statistiques
    const stats = await Transaction.aggregate([
      { $match: { userId: require('mongoose').Types.ObjectId(userId), type: 'dividend_purchase', status: 'completed' } },
      { 
        $group: { 
          _id: null, 
          total_montant: { $sum: '$amount' },
          total_actions: { $sum: '$metadata.nombre_actions' },
          nombre_achats: { $sum: 1 }
        } 
      }
    ]);

    const statistiques = stats.length > 0 ? stats[0] : {
      total_montant: 0,
      total_actions: 0,
      nombre_achats: 0
    };

    return res.status(200).json({
      success: true,
      message: "Historique des achats d'actions avec dividendes",
      transactions: transactions.map(t => ({
        id: t._id,
        reference: t.reference,
        nombre_actions: t.metadata?.nombre_actions || 0,
        montant_total: t.amount,
        prix_unitaire: t.metadata?.prix_unitaire || PRIX_UNITAIRE_ACTION,
        status: t.status,
        date: t.createdAt,
        dividendes_avant: t.metadata?.dividendes_avant || 0,
        dividendes_apres: t.metadata?.dividendes_apres || 0,
        actions_avant: t.metadata?.actions_avant || 0,
        actions_apres: t.metadata?.actions_apres || 0,
        type_calcul: t.metadata?.type_calcul || 'simple'
      })),
      pagination: {
        current_page: parseInt(page),
        total_pages: Math.ceil(totalTransactions / limit),
        total_transactions: totalTransactions,
        per_page: parseInt(limit)
      },
      statistiques: {
        total_montant_investi: statistiques.total_montant,
        total_actions_achetees: statistiques.total_actions,
        nombre_achats_effectues: statistiques.nombre_achats,
        montant_moyen_par_achat: statistiques.nombre_achats > 0 ? 
          Math.round(statistiques.total_montant / statistiques.nombre_achats) : 0
      },
      user_info: {
        nom: `${user.firstName} ${user.lastName}`,
        actions_actuelles: user.nbre_actions || 0,
        dividendes_actuels: user.dividende || 0
      }
    });

  } catch (error) {
    console.error('❌ Erreur récupération historique:', error);
    res.status(500).json({
      success: false,
      message: "Erreur lors de la récupération de l'historique",
      error: error.message
    });
  }
};

module.exports = {
  simulateActionsPurchaseWithDividends: exports.simulateActionsPurchaseWithDividends,
  purchaseActionsWithDividends: exports.purchaseActionsWithDividends,
  getActionsPurchaseOptions: exports.getActionsPurchaseOptions,
  getDividendPurchaseHistory: exports.getDividendPurchaseHistory
};


module.exports.buydividendeswithoseruser = async (req,re) => {
  try {
     const userId = req.user?.id || req.userData?.id;
    const {nbre_actions} = req.body
    const user = await User.findById()
  } catch (error) {
    
  }
}