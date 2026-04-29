// Controller/ActionsPurchaseController.js
const ActionsPurchase = require("../Models/ActionsPurchase");
const mongoose = require("mongoose");
const axios = require("axios");
const qs = require("qs");
const AWS = require("aws-sdk");
const User = require("../Models/User");
const InstallmentPurchase = require("../Models/InstallmentPurchase");
const ProjectInvestment = require("../Models/ProjectInvestment");
const { handleProjectInvestmentCallback } = require("../Controller/projectController");
const {
  calculateActionPrice,
  createPaydunyaInvoiceSN,     // ✅ PAYDUNYA
  verifyPaydunyaTransactionSN, // ✅ PAYDUNYA
  processPaymentCompletion,
  processPaymentFailure,
  calculateSalesStats,
} = require("../Services/actionsPurchaseService");
const {
  validatePartner,
  generateOTP,
  verifyOTP,
  checkRateLimit,
  hasUserReferredPartner,
} = require("../Utils/otp-utils");
// Import correct des fonctions WhatsApp depuis UserController
const userController = require("../Controller/UserControler");
const { generateContractPDF } = require("../Services/contractGenerator");
// const { createPaydunyaInvoiceCI } = require("../Services/actionpurchaci"); // Non utilisé
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
// Fonction pour envoyer des messages WhatsApp avec gestion d'erreurs
const sendWhatsAppMessageSafe = async (telephone, message) => {
  try {
    // Vérifier si la fonction existe dans UserController
    if (typeof userController.sendWhatsAppMessage === "function") {
      //console.log('📱 Envoi WhatsApp vers:', telephone);
      const result = await userController.sendWhatsAppMessage(
        telephone,
        message
      );
      //console.log('✅ WhatsApp envoyé avec succès');
      return result;
    } else {
      //console.log('⚠️ Fonction sendWhatsAppMessage non disponible dans UserController');
      //console.log('📱 Message qui devait être envoyé:', message);
      return null;
    }
  } catch (error) {
    console.error("❌ Erreur envoi WhatsApp:", error.message);
    //console.log('📱 Message qui devait être envoyé:', message);
    // Ne pas faire échouer la transaction à cause d'un problème WhatsApp
    return null;
  }
};

async function sendPDFWhatsApp(phoneNumber, pdfUrl, fileName, caption) {
  try {
    const data = qs.stringify({
      token: process.env.ULTRAMSG_TOKEN,
      to: phoneNumber.replace(/\D/g, ""),
      filename: fileName,
      document: pdfUrl,
      caption: caption,
    });

    const config = {
      method: "post",
      url: `https://api.ultramsg.com/${process.env.ULTRAMSG_INSTANCE_ID}/messages/document`,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      data: data,
    };

    const response = await axios(config);
    console.log("✅ PDF envoyé via WhatsApp !", response.data);
    return response.data;
  } catch (error) {
    console.error("❌ Erreur envoi PDF WhatsApp:", error.message);
    return null;
  }
}

// Envoie une image directement sur WhatsApp (preuve de paiement)
async function sendWhatsAppImageSafe(phoneNumber, imageUrl, caption) {
  try {
    const data = qs.stringify({
      token:   process.env.ULTRAMSG_TOKEN,
      to:      phoneNumber.replace(/\D/g, ''),
      image:   imageUrl,
      caption: caption || '',
    });
    const response = await axios({
      method: 'post',
      url:    `https://api.ultramsg.com/${process.env.ULTRAMSG_INSTANCE_ID}/messages/image`,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      data,
    });
    console.log('✅ Image WhatsApp envoyée :', response.data);
    return response.data;
  } catch (error) {
    console.error('❌ Erreur envoi image WhatsApp:', error.message);
    return null;
  }
}

// ✅ ÉTAPE 1: INITIER L'ACHAT D'ACTIONS (ENDPOINT PRINCIPAL)
const initiateActionsPurchase = async (req, res) => {
  try {
    const userId = req.user?.id || req.userData?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Utilisateur non authentifié",
      });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "Utilisateur non trouvé",
      });
    }

    if (user.isBlocked || user.status !== "active") {
      return res.status(403).json({
        success: false,
        message:
          "Votre compte est bloqué ou inactif. Contactez l'administrateur.",
      });
    }

    const { nombre_actions, telephonePartenaire: nouveauTelephonePartenaire } =
      req.body;

    if (
      !nombre_actions ||
      typeof nombre_actions !== "number" ||
      nombre_actions <= 0 ||
      nombre_actions > 1000000000
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Le nombre d'actions doit être un nombre supérieur à 0 et inférieur ou égal à 10000",
      });
    }

    // // ✅ PARRAINAGE DÉSACTIVÉ - Attribution de bonus partenaire commentée
     let telephonePartenaire =
      nouveauTelephonePartenaire || user.telephonePartenaire || null;
     let partenaireValide = null;
     let isFirstTimeWithPartner = false;
    const ipAddress = req.ip || req.connection.remoteAddress;
    const userAgent = req.headers["user-agent"];

     if (nouveauTelephonePartenaire) {
       if (!/^\+?[0-9]{8,15}$/.test(nouveauTelephonePartenaire)) {
       return res.status(400).json({
           success: false,
           message: "Le format du numéro de téléphone partenaire est invalide",
         });
       }
       const { isValid, partenaire } = await validatePartner(
         user._id,
         nouveauTelephonePartenaire
       );
       if (!isValid) {
         return res.status(400).json({
           success: false,
           message: "Partenaire invalide ou vous ne pouvez pas être votre propre partenaire",
         });
       }
       partenaireValide = partenaire;
       const hasReferredBefore = await hasUserReferredPartner(user._id, nouveauTelephonePartenaire);
       if (!hasReferredBefore) {
         isFirstTimeWithPartner = true;
       }
       try {
         user.telephonePartenaire = nouveauTelephonePartenaire;
         await user.save();
       } catch (saveError) {
         console.error("⚠️ Erreur sauvegarde utilisateur (non critique):", saveError.message);
       }
     } else if (user.telephonePartenaire) {
       const { isValid, partenaire } = await validatePartner(user._id, user.telephonePartenaire);
       if (isValid) {
         partenaireValide = partenaire;
         telephonePartenaire = user.telephonePartenaire;
       } else {
         telephonePartenaire = null;
       }
     }

    // ✅ Calcul du prix et création de la facture
    const pricingInfo = await calculateActionPrice(userId);
    const montantTotal = pricingInfo.prix_unitaire * nombre_actions;

    //console.log("💰 Prix unitaire:", pricingInfo.prix_unitaire);
    // console.log("💰 Montant total:", montantTotal);
   let paydunyaResponse;

// ✅ PAYDUNYA
paydunyaResponse = await createPaydunyaInvoiceSN(userId, nombre_actions, montantTotal);
if (!paydunyaResponse.success) {
  throw new Error("Erreur lors de la création de la facture PayDunya");
}

    

  

    // ✅ Créer la transaction
    const actionsPurchase = new ActionsPurchase({
      user_id: userId,
      paydunya_transaction_id: paydunyaResponse.token,
      invoice_token: paydunyaResponse.token,
      nombre_actions: nombre_actions,
      prix_unitaire: pricingInfo.prix_unitaire,
      montant_total: montantTotal,
      dividende_calculated: 0,
      status: "pending",
      telephonePartenaire: telephonePartenaire,   // PARRAINAGE DÉSACTIVÉ
       partenaireId: partenaireValide?._id || null, // PARRAINAGE DÉSACTIVÉ
       nouveauPartenaire: isFirstTimeWithPartner,   // PARRAINAGE DÉSACTIVÉ
      metadata: {
        pricing_info: pricingInfo,
        paydunya_response: paydunyaResponse,
        user_agent: userAgent,
        ip_address: ipAddress,
         premier_achat_avec_partenaire: isFirstTimeWithPartner, // PARRAINAGE DÉSACTIVÉ
        // bonus_info: ..., // PARRAINAGE DÉSACTIVÉ
      },
    });

    await actionsPurchase.save();



    return res.status(200).json({
      success: true,
      message: "Commande d'actions créée avec succès",
      payment_info: {
        transaction_id: paydunyaResponse.token,
        payment_url: paydunyaResponse.response_text,
        montant_total: montantTotal,
        currency: "XOF",
        nombre_actions: nombre_actions,
        prix_unitaire: pricingInfo.prix_unitaire,
        // bonus_partenaire: null, // PARRAINAGE DÉSACTIVÉ
      },
      redirect_url: paydunyaResponse.response_text,
    });
  } catch (error) {
    console.error("❌ Erreur initiation achat actions:", error);
    res.status(500).json({
      success: false,
      message: "Erreur lors de l'initiation de l'achat d'actions",
      error: error.message,
    });
  }
};
const ensureUserHasPartnerField = async (userId) => {
  try {
    const user = await User.findById(userId);
    if (!user) return null;

    // Vérifier si le champ existe
    if (!user.hasOwnProperty("telephonePartenaire")) {
     /*  console.log(
        `🔧 Ajout automatique du champ telephonePartenaire pour l'utilisateur ${userId}`
      ); */

      // Ajouter le champ avec une mise à jour atomique
      await User.findByIdAndUpdate(
        userId,
        { $set: { telephonePartenaire: null } },
        { new: true }
      );

      console.log(`✅ Champ telephonePartenaire ajouté automatiquement`);
    }

    return user;
  } catch (error) {
    console.error("❌ Erreur ajout automatique champ partenaire:", error);
    return null;
  }
};
const ensurePartnerFieldMiddleware = async (req, res, next) => {
  try {
    const userId = req.user?.id || req.userData?.id;

    if (userId) {
      await ensureUserHasPartnerField(userId);
    }

    next();
  } catch (error) {
    console.error("❌ Erreur middleware partner field:", error);
    next(); // Continuer même en cas d'erreur
  }
};
// ✅ RÉCUPÉRER LE PRIX ACTUEL DES ACTIONS

