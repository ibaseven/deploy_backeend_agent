const MoratoriumConfig = require('../Models/MoratoriumConfig');
const MoratoriumPurchase = require('../Models/MoratoriumPurchase');
const ActionsPurchase = require('../Models/ActionsPurchase');
const User = require('../Models/User');
const userController = require('./UserControler');

// Fonction pour envoyer des messages WhatsApp avec gestion d'erreurs
const sendWhatsAppMessageSafe = async (telephone, message) => {
  try {
    if (typeof userController.sendWhatsAppMessage === "function") {
      const result = await userController.sendWhatsAppMessage(
        telephone,
        message
      );
      return result;
    } else {
      console.log('⚠️ Fonction sendWhatsAppMessage non disponible dans UserController');
      return null;
    }
  } catch (error) {
    console.error('❌ Erreur envoi WhatsApp:', error.message);
    return null;
  }
};

/**
 * Obtenir la configuration et le statut actuel du moratoire
 */
const getMoratoriumStatus = async (req, res) => {
  try {
    const config = await MoratoriumConfig.getConfig();
    const stats = await MoratoriumPurchase.getStats();
    const totalWaiting = await MoratoriumPurchase.getTotalWaitingActions();

    res.status(200).json({
      success: true,
      config: {
        actif: config.actif,
        seuil_actions: config.seuil_actions,
        type_validation: config.type_validation,
        description: config.description,
        date_debut: config.date_debut,
        date_fin_prevue: config.date_fin_prevue,
        nombre_validations: config.nombre_validations,
        derniere_validation_auto: config.derniere_validation_auto
      },
      stats: {
        en_attente: totalWaiting,
        historique: stats
      },
      progression: {
        actions_collectees: totalWaiting.total_actions,
        seuil: config.seuil_actions,
        pourcentage: config.actif ? Math.min((totalWaiting.total_actions / config.seuil_actions) * 100, 100).toFixed(2) : 0,
        restant: config.actif ? Math.max(config.seuil_actions - totalWaiting.total_actions, 0) : 0
      }
    });

  } catch (error) {
    console.error('Erreur getMoratoriumStatus:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération du statut',
      error: error.message
    });
  }
};

/**
 * Obtenir les achats en attente d'un utilisateur
 */
const getUserWaitingPurchases = async (req, res) => {
  try {
    const userId = req.user.id;

    const waitingPurchases = await MoratoriumPurchase.getUserWaitingPurchases(userId);

    const total = waitingPurchases.reduce((sum, p) => sum + p.nombre_actions, 0);

    res.status(200).json({
      success: true,
      achats_en_attente: waitingPurchases,
      total_actions_en_attente: total,
      count: waitingPurchases.length
    });

  } catch (error) {
    console.error('Erreur getUserWaitingPurchases:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération des achats en attente',
      error: error.message
    });
  }
};

/**
 * [ADMIN] Activer le moratoire
 */
const activerMoratoire = async (req, res) => {
  try {
    const { seuil_actions, type_validation, description } = req.body;

    // Validation
    if (!seuil_actions || seuil_actions < 1) {
      return res.status(400).json({
        success: false,
        message: 'Le seuil doit être au minimum 1 action'
      });
    }

    if (!['automatique', 'manuelle'].includes(type_validation)) {
      return res.status(400).json({
        success: false,
        message: 'Type de validation invalide (automatique ou manuelle)'
      });
    }

    const config = await MoratoriumConfig.activer(
      seuil_actions,
      type_validation,
      req.user.id,
      description
    );

    res.status(200).json({
      success: true,
      message: 'Moratoire activé avec succès',
      config: {
        actif: config.actif,
        seuil_actions: config.seuil_actions,
        type_validation: config.type_validation,
        description: config.description,
        date_debut: config.date_debut
      }
    });

  } catch (error) {
    console.error('Erreur activerMoratoire:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de l\'activation du moratoire',
      error: error.message
    });
  }
};

/**
 * [ADMIN] Désactiver le moratoire
 */
const desactiverMoratoire = async (req, res) => {
  try {
    const { notes } = req.body;

    const config = await MoratoriumConfig.desactiver(req.user.id, notes);

    res.status(200).json({
      success: true,
      message: 'Moratoire désactivé avec succès',
      config: {
        actif: config.actif,
        date_fin_prevue: config.date_fin_prevue
      }
    });

  } catch (error) {
    console.error('Erreur desactiverMoratoire:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la désactivation du moratoire',
      error: error.message
    });
  }
};

