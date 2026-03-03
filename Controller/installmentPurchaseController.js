const InstallmentPurchase = require('../Models/InstallmentPurchase');
const ActionsPurchase = require('../Models/ActionsPurchase');
const User = require('../Models/User');
const { createPaydunyaInvoice, verifyPaydunyaTransaction } = require('../Services/actionsPurchaseService');
const { validatePartner, hasUserReferredPartner } = require('../Utils/otp-utils');
const userController = require('./UserControler');

// Fonction pour envoyer des messages WhatsApp
const sendWhatsAppMessageSafe = async (telephone, message) => {
  try {
    if (typeof userController.sendWhatsAppMessage === "function") {
      return await userController.sendWhatsAppMessage(telephone, message);
    }
    return null;
  } catch (error) {
    console.error('❌ Erreur envoi WhatsApp:', error.message);
    return null;
  }
};


const initiateInstallmentPurchase = async (req, res) => {
  try {
    const userId = req.user?.id || req.userData?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Utilisateur non authentifié"
      });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "Utilisateur non trouvé"
      });
    }

    if (user.isBlocked || user.status !== "active") {
      return res.status(403).json({
        success: false,
        message: "Votre compte est bloqué ou inactif"
      });
    }

    const { nombre_actions, telephonePartenaire: nouveauTelephonePartenaire } = req.body;

    if (!nombre_actions || typeof nombre_actions !== "number" || nombre_actions < 100) {
      return res.status(400).json({
        success: false,
        message: "Le nombre d'actions doit être au minimum 100"
      });
    }

    if (nombre_actions > 1000000) {
      return res.status(400).json({
        success: false,
        message: "Le nombre d'actions doit être inférieur à 1,000,000"
      });
    }

    // Gestion du partenaire
    let telephonePartenaire = nouveauTelephonePartenaire || user.telephonePartenaire || null;
    let partenaireValide = null;
    let isFirstTimeWithPartner = false;

    if (nouveauTelephonePartenaire) {
      const { isValid, partenaire } = await validatePartner(user._id, nouveauTelephonePartenaire);

      if (!isValid) {
        return res.status(400).json({
          success: false,
          message: "Partenaire invalide"
        });
      }

      partenaireValide = partenaire;

      const hasReferredBefore = await hasUserReferredPartner(user._id, nouveauTelephonePartenaire);
      if (!hasReferredBefore) {
        isFirstTimeWithPartner = true;
      }

      // Mettre à jour le partenaire si nécessaire
      if (!user.telephonePartenaire) {
        user.telephonePartenaire = nouveauTelephonePartenaire;
        await user.save();
      }
    } else if (user.telephonePartenaire) {
      const { isValid, partenaire } = await validatePartner(user._id, user.telephonePartenaire);
      if (isValid) {
        partenaireValide = partenaire;
        telephonePartenaire = user.telephonePartenaire;
      }
    }

    // Prix fixe pour le moratoire
    const prix_unitaire = 2500;
    const montant_total = prix_unitaire * nombre_actions;

    // Créer le contrat d'achat par versements
    const installmentPurchase = new InstallmentPurchase({
      user_id: userId,
      nombre_actions_total: nombre_actions,
      prix_unitaire: prix_unitaire,
      montant_total: montant_total,
      montant_paye: 0,
      montant_restant: montant_total,
      telephonePartenaire: telephonePartenaire,
      partenaireId: partenaireValide?._id || null,
      status: 'en_cours',
      versements: [],
      metadata: {
        user_agent: req.headers["user-agent"],
        ip_address: req.ip || req.connection.remoteAddress,
        premier_achat_avec_partenaire: isFirstTimeWithPartner
      }
    });

    await installmentPurchase.save();



    return res.status(200).json({
      success: true,
      message: "Contrat d'achat par versements créé avec succès",
      data: {
        installment_purchase_id: installmentPurchase._id,
        nombre_actions_total: nombre_actions,
        prix_unitaire: prix_unitaire,
        montant_total: montant_total,
        montant_restant: montant_total,
        montant_minimum_premier_versement: montant_total * 0.10,
        montant_minimum_versements_suivants: 1000,
        partenaire: partenaireValide ? {
          nom: `${partenaireValide.firstName} ${partenaireValide.lastName}`,
          telephone: partenaireValide.telephone
        } : null
      }
    });

  } catch (error) {
    console.error('❌ Erreur création contrat:', error);
    res.status(500).json({
      success: false,
      message: "Erreur lors de la création du contrat",
      error: error.message
    });
  }
};