// ✅ HISTORIQUE DES ACHATS POUR L'UTILISATEUR CONNECTÉ (AVEC VERSEMENTS)
const getMyActionsPurchaseHistory = async (req, res) => {
  try {
    const userId = req.user?.id || req.userData?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Utilisateur non authentifié",
      });
    }

    const { page = 1, limit = 10, status } = req.query;

    // ==================================
    // 1. Récupérer les achats classiques
    // ==================================
    let query = { user_id: userId };
    if (status) {
      query.status = status;
    }

    const actionsPurchases = await ActionsPurchase.find(query).lean();

    // ==================================
    // 2. Récupérer les achats par versements
    // ==================================
    const installmentPurchases = await InstallmentPurchase.find({
      user_id: userId
    }).lean();

    console.log(`📊 Achats classiques trouvés: ${actionsPurchases.length}`);
    console.log(`📦 Contrats par versements trouvés: ${installmentPurchases.length}`);

    // ==================================
    // 3. Fusionner les transactions
    // ==================================
    let allTransactions = [];

    // Ajouter les achats classiques
    actionsPurchases.forEach((purchase) => {
      allTransactions.push({
        id: purchase._id,
        type: 'achat_direct',
        paydunya_transaction_id: purchase.paydunya_transaction_id,
        nombre_actions: purchase.nombre_actions,
        prix_unitaire: purchase.prix_unitaire,
        montant_total: purchase.montant_total,
        status: purchase.status,
        paydunya_status: purchase.paydunya_status,
        payment_method: purchase.payment_method,
        payment_date: purchase.payment_date,
        dividende_calculated: purchase.dividende_calculated,
        created_at: purchase.createdAt,
        updated_at: purchase.updatedAt,
      });
    });

    console.log(`✅ ${allTransactions.length} achats directs ajoutés`);

    // Ajouter les versements des achats échelonnés
    let versementsCount = 0;
    installmentPurchases.forEach((installment) => {
      console.log(`📋 Contrat ${installment._id}: ${installment.versements?.length || 0} versements`);

      if (installment.versements && Array.isArray(installment.versements)) {
        installment.versements.forEach((versement) => {
          versementsCount++;
          allTransactions.push({
            id: versement._id,
            type: 'versement',
            paydunya_transaction_id: versement.paydunya_transaction_id,
            nombre_actions: versement.nombre_actions_equivalent,
            prix_unitaire: installment.prix_unitaire,
            montant_total: versement.montant,
            status: 'completed',
            paydunya_status: 'completed',
            payment_method: versement.payment_method,
            payment_date: versement.payment_date,
            dividende_calculated: 0,
            created_at: versement.createdAt,
            updated_at: versement.createdAt,
            // Infos spécifiques aux versements
            installment_id: installment._id,
            installment_status: installment.status,
            installment_progress: `${installment.montant_paye.toLocaleString()} / ${installment.montant_total.toLocaleString()} FCFA`,
            installment_percentage: Math.round((installment.montant_paye / installment.montant_total) * 100),
          });
        });
      }
    });

    console.log(`💳 ${versementsCount} versements ajoutés`);
    console.log(`🔄 Total transactions: ${allTransactions.length}`);

    // ==================================
    // 4. Trier par date décroissante
    // ==================================
    allTransactions.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    // ==================================
    // 5. Pagination
    // ==================================
    const totalTransactions = allTransactions.length;
    const skip = (page - 1) * limit;
    const paginatedTransactions = allTransactions.slice(skip, skip + parseInt(limit));

    // ==================================
    // 6. Calculer les statistiques
    // ==================================

    // Stats achats classiques
    const statsClassiques = await ActionsPurchase.aggregate([
      { $match: { user_id: new mongoose.Types.ObjectId(userId) } },
      {
        $group: {
          _id: null,
          total_actions_achetees: {
            $sum: {
              $cond: [{ $eq: ["$status", "completed"] }, "$nombre_actions", 0],
            },
          },
          total_montant_depense: {
            $sum: {
              $cond: [{ $eq: ["$status", "completed"] }, "$montant_total", 0],
            },
          },
          nombre_transactions_completees: {
            $sum: {
              $cond: [{ $eq: ["$status", "completed"] }, 1, 0],
            },
          },
          nombre_transactions_en_attente: {
            $sum: {
              $cond: [{ $eq: ["$status", "pending"] }, 1, 0],
            },
          },
          nombre_transactions_echouees: {
            $sum: {
              $cond: [{ $in: ["$status", ["failed", "cancelled"]] }, 1, 0],
            },
          },
        },
      },
    ]);

    // Stats versements (achats complétés uniquement)
    const statsVersements = await InstallmentPurchase.aggregate([
      {
        $match: {
          user_id: new mongoose.Types.ObjectId(userId),
          status: 'complete'
        }
      },
      {
        $group: {
          _id: null,
          total_actions_achetees: { $sum: "$nombre_actions_total" },
          total_montant_depense: { $sum: "$montant_total" },
        },
      },
    ]);

    // Compter les versements (nombre de paiements effectués)
    let nombreVersements = 0;
    installmentPurchases.forEach(ip => {
      nombreVersements += ip.versements.length;
    });

    const statsClassiquesData = statsClassiques[0] || {
      total_actions_achetees: 0,
      total_montant_depense: 0,
      nombre_transactions_completees: 0,
      nombre_transactions_en_attente: 0,
      nombre_transactions_echouees: 0,
    };

    const statsVersementsData = statsVersements[0] || {
      total_actions_achetees: 0,
      total_montant_depense: 0,
    };

    return res.status(200).json({
      success: true,
      message: "Historique des achats récupéré",
      transactions: paginatedTransactions,
      pagination: {
        current_page: parseInt(page),
        total_pages: Math.ceil(totalTransactions / limit),
        total_transactions: totalTransactions,
        per_page: parseInt(limit),
      },
      statistiques: {
        // Totaux combinés
        total_actions_achetees: statsClassiquesData.total_actions_achetees + statsVersementsData.total_actions_achetees,
        total_montant_depense: parseFloat(
          (statsClassiquesData.total_montant_depense + statsVersementsData.total_montant_depense).toFixed(2)
        ),

        // Détails par type
        achats_directs: {
          nombre_transactions_completees: statsClassiquesData.nombre_transactions_completees,
          nombre_transactions_en_attente: statsClassiquesData.nombre_transactions_en_attente,
          nombre_transactions_echouees: statsClassiquesData.nombre_transactions_echouees,
          montant_depense: parseFloat(statsClassiquesData.total_montant_depense.toFixed(2)),
          actions_achetees: statsClassiquesData.total_actions_achetees,
        },

        achats_par_versements: {
          nombre_contrats_en_cours: installmentPurchases.filter(ip => ip.status === 'en_cours').length,
          nombre_contrats_completes: installmentPurchases.filter(ip => ip.status === 'complete').length,
          nombre_versements_effectues: nombreVersements,
          montant_depense: parseFloat(statsVersementsData.total_montant_depense.toFixed(2)),
          actions_achetees: statsVersementsData.total_actions_achetees,
        },
      },
    });
  } catch (error) {
    console.error("❌ Erreur récupération historique:", error);
    res.status(500).json({
      success: false,
      message: "Erreur lors de la récupération de l'historique",
      error: error.message,
    });
  }
};

// ✅ VÉRIFIER LE STATUT D'UNE TRANSACTION SPÉCIFIQUE
const checkPaymentStatus = async (req, res) => {
  try {
    const { transactionId } = req.params;
    const userId = req.user?.id || req.userData?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Utilisateur non authentifié",
      });
    }

    //('🔍 Vérification statut transaction:', transactionId, 'pour user:', userId);

    // Trouver la transaction
    const actionsPurchase = await ActionsPurchase.findOne({
      $or: [
        { paydunya_transaction_id: transactionId },
        { invoice_token: transactionId },
        { _id: transactionId },
      ],
      user_id: userId, // Sécurité: l'utilisateur ne peut voir que ses propres transactions
    });

    if (!actionsPurchase) {
      return res.status(404).json({
        success: false,
        message: "Transaction non trouvée",
      });
    }

    // ✅ Vérifier le statut avec PayDunya
    const paymentStatus = await verifyPaydunyaTransactionSN(
      actionsPurchase.paydunya_transaction_id || actionsPurchase.invoice_token
    );

    // Mettre à jour le statut local si nécessaire
    if (actionsPurchase.paydunya_status !== paymentStatus.status) {
      actionsPurchase.paydunya_status = paymentStatus.status;

      if (
        paymentStatus.status === "completed" &&
        actionsPurchase.status === "pending"
      ) {
        // Traiter le paiement qui vient d'être complété
        await processPaymentCompletion(actionsPurchase, paymentStatus);
      } else if (
        ["failed", "cancelled"].includes(paymentStatus.status) &&
        actionsPurchase.status === "pending"
      ) {
        await processPaymentFailure(actionsPurchase, paymentStatus);
      }

      await actionsPurchase.save();
    }

    // Récupérer les infos utilisateur mises à jour
    const user = await User.findById(userId);

    return res.status(200).json({
      success: true,
      message: "Statut de transaction récupéré",
      transaction: {
        id: actionsPurchase._id,
        paydunya_transaction_id: actionsPurchase.paydunya_transaction_id,
        nombre_actions: actionsPurchase.nombre_actions,
        montant_total: actionsPurchase.montant_total,
        status: actionsPurchase.status,
        paydunya_status: actionsPurchase.paydunya_status,
        payment_method: actionsPurchase.payment_method,
        payment_date: actionsPurchase.payment_date,
        created_at: actionsPurchase.createdAt,
      },
      user_actions: {
        nbre_actions_total: user?.nbre_actions || 0,
        dividende_total: user?.dividende || 0,
        valeur_portefeuille: (user?.nbre_actions || 0) * 100, // Prix fixe de 100 FCFA
      },
      paydunya_details: paymentStatus,
    });
  } catch (error) {
    console.error("❌ Erreur vérification statut:", error);
    res.status(500).json({
      success: false,
      message: "Erreur lors de la vérification du statut",
      error: error.message,
    });
  }
};