/**
 * [ADMIN] Valider manuellement tous les achats en attente
 */
const validerMoratoire = async (req, res) => {
  try {
    const { admin_notes } = req.body;

    // Récupérer les achats en attente avant validation
    const waitingPurchases = await MoratoriumPurchase.getWaitingPurchases();

    if (waitingPurchases.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Aucun achat en attente à valider'
      });
    }

    // Valider tous les achats
    const result = await MoratoriumPurchase.validateAllWaiting(
      req.user.id,
      admin_notes || 'Validation manuelle par administrateur'
    );

    // Incrémenter le compteur
    await MoratoriumConfig.incrementerValidations();

    // Envoyer des notifications WhatsApp aux utilisateurs
    const notificationPromises = waitingPurchases.map(async (purchase) => {
      if (purchase.user_id && purchase.user_id.telephone) {
        const message = `✅ *Validation de vos actions*\n\n` +
          `Bonjour ${purchase.user_id.firstName},\n\n` +
          `Vos ${purchase.nombre_actions} actions achetées ont été validées et créditées sur votre compte.\n\n` +
          `Montant: ${purchase.montant_total.toLocaleString()} FCFA\n` +
          `Date: ${new Date().toLocaleDateString('fr-FR')}\n\n` +
          `Vous pouvez consulter votre portefeuille sur votre tableau de bord.\n\n` +
          `Merci de votre confiance! 🎉`;

        try {
          await sendWhatsAppMessageSafe(purchase.user_id.telephone, message);
        } catch (error) {
          console.error(`Erreur notification WhatsApp pour ${purchase.user_id.telephone}:`, error);
        }
      }
    });

    await Promise.allSettled(notificationPromises);

    res.status(200).json({
      success: true,
      message: `${result.validated} achats validés avec succès`,
      details: {
        validated: result.validated,
        failed: result.failed,
        batch_id: result.batch_id,
        errors: result.errors
      }
    });

  } catch (error) {
    console.error('Erreur validerMoratoire:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la validation du moratoire',
      error: error.message
    });
  }
};

/**
 * [ADMIN] Obtenir la liste de tous les achats en attente
 */
const getWaitingPurchases = async (req, res) => {
  try {
    const waitingPurchases = await MoratoriumPurchase.getWaitingPurchases();
    const totalWaiting = await MoratoriumPurchase.getTotalWaitingActions();

    res.status(200).json({
      success: true,
      achats: waitingPurchases,
      totaux: totalWaiting
    });

  } catch (error) {
    console.error('Erreur getWaitingPurchases:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération des achats en attente',
      error: error.message
    });
  }
};

/**
 * [ADMIN] Obtenir les participants et leurs progressions
 */
const getParticipants = async (req, res) => {
  try {
    const participants = await MoratoriumPurchase.getParticipants();
    const config = await MoratoriumConfig.getConfig();
    const totalWaiting = await MoratoriumPurchase.getTotalWaitingActions();

    // Ajouter le pourcentage de contribution de chaque participant
    const participantsAvecProgression = participants.map(p => ({
      ...p,
      pourcentage_contribution: totalWaiting.total_actions > 0
        ? parseFloat(((p.total_actions / totalWaiting.total_actions) * 100).toFixed(2))
        : 0,
      pourcentage_du_seuil: config.seuil_actions > 0
        ? parseFloat(((p.total_actions / config.seuil_actions) * 100).toFixed(2))
        : 0
    }));

    res.status(200).json({
      success: true,
      participants: participantsAvecProgression,
      total_participants: participants.length,
      totaux: totalWaiting,
      seuil: config.seuil_actions
    });

  } catch (error) {
    console.error('Erreur getParticipants:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération des participants',
      error: error.message
    });
  }
};

/**
 * [ADMIN] Obtenir les statistiques du moratoire
 */
const getMoratoriumStats = async (req, res) => {
  try {
    const stats = await MoratoriumPurchase.getStats();
    const config = await MoratoriumConfig.getConfig();

    res.status(200).json({
      success: true,
      stats,
      config: {
        nombre_validations_total: config.nombre_validations,
        derniere_validation: config.derniere_validation_auto
      }
    });

  } catch (error) {
    console.error('Erreur getMoratoriumStats:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération des statistiques',
      error: error.message
    });
  }
};