/**
 * ÉTAPE 2: Faire un versement
 * L'utilisateur paie le montant qu'il veut (minimum = 10% du total ou 1000 FCFA)
 */
const addInstallmentPayment = async (req, res) => {
  try {
    const userId = req.user?.id || req.userData?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Utilisateur non authentifié"
      });
    }

    const { installment_purchase_id, montant } = req.body;

    // Validation
    if (!installment_purchase_id || !montant) {
      return res.status(400).json({
        success: false,
        message: "ID du contrat et montant requis"
      });
    }

    if (typeof montant !== 'number' || montant <= 0) {
      return res.status(400).json({
        success: false,
        message: "Le montant doit être un nombre positif"
      });
    }

    // Récupérer le contrat
    const installmentPurchase = await InstallmentPurchase.findById(installment_purchase_id);

    if (!installmentPurchase) {
      return res.status(404).json({
        success: false,
        message: "Contrat d'achat introuvable"
      });
    }

    // Vérifier que c'est bien le bon utilisateur
    //console.log('🔍 Vérification propriétaire:');
    //console.log('  - user_id du contrat:', installmentPurchase.user_id.toString());
    //console.log('  - userId connecté:', userId);
    //console.log('  - userId type:', typeof userId);

    if (installmentPurchase.user_id.toString() !== userId.toString()) {
      return res.status(403).json({
        success: false,
        message: "Ce contrat ne vous appartient pas"
      });
    }

    // Vérifier que le contrat est en cours
    if (installmentPurchase.status !== 'en_cours') {
      return res.status(400).json({
        success: false,
        message: `Ce contrat est ${installmentPurchase.status}`
      });
    }

    const user = await User.findById(userId);

    // Calculer le nombre d'actions correspondant au montant
    const nombre_actions = montant / installmentPurchase.prix_unitaire;

    // Vérifier si c'est le premier versement
    const estPremierVersement = installmentPurchase.montant_paye === 0;

    if (estPremierVersement) {
      // Premier versement : minimum 10% du montant total
      const montant_minimum_10_pourcent = installmentPurchase.montant_total * 0.10;
      if (montant < montant_minimum_10_pourcent) {
        return res.status(400).json({
          success: false,
          message: `Pour le premier versement, vous devez payer au moins 10% du montant total (${montant_minimum_10_pourcent.toLocaleString()} FCFA)`
        });
      }
    } else {
      // Versements suivants : libre, juste vérifier que > 0
      if (montant <= 0) {
        return res.status(400).json({
          success: false,
          message: 'Le montant doit être supérieur à 0'
        });
      }
    }

    // Vérifier qu'on ne dépasse pas le montant restant
    if (montant > installmentPurchase.montant_restant) {
      return res.status(400).json({
        success: false,
        message: `Le montant du versement (${montant.toLocaleString()} FCFA) dépasse le montant restant (${installmentPurchase.montant_restant.toLocaleString()} FCFA)`
      });
    }

    // Créer la facture PayDunya pour ce versement
    const paydunyaResponse = await createPaydunyaInvoice(
      userId,
      nombre_actions,
      montant,
      {
        type: 'installment_payment',
        installment_purchase_id: installment_purchase_id
      }
    );

    if (!paydunyaResponse.success) {
      throw new Error("Erreur lors de la création de la facture PayDunya");
    }

    // Enregistrer le token DiokoLink pour que le callback puisse retrouver ce versement
    const versementTracker = new ActionsPurchase({
      user_id: userId,
      paydunya_transaction_id: paydunyaResponse.token,
      invoice_token: paydunyaResponse.token,
      nombre_actions: nombre_actions,
      prix_unitaire: installmentPurchase.prix_unitaire,
      montant_total: montant,
      status: 'pending',
      metadata: {
        paydunya_response: {
          transaction_type: 'installment_payment',
          installment_purchase_id: installment_purchase_id.toString()
        }
      }
    });
    await versementTracker.save();

    // Message WhatsApp
    const numeroVersement = installmentPurchase.versements.length + 1;
    const totalVerseApres = installmentPurchase.montant_paye + montant;
  

    return res.status(200).json({
      success: true,
      message: "Versement initié avec succès",
      payment_info: {
        transaction_id: paydunyaResponse.token,
        payment_url: paydunyaResponse.response_text,
        montant_versement: montant,
        nombre_actions: nombre_actions
      },
      contrat: {
        montant_total: installmentPurchase.montant_total,
        montant_paye: installmentPurchase.montant_paye,
        montant_restant_avant: installmentPurchase.montant_restant,
        montant_restant_apres: installmentPurchase.montant_restant - montant,
        pourcentage_paye: Math.round((installmentPurchase.montant_paye / installmentPurchase.montant_total) * 100)
      },
      redirect_url: paydunyaResponse.response_text
    });

  } catch (error) {
    console.error('❌ Erreur ajout versement:', error);
    res.status(500).json({
      success: false,
      message: "Erreur lors de l'ajout du versement",
      error: error.message
    });
  }
};