// ✅ RÉCUPÉRER TOUTES LES TRANSACTIONS (ADMIN SEULEMENT) - AVEC VERSEMENTS
const getAllTransactions = async (req, res) => {
  try {
    // 1. Vérification des droits admin
    const adminUser = await User.findById(req.user?.id || req.userData?.id);
    if (!adminUser || adminUser.role !== "admin") {
      return res.status(403).json({
        success: false,
        message:
          "Accès refusé. Seuls les administrateurs peuvent voir cette information.",
      });
    }

    // 2. Paramètres de filtres
    const { status, user_id } = req.query;

    // ==================================
    // 3. Récupérer les achats classiques
    // ==================================
    let query = {};
    if (status) query.status = status;
    if (user_id && mongoose.Types.ObjectId.isValid(user_id)) {
      query.user_id = new mongoose.Types.ObjectId(user_id);
    }

    const actionsPurchases = await ActionsPurchase.find(query)
      .populate("user_id", "firstName lastName telephone nbre_actions dividende")
      .lean();

    // ==================================
    // 4. Récupérer les achats par versements
    // ==================================
    let installmentQuery = {};
    if (user_id && mongoose.Types.ObjectId.isValid(user_id)) {
      installmentQuery.user_id = new mongoose.Types.ObjectId(user_id);
    }

    const installmentPurchases = await InstallmentPurchase.find(installmentQuery)
      .populate("user_id", "firstName lastName telephone nbre_actions dividende")
      .lean();

    
    // ==================================
    // 5. Fusionner les transactions
    // ==================================
    let allTransactions = [];

    // Ajouter les achats classiques
    actionsPurchases.forEach((purchase) => {
      allTransactions.push({
        id: purchase._id,
        type: 'achat_direct',
        paydunya_transaction_id: purchase.paydunya_transaction_id,
        utilisateur: {
          id: purchase.user_id?._id,
          nom: `${purchase.user_id?.firstName || ""} ${purchase.user_id?.lastName || ""}`,
          telephone: purchase.user_id?.telephone || "",
          actions_actuelles: purchase.user_id?.nbre_actions || 0,
          dividendes_actuels: purchase.user_id?.dividende || 0,
        },
        nombre_actions: purchase.nombre_actions,
        prix_unitaire: purchase.prix_unitaire,
        montant_total: purchase.montant_total,
        status: purchase.status,
        paydunya_status: purchase.paydunya_status,
        payment_method: purchase.payment_method,
        payment_date: purchase.payment_date,
        dividende_calculated: purchase.dividende_calculated,
        created_at: purchase.createdAt,
        updated_at: purchase.updatedAt,
      });
    });

    //console.log(`✅ [ADMIN] ${allTransactions.length} achats directs ajoutés`);

    // Ajouter les versements des achats échelonnés
    let versementsCount = 0;
    installmentPurchases.forEach((installment) => {
      //console.log(`📋 [ADMIN] Contrat ${installment._id}: ${installment.versements?.length || 0} versements`);

      if (installment.versements && Array.isArray(installment.versements)) {
        installment.versements.forEach((versement) => {
          versementsCount++;
          allTransactions.push({
            id: versement._id,
            type: 'versement',
            paydunya_transaction_id: versement.paydunya_transaction_id,
            utilisateur: {
              id: installment.user_id?._id,
              nom: `${installment.user_id?.firstName || ""} ${installment.user_id?.lastName || ""}`,
              telephone: installment.user_id?.telephone || "",
              actions_actuelles: installment.user_id?.nbre_actions || 0,
              dividendes_actuels: installment.user_id?.dividende || 0,
            },
            nombre_actions: versement.nombre_actions_equivalent,
            prix_unitaire: installment.prix_unitaire,
            montant_total: versement.montant,
            status: 'completed',
            paydunya_status: 'completed',
            payment_method: versement.payment_method,
            payment_date: versement.payment_date,
            dividende_calculated: 0,
            created_at: versement.createdAt,
            updated_at: versement.createdAt,
            // Infos spécifiques aux versements
            installment_id: installment._id,
            installment_status: installment.status,
            installment_progress: `${installment.montant_paye.toLocaleString()} / ${installment.montant_total.toLocaleString()} FCFA`,
            installment_percentage: Math.round((installment.montant_paye / installment.montant_total) * 100),
          });
        });
      }
    });

   // console.log(`💳 [ADMIN] ${versementsCount} versements ajoutés`);
   // console.log(`🔄 [ADMIN] Total transactions: ${allTransactions.length}`);

    // ==================================
    // 6. Trier par date décroissante
    // ==================================
    allTransactions.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    // ==================================
    // 7. Calculer les statistiques
    // ==================================

    // Stats achats classiques
    const statsClassiques = await ActionsPurchase.aggregate([
      {
        $group: {
          _id: null,
          total_actions_vendues: { $sum: "$nombre_actions" },
          total_revenus: {
            $sum: {
              $cond: [{ $eq: ["$status", "completed"] }, "$montant_total", 0],
            },
          },
          nombre_transactions_completees: {
            $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] },
          },
          nombre_transactions_en_attente: {
            $sum: { $cond: [{ $eq: ["$status", "pending"] }, 1, 0] },
          },
          nombre_transactions_echouees: {
            $sum: { $cond: [{ $eq: ["$status", "failed"] }, 1, 0] },
          },
        },
      },
    ]);

    // Stats versements (achats complétés uniquement)
    const statsVersements = await InstallmentPurchase.aggregate([
      {
        $match: { status: 'complete' }
      },
      {
        $group: {
          _id: null,
          total_actions_vendues: { $sum: "$nombre_actions_total" },
          total_revenus: { $sum: "$montant_total" },
        },
      },
    ]);

    // Compter les versements
    let nombreVersements = 0;
    installmentPurchases.forEach(ip => {
      nombreVersements += ip.versements.length;
    });

    const statsClassiquesData = statsClassiques[0] || {
      total_actions_vendues: 0,
      total_revenus: 0,
      nombre_transactions_completees: 0,
      nombre_transactions_en_attente: 0,
      nombre_transactions_echouees: 0,
    };

    const statsVersementsData = statsVersements[0] || {
      total_actions_vendues: 0,
      total_revenus: 0,
    };

    // 8. Formatage et envoi de la réponse
    return res.status(200).json({
      success: true,
      message: "Transactions récupérées avec succès",
      transactions: allTransactions,
      statistiques: {
        // Totaux combinés
        total_actions_vendues: statsClassiquesData.total_actions_vendues + statsVersementsData.total_actions_vendues,
        total_revenus: parseFloat((statsClassiquesData.total_revenus + statsVersementsData.total_revenus).toFixed(2)),

        // Détails par type
        achats_directs: {
          nombre_transactions_completees: statsClassiquesData.nombre_transactions_completees,
          nombre_transactions_en_attente: statsClassiquesData.nombre_transactions_en_attente,
          nombre_transactions_echouees: statsClassiquesData.nombre_transactions_echouees,
          total_revenus: parseFloat(statsClassiquesData.total_revenus.toFixed(2)),
          total_actions: statsClassiquesData.total_actions_vendues,
        },

        achats_par_versements: {
          nombre_contrats_en_cours: installmentPurchases.filter(ip => ip.status === 'en_cours').length,
          nombre_contrats_completes: installmentPurchases.filter(ip => ip.status === 'complete').length,
          nombre_versements_effectues: nombreVersements,
          total_revenus: parseFloat(statsVersementsData.total_revenus.toFixed(2)),
          total_actions: statsVersementsData.total_actions_vendues,
        },
      },
    });
  } catch (error) {
    console.error("❌ Erreur récupération transactions admin:", error);
    return res.status(500).json({
      success: false,
      message: "Erreur lors de la récupération des transactions",
      error: error.message,
    });
  }
};

// ✅ STATISTIQUES DES VENTES (ADMIN SEULEMENT)
const getSalesStatistics = async (req, res) => {
  try {
    // Vérifier si l'utilisateur est admin
    const adminUser = await User.findById(req.user?.id || req.userData?.id);

    if (!adminUser || adminUser.role !== "admin") {
      return res.status(403).json({
        success: false,
        message:
          "Accès refusé. Seuls les administrateurs peuvent voir cette information.",
      });
    }

    const { periode = "30" } = req.query;
    //('📈 Admin récupération statistiques - Période:', periode, 'jours');

    // Calculer les statistiques
    const stats = await calculateSalesStats(parseInt(periode));

    return res.status(200).json({
      success: true,
      message: "Statistiques récupérées avec succès",
      periode_analysee: `${periode} derniers jours`,
      statistiques: {
        global: stats.global,
        periode: stats.periode,
      },
    });
  } catch (error) {
    console.error("❌ Erreur récupération statistiques:", error);
    res.status(500).json({
      success: false,
      message: "Erreur lors de la récupération des statistiques",
      error: error.message,
    });
  }
};

// ===============================================
// 💳 CALLBACK PAIEMENTS PAR VERSEMENTS
// ===============================================

/**
 * Gérer le callback PayDunya pour les paiements par versements
 */