/**
 * [USER] Annuler un achat moratoire en attente
 * L'utilisateur peut annuler un achat tant qu'il est en statut 'waiting'
 */
const annulerAchatMoratorium = async (req, res) => {
  try {
    const userId = req.user.id;
    const { moratoriumId } = req.params;

    const achat = await MoratoriumPurchase.findById(moratoriumId);

    if (!achat) {
      return res.status(404).json({
        success: false,
        message: 'Achat moratoire introuvable'
      });
    }

    // Vérifier que l'achat appartient bien à l'utilisateur connecté
    if (achat.user_id.toString() !== userId.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Vous n\'êtes pas autorisé à annuler cet achat'
      });
    }

    // On ne peut annuler que les achats en attente
    if (achat.status !== 'waiting') {
      return res.status(400).json({
        success: false,
        message: achat.status === 'validated'
          ? 'Cet achat a déjà été validé, impossible de l\'annuler'
          : 'Cet achat est déjà annulé'
      });
    }

    achat.status = 'cancelled';
    achat.cancelled_at = new Date();
    achat.cancellation_reason = 'Annulé par l\'utilisateur';
    await achat.save();

    res.status(200).json({
      success: true,
      message: `Achat de ${achat.nombre_actions} action(s) (${achat.montant_total.toLocaleString()} FCFA) annulé avec succès`
    });

  } catch (error) {
    console.error('Erreur annulerAchatMoratorium:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de l\'annulation',
      error: error.message
    });
  }
};

/**
 * [ADMIN] Ajouter manuellement un achat moratoire pour un utilisateur
 * Utilisé quand le callback de paiement a échoué mais le paiement a bien été effectué
 */
const ajouterAchatMoratoriumManuel = async (req, res) => {
  try {
    const { user_id, nombre_actions, admin_notes } = req.body;

    // Validation
    if (!user_id) {
      return res.status(400).json({
        success: false,
        message: 'ID utilisateur requis'
      });
    }

    const nbActions = parseFloat(nombre_actions) || 1;
    const prixUnitaire = 10000;
    const montantTotal = nbActions * prixUnitaire;

    // Vérifier que l'utilisateur existe
    const user = await User.findById(user_id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Utilisateur non trouvé'
      });
    }

    // Créer un enregistrement ActionsPurchase manuel (paiement effectué mais callback raté)
    const transactionId = `MANUEL_${Date.now()}_${user_id}`;
    const actionsPurchase = await ActionsPurchase.create({
      user_id,
      paydunya_transaction_id: transactionId,
      invoice_token: transactionId,
      nombre_actions: nbActions,
      prix_unitaire: prixUnitaire,
      montant_total: montantTotal,
      status: 'completed',
      payment_date: new Date(),
      processed_at: new Date(),
      processed_by: `admin_${req.user.id}`,
      admin_notes: `Ajout manuel par admin - ${admin_notes || 'Callback de paiement non reçu'}`
    });

    // Créer l'enregistrement MoratoriumPurchase
    const moratoriumPurchase = await MoratoriumPurchase.create({
      actionsPurchase_id: actionsPurchase._id,
      user_id,
      nombre_actions: nbActions,
      montant_total: montantTotal,
      prix_unitaire: prixUnitaire,
      status: 'waiting',
      admin_notes: admin_notes || 'Ajout manuel - callback de paiement non reçu'
    });

    res.status(201).json({
      success: true,
      message: `Achat moratoire de ${nbActions} action(s) (${montantTotal.toLocaleString()} FCFA) ajouté avec succès pour ${user.firstName} ${user.lastName}`,
      details: {
        user: {
          id: user._id,
          nom: `${user.firstName} ${user.lastName}`,
          telephone: user.telephone
        },
        achat: {
          nombre_actions: nbActions,
          montant_total: montantTotal,
          transaction_id: transactionId,
          moratorium_id: moratoriumPurchase._id
        }
      }
    });

  } catch (error) {
    console.error('Erreur ajouterAchatMoratoriumManuel:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de l\'ajout manuel du moratoire',
      error: error.message
    });
  }
};

module.exports = {
  getMoratoriumStatus,
  getUserWaitingPurchases,
  annulerAchatMoratorium,
  activerMoratoire,
  desactiverMoratoire,
  validerMoratoire,
  getWaitingPurchases,
  getParticipants,
  getMoratoriumStats,
  ajouterAchatMoratoriumManuel
};