const getMyInstallmentPurchases = async (req, res) => {
  try {
    const userId = req.user?.id || req.userData?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Utilisateur non authentifié"
      });
    }

    const purchases = await InstallmentPurchase.getUserActivePurchases(userId);

    const purchasesWithProgress = purchases.map(p => ({
      id: p._id,
      nombre_actions_total: p.nombre_actions_total,
      prix_unitaire: p.prix_unitaire,
      montant_total: p.montant_total,
      montant_paye: p.montant_paye,
      montant_restant: p.montant_restant,
      pourcentage_paye: p.getPourcentagePaye(),
      nombre_versements: p.versements.length,
      status: p.status,
      createdAt: p.createdAt
    }));

    return res.status(200).json({
      success: true,
      message: "Achats en cours récupérés",
      data: purchasesWithProgress
    });

  } catch (error) {
    console.error('❌ Erreur récupération achats:', error);
    res.status(500).json({
      success: false,
      message: "Erreur lors de la récupération des achats",
      error: error.message
    });
  }
};


const getMyInstallmentHistory = async (req, res) => {
  try {
    const userId = req.user?.id || req.userData?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Utilisateur non authentifié"
      });
    }

    const history = await InstallmentPurchase.getUserHistory(userId);

    const historyWithDetails = history.map(p => ({
      id: p._id,
      nombre_actions_total: p.nombre_actions_total,
      montant_total: p.montant_total,
      montant_paye: p.montant_paye,
      pourcentage_paye: p.getPourcentagePaye(),
      nombre_versements: p.versements.length,
      status: p.status,
      createdAt: p.createdAt,
      completed_at: p.completed_at
    }));

    return res.status(200).json({
      success: true,
      message: "Historique récupéré",
      data: historyWithDetails
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

/**
 * Annuler un contrat de versements
 * L'utilisateur peut annuler un contrat en_cours tant qu'il n'est pas complété
 */
const annulerContratVersement = async (req, res) => {
  try {
    const userId = req.user?.id || req.userData?.id;
    const { contractId } = req.params;

    const contrat = await InstallmentPurchase.findById(contractId);

    if (!contrat) {
      return res.status(404).json({
        success: false,
        message: 'Contrat introuvable'
      });
    }

    // Vérifier que le contrat appartient à l'utilisateur connecté
    if (contrat.user_id.toString() !== userId.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Vous n\'êtes pas autorisé à annuler ce contrat'
      });
    }

    // On ne peut annuler que les contrats en cours
    if (contrat.status !== 'en_cours') {
      return res.status(400).json({
        success: false,
        message: contrat.status === 'complete'
          ? 'Ce contrat est déjà complété, impossible de l\'annuler'
          : 'Ce contrat est déjà annulé'
      });
    }

    contrat.status = 'annule';
    await contrat.save();

    res.status(200).json({
      success: true,
      message: `Contrat de ${contrat.nombre_actions_total} actions annulé avec succès`
    });

  } catch (error) {
    console.error('❌ Erreur annulation contrat:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de l\'annulation du contrat',
      error: error.message
    });
  }
};

module.exports = {
  initiateInstallmentPurchase,
  addInstallmentPayment,
  getMyInstallmentPurchases,
  getMyInstallmentHistory,
  annulerContratVersement
};