const handleInstallmentPaymentCallback = async (req, res, data, actionsPurchase = null) => {
  try {
    // Token: priorité au record DB (car DiokoLink ne renvoie pas nos métadonnées custom)
    const transactionToken = actionsPurchase?.paydunya_transaction_id
      || actionsPurchase?.invoice_token
      || data.payment_link_token
      || data.invoice?.token
      || data.metadata?.invoice_token;

    // installment_purchase_id: priorité au record DB
    const installment_purchase_id = actionsPurchase?.metadata?.paydunya_response?.installment_purchase_id
      || data.custom_data?.installment_purchase_id
      || data.metadata?.installment_purchase_id;

    console.log('💰 Traitement versement pour contrat:', installment_purchase_id);

    // Récupérer le contrat
    const installmentPurchase = await InstallmentPurchase.findById(installment_purchase_id);

    if (!installmentPurchase) {
      console.error("❌ Contrat d'achat introuvable:", installment_purchase_id);
      return res.status(404).json({
        success: false,
        message: "Contrat d'achat introuvable"
      });
    }

    // Récupérer l'utilisateur
    const user = await User.findById(installmentPurchase.user_id);
    if (!user) {
      console.error("❌ Utilisateur non trouvé:", installmentPurchase.user_id);
      return res.status(404).json({
        success: false,
        message: "Utilisateur non trouvé"
      });
    }

    // ✅ Vérifier le statut du paiement via PayDunya
    const paymentStatus = await verifyPaydunyaTransactionSN(transactionToken);

    console.log('📊 Statut paiement PayDunya:', paymentStatus.status);

    // ============================
    // ✅ Paiement validé
    // ============================
    if (paymentStatus.response_code === "00" && paymentStatus.status === "completed") {

      // Vérifier si ce versement n'a pas déjà été traité
      const versementExiste = installmentPurchase.versements.find(
        v => v.paydunya_transaction_id === transactionToken
      );

      if (versementExiste) {
        console.log('⚠️ Versement déjà traité');
        return res.status(200).json({
          success: true,
          message: "Versement déjà traité"
        });
      }

      // Ajouter le versement
      const montant = parseFloat(data.custom_data?.montant || paymentStatus.invoice?.total_amount || 0);
      const nombre_actions_equivalent = montant / installmentPurchase.prix_unitaire;
   const adminMessage = `
Client : ${user.firstName} ${user.lastName}
Téléphone : ${user.telephone}
Montant total : ${installmentPurchase.prix_unitaire.toLocaleString()} FCFA

`;

        try {
          console.log("🚀 Tentative d'envoi WhatsApp...");
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
      await installmentPurchase.addVersement({
        montant: montant,
        nombre_actions_equivalent: nombre_actions_equivalent,
        paydunya_transaction_id: transactionToken,
        payment_method: paymentStatus.customer?.payment_method || 'PayDunya',
        payment_date: new Date(),
        paydunya_details: paymentStatus
      });

      console.log(`✅ Versement ajouté: ${montant.toLocaleString()} FCFA (${nombre_actions_equivalent.toFixed(3)} actions)`);

      // Si le contrat est complètement payé, créditer les actions
      if (installmentPurchase.status === 'complete') {
        console.log('🎉 Contrat complètement payé ! Crédit des actions...');

        await installmentPurchase.crediterActions();

        // // PARRAINAGE DÉSACTIVÉ - Attribution bonus partenaire commentée
        // if (installmentPurchase.partenaireId && !installmentPurchase.bonusPartenaireAttribue) {
        //   const bonusMontant = installmentPurchase.montant_total * 0.10;
        //   const partenaire = await User.findById(installmentPurchase.partenaireId);
        //   if (partenaire) {
        //     partenaire.dividende = (partenaire.dividende || 0) + bonusMontant;
        //     await partenaire.save();
        //     installmentPurchase.bonusPartenaireAttribue = true;
        //     installmentPurchase.bonusMontant = bonusMontant;
        //     await installmentPurchase.save();
        //     try {
        //       await sendWhatsAppMessageSafe(partenaire.telephone, `🎁 Bonus de parrainage...`);
        //     } catch (err) {
        //       console.error('❌ Erreur message partenaire:', err.message);
        //     }
        //   }
        // }

        // Recharger l'utilisateur pour avoir les données à jour
        const updatedUser = await User.findById(user._id);

        // Générer et envoyer le contrat PDF
        try {
          console.log("📄 Génération du contrat PDF pour achat par versements...");

          // Préparer les données pour le contrat
          const purchaseData = {
            nombre_actions: installmentPurchase.nombre_actions_total,
            prix_unitaire: installmentPurchase.prix_unitaire,
            montant_total: installmentPurchase.montant_total,
            _id: installmentPurchase._id
          };

          const pdfBuffer = await generateContractPDF(purchaseData, updatedUser);
          const fileName = `ContratActionsVersements${installmentPurchase._id}${Date.now()}.pdf`;
          const pdfUrl = await uploadPDFToS3(pdfBuffer, fileName);

          console.log("✅ PDF uploadé sur S3:", pdfUrl.cleanUrl);

          // Envoi du PDF comme document WhatsApp via UltraMsg
          await sendPDFWhatsApp(
            user.telephone,
            pdfUrl.cleanUrl,
            fileName,
            `Félicitations ${user.firstName} ${user.lastName} ! Votre achat par versements est complètement payé ! Actions créditées: ${installmentPurchase.nombre_actions_total.toLocaleString()} — Montant total: ${installmentPurchase.montant_total.toLocaleString()} FCFA — Total actions: ${updatedUser.nbre_actions.toLocaleString()} — Merci pour votre confiance ! Équipe Dioko`
          );
          console.log("✅ Contrat PDF envoyé par WhatsApp (UltraMsg document)");
        } catch (pdfError) {
          console.error("❌ Erreur envoi contrat PDF:", pdfError.message);

          // Message WhatsApp de secours sans PDF
          try {
            await sendWhatsAppMessageSafe(
              user.telephone,
              `🎉 Achat complété - Dioko\n\nFélicitations ${user.firstName} ${user.lastName} !\n\nVotre achat par versements est complètement payé !\n\n📊 Actions créditées: ${installmentPurchase.nombre_actions_total.toLocaleString()}\n💰 Montant total: ${installmentPurchase.montant_total.toLocaleString()} FCFA\n🔢 Nombre de versements: ${installmentPurchase.versements.length}\n📈 Total actions: ${updatedUser.nbre_actions.toLocaleString()}\n\nMerci pour votre confiance !\nÉquipe Dioko`
            );
          } catch (err) {
            console.error('❌ Erreur message client:', err.message);
          }
        }

      } else {
        // Message WhatsApp client - Versement partiel
        const pourcentage = installmentPurchase.getPourcentagePaye();
        const whatsappMessage = `💳 Versement reçu - Dioko\n\nBonjour ${user.firstName} ${user.lastName},\n\nVotre versement a été validé avec succès !\n\n💰 Montant: ${montant.toLocaleString()} FCFA\n📊 Équivalent: ${nombre_actions_equivalent.toFixed(3)} actions\n\n📈 Progression:\n- Total à payer: ${installmentPurchase.montant_total.toLocaleString()} FCFA\n- Payé: ${installmentPurchase.montant_paye.toLocaleString()} FCFA (${pourcentage}%)\n- Reste: ${installmentPurchase.montant_restant.toLocaleString()} FCFA\n\nContinuez à payer petit à petit !\nÉquipe Dioko`;

        try {
          await sendWhatsAppMessageSafe(user.telephone, whatsappMessage);
        } catch (err) {
          console.error('❌ Erreur message client:', err.message);
        }
      }

      return res.status(200).json({
        success: true,
        message: "Versement traité avec succès",
        contrat_complete: installmentPurchase.status === 'complete'
      });
    }

    // ============================
    // ❌ Paiement échoué / annulé
    // ============================
    else if (["failed", "cancelled", "pending"].includes(paymentStatus.status)) {
      const statutMessage =
        paymentStatus.status === "cancelled" ? "annulé" :
        paymentStatus.status === "failed" ? "échoué" : "en attente";

      console.log(`❌ Versement ${statutMessage}`);

      // Message WhatsApp
      const whatsappMessage = `❌ Versement ${statutMessage} - Dioko\n\nBonjour ${user.firstName} ${user.lastName},\n\nVotre versement n'a pas été finalisé.\n\n📊 Statut: ${statutMessage}\n📄 Raison: ${paymentStatus.response_text || "Non spécifiée"}\n\n🔄 Vous pouvez réessayer depuis votre espace.\n\nMerci\nÉquipe Dioko`;

      try {
        await sendWhatsAppMessageSafe(user.telephone, whatsappMessage);
      } catch (err) {
        console.error('❌ Erreur message échec:', err.message);
      }

      return res.status(200).json({
        success: false,
        message: `Paiement ${statutMessage}`
      });
    }

    return res.status(200).json({
      success: true,
      message: "Callback traité"
    });

  } catch (error) {
    console.error('❌ Erreur callback versement:', error);
    return res.status(500).json({
      success: false,
      message: "Erreur traitement callback",
      error: error.message
    });
  }
};

// ✅ AJOUTEZ CES FONCTIONS À LA FIN DE VOTRE ActionsPurchaseController.js
const handlePaydunyaCallback = async (req, res) => {
  try {
    let { data } = req.body;

    if (typeof data === "string") {
      try {
        data = JSON.parse(data);
      } catch (e) {
        console.error("❌ JSON invalide:", data);
        return res
          .status(400)
          .json({ success: false, message: "JSON invalide" });
      }
    }

    // ✅ Support PayDunya - Validation flexible
    const transactionToken = data.payment_link_token || data.invoice?.token || data.metadata?.invoice_token;
    const newTransactionId = data.transaction_id; // ID après paiement (DiokoLink)

    if (!transactionToken) {
      console.error("❌ Données invalides - token manquant:", req.body);
      return res
        .status(400)
        .json({ success: false, message: "Données de callback invalides - token manquant" });
    }

    ///tette

    //console.log('🔍 Transaction ID:', transactionToken);
    //console.log('📦 Métadonnées:', data.custom_data || data.metadata);

    // Chercher la transaction dans la base de données (avant la détermination du type)
    const actionsPurchase = await ActionsPurchase.findOne({
      $or: [
        { invoice_token: transactionToken },
        { paydunya_transaction_id: transactionToken },
        { paydunya_transaction_id: newTransactionId },
      ],
    });

    // Déterminer le type via le callback OU l'enregistrement en DB
    // (DiokoLink ne renvoie pas nos métadonnées custom, donc on se fie au record DB)
    const storedTransactionType = actionsPurchase?.metadata?.paydunya_response?.transaction_type;
    const transactionType = data.custom_data?.type
      || data.metadata?.type
      || data.metadata?.transaction_type
      || storedTransactionType
      || 'actions_purchase';

    console.log('🎯 Type de transaction:', transactionType);

    // Chercher transaction selon le type
    if (transactionType === 'installment_payment') {
      // C'est un paiement de versement
      return await handleInstallmentPaymentCallback(req, res, data, actionsPurchase);
    }

    // ✅ Investissement dans un projet
    if (transactionType === 'project_investment' || !actionsPurchase) {
      const projectInvestment = await ProjectInvestment.findOne({
        $or: [
          { diokolink_transaction_id: transactionToken },
          { diokolink_transaction_id: newTransactionId }
        ]
      });

      if (projectInvestment) {
        console.log('📁 Routing vers handleProjectInvestmentCallback');
        return await handleProjectInvestmentCallback(req, res, data, projectInvestment);
      }
    }

    // Achat d'actions classique
    if (!actionsPurchase) {
      console.error("❌ Transaction non trouvée:", transactionToken);
      return res
        .status(404)
        .json({ success: false, message: "Transaction non trouvée" });
    }

    // ✅ Mettre à jour le transaction_id si DiokoLink a changé l'ID
    if (newTransactionId && actionsPurchase.paydunya_transaction_id !== newTransactionId) {
      actionsPurchase.paydunya_transaction_id = newTransactionId;
      await actionsPurchase.save();
    }

    const user = await User.findById(actionsPurchase.user_id);
    if (!user) {
      console.error("❌ Utilisateur non trouvé:", actionsPurchase.user_id);
      return res
        .status(404)
        .json({ success: false, message: "Utilisateur non trouvé" });
    }

    // ✅ Vérifier le statut réel via PayDunya
    const paymentStatus = await verifyPaydunyaTransactionSN(transactionToken);

    let result, whatsappMessage;

    // ============================
    // ✅ Paiement validé
    // ============================
    if (
      paymentStatus.response_code === "00" &&
      paymentStatus.status === "completed"
    ) {
      if (actionsPurchase.status === "completed") {
        return res
          .status(200)
          .json({ success: true, message: "Transaction déjà traitée" });
      }

      // Bonus partenaire
      await attributeBonusAuPartenaire(actionsPurchase, user);

      // Finaliser l'achat
      const result = await processPaymentCompletion(
        actionsPurchase,
        paymentStatus
      );

      if (result.success) {
        const updatedUser = await User.findById(actionsPurchase.user_id);

        const totalActions = updatedUser.nbre_actions;
        // const capitalTotal = 1000000; // Capital total de la soc
        // const pourcentage = ((totalActions / capitalTotal) * 100).toFixed(5);

        //console.log(`Le cessionnaire détient désormais un total de ${totalActions} actions, représentant ${pourcentage}% du capital social.`);

        // Utiliser ces valeurs pour PDF ou WhatsApp
        // console.log(`Le cessionnaire détient désormais un total de ${totalActions} actions, représentant ${pourcentage}% du capital social.`);
        try {
          console.log("📄 Génération du contrat PDF...");
          const pdfBuffer = await generateContractPDF(
            actionsPurchase,
            updatedUser
          );
          const fileName = `ContratActions${
            actionsPurchase._id
          }${Date.now()}.pdf`;
          const pdfUrl = await uploadPDFToS3(pdfBuffer, fileName);

          // Envoi du PDF comme document WhatsApp via UltraMsg
          await sendPDFWhatsApp(
            user.telephone,
            pdfUrl.cleanUrl,
            fileName,
            `Félicitations ${user.firstName} ${user.lastName} ! Voici votre contrat d'achat de ${actionsPurchase.nombre_actions.toLocaleString()} actions pour ${actionsPurchase.montant_total.toLocaleString()} FCFA. Merci pour votre confiance — Équipe Dioko`
          );

          console.log("✅ Contrat PDF envoyé par WhatsApp (UltraMsg document)");
        } catch (pdfError) {
          console.error("❌ Erreur envoi contrat PDF:", pdfError.message);
        }

        // Message texte normal

        try {
          await sendWhatsAppMessageSafe(user.telephone, whatsappMessage);
        } catch (err) {
          console.error("❌ Envoi WhatsApp client échoué:", err.message);
        }
        //pour ladmin
        // Construire le message administrateur
        const adminMessage = `
Client : ${user.firstName} ${user.lastName}
Téléphone : ${user.telephone}
Nombre d'actions : ${actionsPurchase.nombre_actions.toLocaleString()}
Montant total : ${actionsPurchase.montant_total.toLocaleString()} FCFA
Total actions client : ${totalActions.toLocaleString()}
`;

        try {
          console.log("🚀 Tentative d'envoi WhatsApp...");
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
      }
    }

    // ============================
    // ❌ Paiement échoué / annulé / en attente
    // ============================
    else if (
      ["failed", "cancelled", "pending"].includes(paymentStatus.status)
    ) {
      const statutMessage =
        paymentStatus.status === "cancelled"
          ? "annulé"
          : paymentStatus.status === "failed"
          ? "échoué"
          : "en attente";

      result = await processPaymentFailure(actionsPurchase, paymentStatus);

      if (result.success) {
        whatsappMessage = `❌ Achat ${statutMessage} - Dioko

Bonjour ${user.firstName} ${user.lastName},

Votre achat de ${actionsPurchase.nombre_actions} actions n'a pas été finalisé.

💰 Montant : ${actionsPurchase.montant_total.toLocaleString()} FCFA
📊 Statut : ${statutMessage}
📄 Raison : ${paymentStatus.response_text || "Non spécifiée"}

${
  paymentStatus.status === "pending"
    ? "⏳ Paiement en attente. Nous vous tiendrons informé dès validation."
    : "🔄 Vous pouvez réessayer votre achat depuis votre espace."
}

Merci 💙
Équipe Dioko`;

        try {
          await sendWhatsAppMessageSafe(user.telephone, whatsappMessage);
        } catch (err) {
          console.error("❌ Envoi WhatsApp échec échoué:", err.message);
        }
      }
    }

    // ============================
    // ⚠️ Statut inconnu
    // ============================
    else {
      console.warn("⚠️ Statut PayDunya inconnu:", paymentStatus.status);
    }

    return res.status(200).json({
      success: true,
      message: "Callback traité avec succès",
      transaction_id: actionsPurchase._id,
      status: actionsPurchase.status,
    });
  } catch (error) {
    console.error("❌ Erreur callback PayDunya:", {
      message: error.message,
      stack: error.stack,
      body: req.body,
    });

    return res.status(500).json({
      success: false,
      message: "Erreur lors du traitement du callback",
      error: error.message,
    });
  }
};

// ===============================================
// ✅ PARRAINAGE DÉSACTIVÉ - Fonction d'attribution des bonus commentée
// ===============================================

// ─── Taux par niveau (chaque niveau = moitié du précédent) ──────────────────
const TAUX_PARRAINAGE_NIVEAUX = [0.10, 0.05, 0.025, 0.0125];
//  Niveau :                        1     2     3      4
//  Sur 100 000 FCFA :          10 000 5 000 2 500  1 250

const attributeBonusAuPartenaire = async (actionsPurchase, user) => {
  try {
    const { cleanUserOTPs } = require("../Utils/otp-utils");

    // Vérifier si un bonus a déjà été attribué pour cette transaction
    if (actionsPurchase.bonusPartenaireAttribue) {
      return false;
    }

    // ── Collecter TOUS les parrains de niveau 1 (ancienne + nouvelle logique) ──
    // On déduplique : telephonePartenaire (ancien champ singulier) + telephonePartenaires (nouveau tableau)
    const niveau1Set = new Set();
    if (actionsPurchase.telephonePartenaire) {
      niveau1Set.add(actionsPurchase.telephonePartenaire);
    }
    // Récupérer le user complet pour avoir telephonePartenaires à jour
    const userFull = await User.findById(user._id)
      .select('telephone telephonePartenaire telephonePartenaires');
    if (userFull?.telephonePartenaires?.length > 0) {
      userFull.telephonePartenaires.forEach(t => { if (t) niveau1Set.add(t); });
    }
    if (userFull?.telephonePartenaire) {
      niveau1Set.add(userFull.telephonePartenaire);
    }

    if (niveau1Set.size === 0) return false;

    // ── Anti-cycle global ─────────────────────────────────────────────────────
    const visitedTelephones = new Set([user.telephone]);
    const bonusMultiNiveaux = [];

    // ═══════════════════════════════════════════════════════════════════════════
    // NIVEAU 1 : TOUS les parrains directs reçoivent chacun 10%
    // (un user peut avoir plusieurs parrains)
    // ═══════════════════════════════════════════════════════════════════════════
    const taux1       = TAUX_PARRAINAGE_NIVEAUX[0]; // 10%
    const montant1    = Math.round(actionsPurchase.montant_total * taux1);
    let   level1Data  = null; // pour le markBonusAttribue (rétrocompat → premier parrain)

    for (const tel of niveau1Set) {
      if (visitedTelephones.has(tel)) continue;
      visitedTelephones.add(tel);

      const parrain = await User.findOne({ telephone: tel })
        .select('_id firstName lastName telephone dividende telephonePartenaire telephonePartenaires isBlocked status');

      if (!parrain)                                                     continue;
      if (parrain.isBlocked)                                            continue;
      if (parrain.status === 'blocked' || parrain.status === 'suspended') continue;
      if (parrain._id.toString() === user._id.toString())              continue;
      if (montant1 < 1)                                                 continue;

      // Créditer
      parrain.dividende = (parrain.dividende || 0) + montant1;
      await parrain.save();

      console.log(`💸 [Niveau 1] ${montant1.toLocaleString()} FCFA (${taux1 * 100}%) → ${parrain.telephone} (${parrain.firstName} ${parrain.lastName})`);

      bonusMultiNiveaux.push({ niveau: 1, telephone: parrain.telephone, userId: parrain._id, montant: montant1, taux: taux1 });
      if (!level1Data) level1Data = { parrain, montant: montant1, taux: taux1 };

      // WhatsApp
      const bonusMessage =
`🎁 BONUS DE PARRAINAGE 🥇 Niveau 1 (filleul direct) - Dioko

Bonjour ${parrain.firstName} ${parrain.lastName},

Vous venez de recevoir un bonus de parrainage *🥇 Niveau 1 (filleul direct)* de *${montant1.toLocaleString()} FCFA* 🎉

👤 Acheteur : ${user.firstName} ${user.lastName}
📞 Téléphone : ${user.telephone}
📈 Montant de l'achat : ${actionsPurchase.montant_total.toLocaleString()} FCFA
🎯 Taux niveau 1 : ${taux1 * 100}%
💳 Nouveau solde dividendes : ${parrain.dividende.toLocaleString()} FCFA

✨ Ce bonus a été automatiquement ajouté à vos dividendes !

Merci pour votre confiance.
L'équipe Dioko`;

      try { await sendWhatsAppMessageSafe(parrain.telephone, bonusMessage); }
      catch (err) { console.error(`⚠️ WhatsApp niveau 1 non envoyé :`, err.message); }

      try { await cleanUserOTPs(parrain._id); } catch {}
    }

    if (!level1Data) return false; // aucun parrain valide trouvé

    // ═══════════════════════════════════════════════════════════════════════════
    // NIVEAUX 2 → 4 : remonter la chaîne depuis le parrain principal (niveau 1)
    // À chaque étage : telephonePartenaire (champ singulier ancien) OU
    //                  telephonePartenaires[0] (nouveau tableau, 1er élément)
    // ═══════════════════════════════════════════════════════════════════════════

    // Démarrer depuis le parrain principal (telephonePartenaire de la transaction,
    // ou le premier parrain valide trouvé à niveau 1)
    const primaryLevel1Phone = actionsPurchase.telephonePartenaire
      || level1Data.parrain.telephone;

    const primaryLevel1 = await User.findOne({ telephone: primaryLevel1Phone })
      .select('telephonePartenaire telephonePartenaires');

    let currentTelephone = primaryLevel1?.telephonePartenaire
      || primaryLevel1?.telephonePartenaires?.[0]
      || null;

    for (let niveau = 2; niveau <= TAUX_PARRAINAGE_NIVEAUX.length; niveau++) {
      if (!currentTelephone) break;
      if (visitedTelephones.has(currentTelephone)) break; // cycle détecté
      visitedTelephones.add(currentTelephone);

      const parrain = await User.findOne({ telephone: currentTelephone })
        .select('_id firstName lastName telephone dividende telephonePartenaire telephonePartenaires isBlocked status');

      if (!parrain)                                                        break;
      if (parrain.isBlocked)                                               break;
      if (parrain.status === 'blocked' || parrain.status === 'suspended')  break;
      if (parrain._id.toString() === user._id.toString())                 break;

      const taux    = TAUX_PARRAINAGE_NIVEAUX[niveau - 1];
      const montant = Math.round(actionsPurchase.montant_total * taux);
      if (montant < 1) break;

      // Créditer
      parrain.dividende = (parrain.dividende || 0) + montant;
      await parrain.save();

      console.log(`💸 [Niveau ${niveau}] ${montant.toLocaleString()} FCFA (${taux * 100}%) → ${parrain.telephone} (${parrain.firstName} ${parrain.lastName})`);

      bonusMultiNiveaux.push({ niveau, telephone: parrain.telephone, userId: parrain._id, montant, taux });

      // WhatsApp
      const niveauLabel = niveau === 2 ? '🥈 Niveau 2 (filleul de filleul)' : `🏅 Niveau ${niveau}`;
      const bonusMessage =
`💫 BONUS DE PARRAINAGE ${niveauLabel} - Dioko

Bonjour ${parrain.firstName} ${parrain.lastName},

Vous venez de recevoir un bonus de parrainage *${niveauLabel}* de *${montant.toLocaleString()} FCFA* 🎉

👤 Acheteur : ${user.firstName} ${user.lastName}
📞 Téléphone : ${user.telephone}
📈 Montant de l'achat : ${actionsPurchase.montant_total.toLocaleString()} FCFA
🎯 Taux niveau ${niveau} : ${taux * 100}%
💳 Nouveau solde dividendes : ${parrain.dividende.toLocaleString()} FCFA

✨ Ce bonus a été automatiquement ajouté à vos dividendes !

Merci pour votre confiance.
L'équipe Dioko`;

      try { await sendWhatsAppMessageSafe(parrain.telephone, bonusMessage); }
      catch (err) { console.error(`⚠️ WhatsApp niveau ${niveau} non envoyé :`, err.message); }

      // Remonter la chaîne : priorité à telephonePartenaire, sinon telephonePartenaires[0]
      currentTelephone = parrain.telephonePartenaire
        || parrain.telephonePartenaires?.[0]
        || null;
    }

    // ── Marquer le bonus sur la transaction (rétrocompat niveau 1) ────────────
    await actionsPurchase.markBonusAttribue(level1Data.montant, level1Data.taux);
    actionsPurchase.bonusMultiNiveaux = bonusMultiNiveaux;
    await actionsPurchase.save();

    const totalDistribue = bonusMultiNiveaux.reduce((s, d) => s + d.montant, 0);
    console.log(`✅ Bonus multi-niveaux attribués : ${bonusMultiNiveaux.length} distribution(s) — total ${totalDistribue.toLocaleString()} FCFA distribués`);
    return true;

  } catch (error) {
    console.error("❌ Erreur lors de l'attribution du bonus multi-niveaux:", error);
    try {
      actionsPurchase.bonusPartenaireAttribue = false;
      actionsPurchase.bonusMontant = 0;
      await actionsPurchase.save();
    } catch {}
    return false;
  }
}
/* const attributeBonusAuPartenaire_DISABLED = async (actionsPurchase, user) => {
  try {
    // ✅ Import des nouvelles fonctions avec modèle OTP
    const { validatePartner, cleanUserOTPs } = require("../Utils/otp-utils");

    // Vérifier si un partenaire est défini
    if (!actionsPurchase.telephonePartenaire) {
      ////("ℹ️ Aucun partenaire défini pour cette transaction");
      return false;
    }

    // Vérifier si un bonus a déjà été attribué pour cette transaction
    if (actionsPurchase.bonusPartenaireAttribue) {
      //("ℹ️ Un bonus a déjà été attribué pour cette transaction");
      return false;
    }

    // Valider le partenaire
    const { isValid, partenaire } = await validatePartner(
      user._id,
      actionsPurchase.telephonePartenaire
    );

    if (!isValid) {
      //("ℹ️ Partenaire invalide ou utilisateur est le même que le partenaire");
      return false;
    }

    // ✅ Calculer et attribuer le bonus (maintenant pour TOUS les achats avec partenaire)
    const tauxBonus = 0.1; // 10%
    const bonusMontant = Math.round(actionsPurchase.montant_total * tauxBonus);

    try {
      // Ajouter le bonus au dividende du partenaire
      partenaire.dividende = (partenaire.dividende || 0) + bonusMontant;
      await partenaire.save();

      // ✅ Utiliser la nouvelle méthode du modèle ActionsPurchase
      await actionsPurchase.markBonusAttribue(bonusMontant, tauxBonus);

      console.log(
        `💸 Bonus de ${bonusMontant} FCFA ajouté au partenaire (${partenaire.telephone})`
      );
    } catch (error) {
      console.error("❌ Erreur lors de l'attribution du bonus:", error);
      return false;
    }

    // ✅ Nettoyer les OTP du partenaire après attribution réussie
    try {
      await cleanUserOTPs(partenaire._id);
      console.log(`🧹 OTP nettoyés pour le partenaire ${partenaire.telephone}`);
    } catch (cleanError) {
      console.error(
        "⚠️ Erreur nettoyage OTP (non critique):",
        cleanError.message
      );
      // Ne pas faire échouer l'attribution pour un problème de nettoyage
    }

    // ✅ Envoyer un message WhatsApp au partenaire avec les nouvelles infos
    const bonusMessage = `🎁 BONUS DE PARRAINAGE - Dioko

Bonjour ${partenaire.firstName} ${partenaire.lastName},

Félicitations ! Vous venez de recevoir un bonus de parrainage de ${bonusMontant.toLocaleString()} FCFA 🎉

👤 Filleul : ${user.firstName} ${user.lastName}
📞 Téléphone : ${user.telephone}
📈 Montant de l'achat : ${actionsPurchase.montant_total.toLocaleString()} FCFA
🎯 Taux de bonus : ${tauxBonus * 100}%
💳 Nouveau solde dividendes : ${partenaire.dividende.toLocaleString()} FCFA

✨ Ce bonus a été automatiquement ajouté à vos dividendes !

Continuez à parrainer de nouveaux actionnaires pour augmenter vos revenus.

Merci pour votre confiance.
L'équipe Dioko`;

    try {
      await sendWhatsAppMessageSafe(partenaire.telephone, bonusMessage);
      //('✅ Message WhatsApp de bonus envoyé au partenaire');
    } catch (err) {
      console.error(
        "❌ Erreur lors de l'envoi du message de bonus:",
        err.message
      );
      // Ne pas faire échouer l'attribution pour un problème de message
    }

    // ✅ Log détaillé de l'attribution
    console.log(`💸 Bonus attribué avec succès:`, {
      partenaire: `${partenaire.firstName} ${partenaire.lastName}`,
      telephone: partenaire.telephone,
      montantBonus: bonusMontant,
      tauxBonus: tauxBonus,
      montantAchat: actionsPurchase.montant_total,
      acheteur: `${user.firstName} ${user.lastName}`,
      nouveauSoldeDividendes: partenaire.dividende,
      transactionId: actionsPurchase._id,
    });

    return true;
  } catch (error) {
    console.error("❌ Erreur lors de l'attribution du bonus:", error);

    // ✅ En cas d'erreur, essayer de remettre à zéro les flags pour permettre une nouvelle tentative
    try {
      actionsPurchase.bonusPartenaireAttribue = false;
      actionsPurchase.bonusMontant = 0;
      await actionsPurchase.save();
      console.log(
        "🔄 Flags bonus remis à zéro pour permettre une nouvelle tentative"
      );
    } catch (resetError) {
      console.error(
        "❌ Erreur lors de la remise à zéro des flags:",
        resetError.message
      );
    }

    return false;
  }
};  */

// ═══════════════════════════════════════════════════════════════════════════════
// 💰 ACHAT D'ACTIONS AVEC CRYPTO (preuve photo → validation admin)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * POST /actions/acheter-crypto
 * Actionnaire soumet une demande avec capture d'écran
 */
const initiateActionsPurchaseCrypto = async (req, res) => {
  try {
    const userId = req.user?.id || req.userData?.id;
    if (!userId) return res.status(401).json({ success: false, message: 'Non authentifié.' });

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ success: false, message: 'Utilisateur introuvable.' });
    if (user.isBlocked || user.status !== 'active')
      return res.status(403).json({ success: false, message: 'Compte bloqué ou inactif.' });

    if (!req.file)
      return res.status(400).json({ success: false, message: "Veuillez joindre une capture d'écran de paiement." });

    const { nombre_actions, telephonePartenaire: reqParrain } = req.body;
    const nbreActions = parseFloat(nombre_actions);
    if (!nbreActions || nbreActions <= 0 || nbreActions > 1000000)
      return res.status(400).json({ success: false, message: 'Nombre d\'actions invalide.' });

    // Prix dynamique
    const pricingInfo = await calculateActionPrice(userId);
    const montantTotal = Math.round(pricingInfo.prix_unitaire * nbreActions);

    // Upload preuve S3
    let proofUrl = null;
    try {
      const s3Key = `preuves-paiement-actions/${Date.now()}_${req.file.originalname.replace(/\s/g, '_')}`;
      await s3.putObject({
        Bucket: process.env.AWS_BUCKET_NAME,
        Key: s3Key,
        Body: req.file.buffer,
        ContentType: req.file.mimetype || 'image/jpeg',
      }).promise();
      proofUrl = `https://${process.env.AWS_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${s3Key}`;
    } catch (uploadErr) {
      console.error('❌ Upload S3 preuve actions crypto:', uploadErr.message);
      return res.status(500).json({ success: false, message: "Erreur lors de l'upload de la preuve." });
    }

    // Parrain : priorité au body, sinon celui enregistré
    const telephonePartenaireFinal = reqParrain || user.telephonePartenaire || null;

    // Token unique (pas de PayDunya)
    const cryptoToken = `CRYPTO_${Date.now()}_${userId}`;

    const actionsPurchase = new ActionsPurchase({
      user_id:                 userId,
      paydunya_transaction_id: cryptoToken,
      invoice_token:           cryptoToken,
      nombre_actions:          nbreActions,
      prix_unitaire:           pricingInfo.prix_unitaire,
      montant_total:           montantTotal,
      dividende_calculated:    0,
      status:                  'pending',
      payment_method:          'crypto',
      telephonePartenaire:     telephonePartenaireFinal,
      crypto_proof_url:        proofUrl,
    });
    await actionsPurchase.save();

    // WhatsApp admin — message texte
    const montantUSD = (nbreActions * 2).toFixed(2);
    const adminMsg =
`₿ *Nouvelle demande achat actions — CRYPTO (USDT)*

👤 *${user.firstName} ${user.lastName}*
📞 ${user.telephone}
📊 Nombre d'actions : *${nbreActions}*
💰 Montant : *~${montantUSD} USDT* (${montantTotal.toLocaleString()} FCFA)

✅ Validez sur le dashboard admin → /dashboard/admin/purchaseActionnaire`;

    await sendWhatsAppMessageSafe('+221773878232', adminMsg);

    // WhatsApp admin — envoyer la capture de preuve directement
    if (proofUrl) {
      await sendWhatsAppImageSafe(
        '+221773878232',
        proofUrl,
        `📎 Preuve USDT — ${user.firstName} ${user.lastName} — ${nbreActions} actions`
      );
    }

    return res.status(201).json({
      success:        true,
      message:        `Demande soumise pour ${nbreActions} actions. L'admin vérifiera votre paiement.`,
      transaction_id: actionsPurchase._id,
    });
  } catch (error) {
    console.error('❌ initiateActionsPurchaseCrypto:', error.message);
    return res.status(500).json({ success: false, message: 'Erreur serveur.' });
  }
};

/**
 * GET /actions/admin/crypto-pending
 * Admin : liste des achats crypto en attente
 */
const getCryptoActionsPending = async (req, res) => {
  try {
    const { status = 'pending' } = req.query;
    const filter = { payment_method: 'crypto' };
    if (['pending', 'completed', 'rejected'].includes(status)) filter.status = status;

    const achats = await ActionsPurchase.find(filter)
      .populate('user_id', 'firstName lastName telephone nbre_actions dividende')
      .sort({ createdAt: -1 })
      .lean();

    return res.status(200).json({ success: true, achats });
  } catch (error) {
    console.error('❌ getCryptoActionsPending:', error.message);
    return res.status(500).json({ success: false, message: 'Erreur serveur.' });
  }
};

/**
 * PUT /actions/admin/crypto/:id/valider
 * Admin valide → crédite actions + bonus parrainage + contrat PDF
 */
const validateCryptoActionsPurchase = async (req, res) => {
  try {
    const { id } = req.params;
    const { admin_note } = req.body;

    const actionsPurchase = await ActionsPurchase.findById(id);
    if (!actionsPurchase) return res.status(404).json({ success: false, message: 'Transaction introuvable.' });
    if (actionsPurchase.status !== 'pending') return res.status(400).json({ success: false, message: 'Transaction déjà traitée.' });
    if (actionsPurchase.payment_method !== 'crypto') return res.status(400).json({ success: false, message: 'Réservé aux achats crypto.' });

    const user = await User.findById(actionsPurchase.user_id);
    if (!user) return res.status(404).json({ success: false, message: 'Utilisateur introuvable.' });

    // Marquer complété
    actionsPurchase.status      = 'completed';
    actionsPurchase.payment_date = new Date();
    actionsPurchase.processed_at = new Date();
    actionsPurchase.admin_note  = admin_note || '';
    actionsPurchase.paydunya_status = 'completed';
    await actionsPurchase.save();

    // Créditer les actions
    user.nbre_actions = (user.nbre_actions || 0) + actionsPurchase.nombre_actions;
    await user.save();

    // Bonus parrainage multi-niveaux
    await attributeBonusAuPartenaire(actionsPurchase, user);

    // Contrat PDF → WhatsApp
    try {
      const updatedUser = await User.findById(user._id);
      const pdfBuffer  = await generateContractPDF(actionsPurchase, updatedUser);
      const fileName   = `ContratActionsCrypto_${actionsPurchase._id}_${Date.now()}.pdf`;
      const pdfResult  = await uploadPDFToS3(pdfBuffer, fileName);

      await sendPDFWhatsApp(
        user.telephone,
        pdfResult.cleanUrl,
        fileName,
        `Félicitations ${user.firstName} ${user.lastName} ! Voici votre contrat pour l'achat de ${actionsPurchase.nombre_actions.toLocaleString()} actions via crypto — ${actionsPurchase.montant_total.toLocaleString()} FCFA. Merci — Équipe Dioko`
      );
    } catch (pdfErr) {
      console.error('❌ Erreur contrat PDF crypto:', pdfErr.message);
      try {
        await sendWhatsAppMessageSafe(
          user.telephone,
          `✅ Achat validé — Dioko\n\nFélicitations ${user.firstName} ${user.lastName} !\n\n📊 ${actionsPurchase.nombre_actions.toLocaleString()} actions créditées sur votre compte.\n💰 Montant : ${actionsPurchase.montant_total.toLocaleString()} FCFA\n\nMerci pour votre confiance !\nÉquipe Dioko`
        );
      } catch {}
    }

    return res.status(200).json({
      success: true,
      message: `${actionsPurchase.nombre_actions} actions créditées. Contrat envoyé par WhatsApp.`,
    });
  } catch (error) {
    console.error('❌ validateCryptoActionsPurchase:', error.message);
    return res.status(500).json({ success: false, message: 'Erreur serveur.' });
  }
};

/**
 * PUT /actions/admin/crypto/:id/rejeter
 * Admin rejette → notifie l'utilisateur
 */
const rejectCryptoActionsPurchase = async (req, res) => {
  try {
    const { id } = req.params;
    const { admin_note } = req.body;

    const actionsPurchase = await ActionsPurchase.findById(id);
    if (!actionsPurchase) return res.status(404).json({ success: false, message: 'Transaction introuvable.' });
    if (actionsPurchase.status !== 'pending') return res.status(400).json({ success: false, message: 'Transaction déjà traitée.' });

    actionsPurchase.status       = 'rejected';
    actionsPurchase.processed_at = new Date();
    actionsPurchase.admin_note   = admin_note || '';
    await actionsPurchase.save();

    try {
      const user = await User.findById(actionsPurchase.user_id);
      if (user) {
        await sendWhatsAppMessageSafe(
          user.telephone,
          `❌ Demande rejetée — Dioko\n\nBonjour ${user.firstName} ${user.lastName},\n\nVotre demande d'achat de ${actionsPurchase.nombre_actions} actions via crypto a été rejetée.${admin_note ? `\nRaison : ${admin_note}` : ''}\n\nContactez-nous pour plus d'informations.\nÉquipe Dioko`
        );
      }
    } catch {}

    return res.status(200).json({ success: true, message: 'Demande rejetée.' });
  } catch (error) {
    console.error('❌ rejectCryptoActionsPurchase:', error.message);
    return res.status(500).json({ success: false, message: 'Erreur serveur.' });
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// 💸 ACHAT D'ACTIONS VIA TRANSFERT (Western Union / Ria / MoneyGram)
// ═══════════════════════════════════════════════════════════════════════════════

const TRANSFERT_PHONE   = '+221773878232';
const TRANSFERT_LABELS  = {
  western_union: 'Western Union',
  ria:           'Ria Money Transfer',
  money_gram:    'MoneyGram',
  autre:         'Autre service',
};

/**
 * POST /actions/acheter-transfert
 * Actionnaire soumet sa demande avec la capture du transfert
 */
const initiateActionsPurchaseTransfert = async (req, res) => {
  try {
    const userId = req.user?.id || req.userData?.id;
    if (!userId) return res.status(401).json({ success: false, message: 'Non authentifié.' });

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ success: false, message: 'Utilisateur introuvable.' });
    if (user.isBlocked || user.status !== 'active')
      return res.status(403).json({ success: false, message: 'Compte bloqué ou inactif.' });

    if (!req.file)
      return res.status(400).json({ success: false, message: "Veuillez joindre une capture d'écran du transfert." });

    const { nombre_actions, transfert_service, telephonePartenaire: reqParrain } = req.body;
    const nbreActions = parseFloat(nombre_actions);
    if (!nbreActions || nbreActions <= 0)
      return res.status(400).json({ success: false, message: "Nombre d'actions invalide." });

    const serviceLabel = TRANSFERT_LABELS[transfert_service] || TRANSFERT_LABELS['autre'];

    // Prix dynamique
    const pricingInfo  = await calculateActionPrice(userId);
    const montantTotal = Math.round(pricingInfo.prix_unitaire * nbreActions);

    // Upload preuve S3
    let proofUrl = null;
    try {
      const s3Key = `preuves-transfert-actions/${Date.now()}_${req.file.originalname.replace(/\s/g, '_')}`;
      await s3.putObject({
        Bucket:      process.env.AWS_BUCKET_NAME,
        Key:         s3Key,
        Body:        req.file.buffer,
        ContentType: req.file.mimetype || 'image/jpeg',
      }).promise();
      proofUrl = `https://${process.env.AWS_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${s3Key}`;
    } catch (uploadErr) {
      console.error('❌ Upload S3 preuve transfert actions:', uploadErr.message);
      return res.status(500).json({ success: false, message: "Erreur lors de l'upload de la preuve." });
    }

    const telephonePartenaireFinal = reqParrain || user.telephonePartenaire || null;
    const transfertToken = `TRANSFERT_${Date.now()}_${userId}`;

    const actionsPurchase = new ActionsPurchase({
      user_id:                 userId,
      paydunya_transaction_id: transfertToken,
      invoice_token:           transfertToken,
      nombre_actions:          nbreActions,
      prix_unitaire:           pricingInfo.prix_unitaire,
      montant_total:           montantTotal,
      dividende_calculated:    0,
      status:                  'pending',
      payment_method:          'transfert',
      telephonePartenaire:     telephonePartenaireFinal,
      transfert_proof_url:     proofUrl,
      transfert_service:       transfert_service || 'autre',
    });
    await actionsPurchase.save();

    // WhatsApp admin — message texte
    const adminMsg =
`💸 *Nouvelle demande achat actions — TRANSFERT*

👤 *${user.firstName} ${user.lastName}*
📞 ${user.telephone}
🏦 Service : *${serviceLabel}*
📊 Nombre d'actions : *${nbreActions}*
💰 Montant : *${montantTotal.toLocaleString()} FCFA*

✅ Validez sur le dashboard admin → /dashboard/admin/purchaseActionnaire`;

    await sendWhatsAppMessageSafe('+221773878232', adminMsg);

    // WhatsApp admin — envoyer la capture de preuve directement
    if (proofUrl) {
      await sendWhatsAppImageSafe(
        '+221773878232',
        proofUrl,
        `📎 Preuve de transfert — ${user.firstName} ${user.lastName} (${serviceLabel})`
      );
    }

    return res.status(201).json({
      success:        true,
      message:        `Demande soumise pour ${nbreActions} actions. L'admin vérifiera votre transfert.`,
      transaction_id: actionsPurchase._id,
    });
  } catch (error) {
    console.error('❌ initiateActionsPurchaseTransfert:', error.message);
    return res.status(500).json({ success: false, message: 'Erreur serveur.' });
  }
};

/**
 * GET /actions/admin/transfert-pending
 * Admin : liste des achats transfert
 */
const getTransfertActionsPending = async (req, res) => {
  try {
    const { status = 'pending' } = req.query;
    const filter = { payment_method: 'transfert' };
    if (['pending', 'completed', 'rejected'].includes(status)) filter.status = status;

    const achats = await ActionsPurchase.find(filter)
      .populate('user_id', 'firstName lastName telephone nbre_actions dividende')
      .sort({ createdAt: -1 })
      .lean();

    return res.status(200).json({ success: true, achats });
  } catch (error) {
    console.error('❌ getTransfertActionsPending:', error.message);
    return res.status(500).json({ success: false, message: 'Erreur serveur.' });
  }
};

/**
 * PUT /actions/admin/transfert/:id/valider
 * Admin valide → crédite actions + bonus parrainage + contrat PDF
 */
const validateTransfertActionsPurchase = async (req, res) => {
  try {
    const { id }         = req.params;
    const { admin_note } = req.body;

    const actionsPurchase = await ActionsPurchase.findById(id);
    if (!actionsPurchase) return res.status(404).json({ success: false, message: 'Transaction introuvable.' });
    if (actionsPurchase.status !== 'pending') return res.status(400).json({ success: false, message: 'Transaction déjà traitée.' });
    if (actionsPurchase.payment_method !== 'transfert') return res.status(400).json({ success: false, message: 'Réservé aux achats transfert.' });

    const user = await User.findById(actionsPurchase.user_id);
    if (!user) return res.status(404).json({ success: false, message: 'Utilisateur introuvable.' });

    actionsPurchase.status          = 'completed';
    actionsPurchase.payment_date    = new Date();
    actionsPurchase.processed_at    = new Date();
    actionsPurchase.admin_note      = admin_note || '';
    actionsPurchase.paydunya_status = 'completed';
    await actionsPurchase.save();

    // Créditer les actions
    user.nbre_actions = (user.nbre_actions || 0) + actionsPurchase.nombre_actions;
    await user.save();

    // Bonus parrainage multi-niveaux
    await attributeBonusAuPartenaire(actionsPurchase, user);

    // Contrat PDF → WhatsApp
    const serviceLabel = TRANSFERT_LABELS[actionsPurchase.transfert_service] || 'Transfert';
    try {
      const updatedUser = await User.findById(user._id);
      const pdfBuffer   = await generateContractPDF(actionsPurchase, updatedUser);
      const fileName    = `ContratActionsTransfert_${actionsPurchase._id}_${Date.now()}.pdf`;
      const pdfResult   = await uploadPDFToS3(pdfBuffer, fileName);

      await sendPDFWhatsApp(
        user.telephone,
        pdfResult.cleanUrl,
        fileName,
        `Félicitations ${user.firstName} ${user.lastName} ! Voici votre contrat pour l'achat de ${actionsPurchase.nombre_actions.toLocaleString()} actions via ${serviceLabel} — ${actionsPurchase.montant_total.toLocaleString()} FCFA. Merci — Équipe Dioko`
      );
    } catch (pdfErr) {
      console.error('❌ Erreur contrat PDF transfert:', pdfErr.message);
      try {
        await sendWhatsAppMessageSafe(
          user.telephone,
          `✅ Achat validé — Dioko\n\nFélicitations ${user.firstName} ${user.lastName} !\n\n📊 ${actionsPurchase.nombre_actions.toLocaleString()} actions créditées.\n💰 ${actionsPurchase.montant_total.toLocaleString()} FCFA\n🏦 Via ${serviceLabel}\n\nMerci pour votre confiance !\nÉquipe Dioko`
        );
      } catch {}
    }

    return res.status(200).json({
      success: true,
      message: `${actionsPurchase.nombre_actions} actions créditées. Contrat envoyé par WhatsApp.`,
    });
  } catch (error) {
    console.error('❌ validateTransfertActionsPurchase:', error.message);
    return res.status(500).json({ success: false, message: 'Erreur serveur.' });
  }
};

/**
 * PUT /actions/admin/transfert/:id/rejeter
 */
const rejectTransfertActionsPurchase = async (req, res) => {
  try {
    const { id }         = req.params;
    const { admin_note } = req.body;

    const actionsPurchase = await ActionsPurchase.findById(id);
    if (!actionsPurchase) return res.status(404).json({ success: false, message: 'Transaction introuvable.' });
    if (actionsPurchase.status !== 'pending') return res.status(400).json({ success: false, message: 'Transaction déjà traitée.' });

    actionsPurchase.status       = 'rejected';
    actionsPurchase.processed_at = new Date();
    actionsPurchase.admin_note   = admin_note || '';
    await actionsPurchase.save();

    const serviceLabel = TRANSFERT_LABELS[actionsPurchase.transfert_service] || 'Transfert';
    try {
      const user = await User.findById(actionsPurchase.user_id);
      if (user) {
        await sendWhatsAppMessageSafe(
          user.telephone,
          `❌ Demande rejetée — Dioko\n\nBonjour ${user.firstName} ${user.lastName},\n\nVotre demande d'achat de ${actionsPurchase.nombre_actions} actions via ${serviceLabel} a été rejetée.${admin_note ? `\nRaison : ${admin_note}` : ''}\n\nContactez-nous pour plus d'informations.\nÉquipe Dioko`
        );
      }
    } catch {}

    return res.status(200).json({ success: true, message: 'Demande rejetée.' });
  } catch (error) {
    console.error('❌ rejectTransfertActionsPurchase:', error.message);
    return res.status(500).json({ success: false, message: 'Erreur serveur.' });
  }
};

// ✅ MODIFIEZ AUSSI VOTRE MODULE.EXPORTS POUR INCLURE LES NOUVELLES FONCTIONS
module.exports = {
  initiateActionsPurchase,
  getMyActionsPurchaseHistory,
  checkPaymentStatus,
  getAllTransactions,
  getSalesStatistics,
  handlePaydunyaCallback,
  attributeBonusAuPartenaire,
  sendWhatsAppMessageSafe,
  ensureUserHasPartnerField,
  ensurePartnerFieldMiddleware,
  // Crypto
  initiateActionsPurchaseCrypto,
  getCryptoActionsPending,
  validateCryptoActionsPurchase,
  rejectCryptoActionsPurchase,
  // Transfert (WU / Ria / MoneyGram)
  initiateActionsPurchaseTransfert,
  getTransfertActionsPending,
  validateTransfertActionsPurchase,
  rejectTransfertActionsPurchase,
};
