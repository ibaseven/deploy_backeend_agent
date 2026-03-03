// Controller/ActionsSaleController.js
const ActionsSale = require('../Models/ActionsSale');
const mongoose = require('mongoose');
const User = require('../Models/User');
const ActionsPurchase = require('../Models/ActionsPurchase');
// Import des fonctions WhatsApp depuis UserController
const userController = require('../Controller/UserControler');

// Prix de vente fixe par action (peut être différent du prix d'achat)
const PRIX_VENTE_ACTION = 4500; // FCFA

// Fonction pour envoyer des messages WhatsApp avec gestion d'erreurs
const sendWhatsAppMessageSafe = async (telephone, message) => {
  try {
    if (typeof userController.sendWhatsAppMessage === 'function') {
      //('📱 Envoi WhatsApp vers:', telephone);
      const result = await userController.sendWhatsAppMessage(telephone, message);
      //('✅ WhatsApp envoyé avec succès');
      return result;
    } else {
      //('⚠️ Fonction sendWhatsAppMessage non disponible dans UserController');
      //('📱 Message qui devait être envoyé:', message);
      return null;
    }
  } catch (error) {
    console.error('❌ Erreur envoi WhatsApp:', error.message);
    //('📱 Message qui devait être envoyé:', message);
    return null;
  }
};

// Fonction pour notifier l'admin
const notifyAdminForSaleRequest = async (user, demande) => {
  try {
    // Récupérer l'admin (vous pouvez adapter selon votre logique)
    const admin = await User.findOne({ role: 'admin' });
    
    if (!admin || !admin.telephone) {
      //('⚠️ Admin non trouvé ou sans téléphone');
      return;
    }

    const adminMessage = `🔔 DEMANDE DE VENTE D'ACTIONS - Dioko

Nouvelle demande de vente reçue :

👤 Actionnaire : ${user.firstName} ${user.lastName}
📱 Téléphone : ${user.telephone}
📈 Actions à vendre : ${demande.nombre_actions.toLocaleString()}
💰 Montant total : ${demande.montant_total.toLocaleString()} FCFA
📊 Actions actuelles : ${user.nbre_actions.toLocaleString()}

🔗 Connectez-vous à l'admin pour traiter cette demande.

ID Demande : ${demande._id}
⏰ ${new Date().toLocaleString('fr-FR')}

Équipe Dioko`;

    await sendWhatsAppMessageSafe(admin.telephone, adminMessage);
    //('✅ Notification admin envoyée');
  } catch (error) {
    console.error('❌ Erreur notification admin:', error.message);
  }
};

// ✅ ÉTAPE 1: CRÉER UNE DEMANDE DE VENTE D'ACTIONS
const createSaleRequest = async (req, res) => {
  try {
    // Vérifier l'authentification
    const userId = req.user?.id || req.userData?.id;
    
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Utilisateur non authentifié"
      });
    }

    //('🎯 Création demande de vente - User ID:', userId);

    // Récupérer l'utilisateur
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "Utilisateur non trouvé"
      });
    }

    // Vérifier si l'utilisateur n'est pas bloqué
   

    const { nombre_actions, motif } = req.body;

    // Validation des données
    if (!nombre_actions || !Number.isInteger(nombre_actions) || nombre_actions <= 0) {
      return res.status(400).json({
        success: false,
        message: "Le nombre d'actions doit être un nombre entier supérieur à 0"
      });
    }

    // Vérifier si l'utilisateur a suffisamment d'actions
    const actionsDisponibles = user.nbre_actions || 0;
    if (nombre_actions > actionsDisponibles) {
      return res.status(400).json({
        success: false,
        message: `Vous ne pouvez pas vendre ${nombre_actions} actions. Vous n'en possédez que ${actionsDisponibles}.`
      });
    }

    // Vérifier s'il n'y a pas déjà une demande en attente
    const demandeEnCours = await ActionsSale.findOne({
      user_id: userId,
      status: 'pending'
    });

    if (demandeEnCours) {
      return res.status(400).json({
        success: false,
        message: "Vous avez déjà une demande de vente en cours de traitement."
      });
    }

    // Calculer le montant total
    const montantTotal = nombre_actions * PRIX_VENTE_ACTION;

    //('💰 Prix unitaire de vente:', PRIX_VENTE_ACTION);
    //('💰 Montant total:', montantTotal);

    // Créer la demande de vente
    const actionsSale = new ActionsSale({
      user_id: userId,
      nombre_actions: nombre_actions,
      prix_unitaire: PRIX_VENTE_ACTION,
      montant_total: montantTotal,
      motif: motif || 'Vente d\'actions',
      status: 'pending',
      date_demande: new Date(),
      metadata: {
        actions_disponibles_avant_vente: actionsDisponibles,
        user_agent: req.headers['user-agent'],
        ip_address: req.ip || req.connection.remoteAddress
      }
    });

    await actionsSale.save();
    //('✅ Demande de vente créée avec ID:', actionsSale._id);

    // Message WhatsApp de confirmation à l'utilisateur
    const confirmationMessage = `📈 DEMANDE DE VENTE CRÉÉE - Dioko

Bonjour ${user.firstName} ${user.lastName},

Votre demande de vente d'actions a été créée avec succès !

📈 Actions à vendre : ${nombre_actions.toLocaleString()}
💰 Prix unitaire : ${PRIX_VENTE_ACTION.toLocaleString()} FCFA
💳 Montant total : ${montantTotal.toLocaleString()} FCFA
📊 Actions restantes : ${(actionsDisponibles - nombre_actions).toLocaleString()}

⏳ Votre demande est en attente de validation par l'administrateur.

Vous recevrez une notification dès qu'elle sera traitée.

Merci pour votre confiance !
Équipe Dioko`;

    // Envoyer le message WhatsApp à l'utilisateur
    try {
      await sendWhatsAppMessageSafe(user.telephone, confirmationMessage);
      //('✅ Message WhatsApp de confirmation envoyé');
    } catch (msgError) {
      console.error("❌ Erreur envoi WhatsApp utilisateur:", msgError.message);
    }

    // Notifier l'admin
    try {
      await notifyAdminForSaleRequest(user, actionsSale);
    } catch (adminError) {
      console.error("❌ Erreur notification admin:", adminError.message);
    }

    // Retourner la réponse
    return res.status(201).json({
      success: true,
      message: "Demande de vente créée avec succès",
      demande: {
        id: actionsSale._id,
        nombre_actions: actionsSale.nombre_actions,
        prix_unitaire: actionsSale.prix_unitaire,
        montant_total: actionsSale.montant_total,
        status: actionsSale.status,
        date_demande: actionsSale.date_demande,
        actions_restantes_apres_vente: actionsDisponibles - nombre_actions
      }
    });

  } catch (error) {
    console.error('❌ Erreur création demande de vente:', error);
    res.status(500).json({
      success: false,
      message: "Erreur lors de la création de la demande de vente",
      error: error.message
    });
  }
};

// ✅ RÉCUPÉRER MES DEMANDES DE VENTE
const getMySaleRequests = async (req, res) => {
  try {
    const userId = req.user?.id || req.userData?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Utilisateur non authentifié"
      });
    }

    const { page = 1, limit = 10, status } = req.query;
    const skip = (page - 1) * limit;

    //('📋 Récupération mes demandes de vente pour user:', userId);

    // Construire la requête
    let query = { user_id: userId };
    if (status) {
      query.status = status;
    }

    // Récupérer les demandes
    const demandes = await ActionsSale.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const totalDemandes = await ActionsSale.countDocuments(query);

    // Calculer les statistiques personnelles
    const stats = await ActionsSale.aggregate([
      { $match: { user_id: new mongoose.Types.ObjectId(userId) } },
      {
        $group: {
          _id: null,
          total_actions_vendues: {
            $sum: {
              $cond: [{ $eq: ['$status', 'approved'] }, '$nombre_actions', 0]
            }
          },
          total_montant_recu: {
            $sum: {
              $cond: [{ $eq: ['$status', 'approved'] }, '$montant_total', 0]
            }
          },
          demandes_approuvees: {
            $sum: {
              $cond: [{ $eq: ['$status', 'approved'] }, 1, 0]
            }
          },
          demandes_en_attente: {
            $sum: {
              $cond: [{ $eq: ['$status', 'pending'] }, 1, 0]
            }
          },
          demandes_rejetees: {
            $sum: {
              $cond: [{ $eq: ['$status', 'rejected'] }, 1, 0]
            }
          }
        }
      }
    ]);

    const statistiques = stats.length > 0 ? stats[0] : {
      total_actions_vendues: 0,
      total_montant_recu: 0,
      demandes_approuvees: 0,
      demandes_en_attente: 0,
      demandes_rejetees: 0
    };

    return res.status(200).json({
      success: true,
      message: "Mes demandes de vente récupérées",
      demandes: demandes.map(d => ({
        id: d._id,
        nombre_actions: d.nombre_actions,
        prix_unitaire: d.prix_unitaire,
        montant_total: d.montant_total,
        status: d.status,
        motif: d.motif,
        date_demande: d.date_demande,
        date_traitement: d.date_traitement,
        commentaire_admin: d.commentaire_admin,
        created_at: d.createdAt,
        updated_at: d.updatedAt
      })),
      pagination: {
        current_page: parseInt(page),
        total_pages: Math.ceil(totalDemandes / limit),
        total_demandes: totalDemandes,
        per_page: parseInt(limit)
      },
      statistiques: {
        total_actions_vendues: statistiques.total_actions_vendues,
        total_montant_recu: parseFloat(statistiques.total_montant_recu.toFixed(2)),
        demandes_approuvees: statistiques.demandes_approuvees,
        demandes_en_attente: statistiques.demandes_en_attente,
        demandes_rejetees: statistiques.demandes_rejetees
      }
    });

  } catch (error) {
    console.error('❌ Erreur récupération mes demandes:', error);
    res.status(500).json({
      success: false,
      message: "Erreur lors de la récupération des demandes",
      error: error.message
    });
  }
};

// ✅ RÉCUPÉRER TOUTES LES DEMANDES DE VENTE (ADMIN SEULEMENT)
const getAllSaleRequests = async (req, res) => {
  try {
    
    // Vérifier si l'utilisateur est admin
    const adminUser = await User.findById(req.user?.id || req.userData?.id);
    //console.log('🔐 Admin user trouvé:', adminUser ? `${adminUser.firstName} ${adminUser.lastName} (${adminUser.role})` : 'AUCUN');
    
    if (!adminUser || adminUser.role !== 'admin') {
      console.log('❌ Accès refusé - pas admin');
      return res.status(403).json({
        success: false,
        message: "Accès refusé. Seuls les administrateurs peuvent voir cette information."
      });
    }

    const { page = 1, limit = 20, status, user_id } = req.query;
    const skip = (page - 1) * limit;

   // console.log('📊 Paramètres de pagination:', { page, limit, skip });

    // Construire la requête
    let query = {};
    if (status) {
      query.status = status;
    }
    if (user_id) {
      query.user_id = user_id;
    }
    
   // console.log('🔍 Query MongoDB:', query);

    // AJOUT: Vérifier le nombre total de documents AVANT la pagination
    const totalInDatabase = await ActionsSale.countDocuments({});
   // console.log('📈 Total demandes en base (sans filtre):', totalInDatabase);

    // Récupérer les demandes avec les informations utilisateur
    const demandes = await ActionsSale.find(query)
      .populate('user_id', 'firstName lastName telephone nbre_actions dividende')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

   // console.log('📋 Demandes récupérées:', demandes.length);
   /*  console.log('📋 Première demande (si existe):', demandes[0] ? {
      id: demandes[0]._id,
      status: demandes[0].status,
      user: demandes[0].user_id ? `${demandes[0].user_id.firstName} ${demandes[0].user_id.lastName}` : 'USER_NULL'
    } : 'AUCUNE'); */

    const totalDemandes = await ActionsSale.countDocuments(query);
   // console.log('📊 Total avec filtres:', totalDemandes);

    // Le reste de votre code...
    const stats = await ActionsSale.aggregate([
      {
        $group: {
          _id: null,
          total_actions_vendues: {
            $sum: {
              $cond: [{ $eq: ['$status', 'approved'] }, '$nombre_actions', 0]
            }
          },
          total_montant_verse: {
            $sum: {
              $cond: [{ $eq: ['$status', 'approved'] }, '$montant_total', 0]
            }
          },
          demandes_approuvees: {
            $sum: {
              $cond: [{ $eq: ['$status', 'approved'] }, 1, 0]
            }
          },
          demandes_en_attente: {
            $sum: {
              $cond: [{ $eq: ['$status', 'pending'] }, 1, 0]
            }
          },
          demandes_rejetees: {
            $sum: {
              $cond: [{ $eq: ['$status', 'rejected'] }, 1, 0]
            }
          }
        }
      }
    ]);

    const statistiques = stats.length > 0 ? stats[0] : {
      total_actions_vendues: 0,
      total_montant_verse: 0,
      demandes_approuvees: 0,
      demandes_en_attente: 0,
      demandes_rejetees: 0
    };

    //console.log('📊 Statistiques calculées:', statistiques);

    const response = {
      success: true,
      message: "Demandes de vente récupérées avec succès",
     demandes: demandes.map(d => ({
  id: d._id,
  utilisateur: d.user_id ? {
    id: d.user_id._id,
    nom: `${d.user_id.firstName} ${d.user_id.lastName}`,
    telephone: d.user_id.telephone,
    actions_actuelles: d.user_id.nbre_actions || 0,
    dividendes_actuels: d.user_id.dividende || 0
  } : {
    id: null,
    nom: "Utilisateur supprimé",
    telephone: "N/A",
    actions_actuelles: 0,
    dividendes_actuels: 0
  },
  nombre_actions: d.nombre_actions,
  prix_unitaire: d.prix_unitaire,
  montant_total: d.montant_total,
  status: d.status,
  motif: d.motif,
  date_demande: d.date_demande,
  date_traitement: d.date_traitement,
  commentaire_admin: d.commentaire_admin,
  created_at: d.createdAt,
  updated_at: d.updatedAt
})),
      pagination: {
        current_page: parseInt(page),
        total_pages: Math.ceil(totalDemandes / limit),
        total_demandes: totalDemandes,
        per_page: parseInt(limit)
      },
      statistiques: {
        total_actions_vendues: statistiques.total_actions_vendues,
        total_montant_verse: parseFloat(statistiques.total_montant_verse.toFixed(2)),
        demandes_approuvees: statistiques.demandes_approuvees,
        demandes_en_attente: statistiques.demandes_en_attente,
        demandes_rejetees: statistiques.demandes_rejetees
      }
    };

   /*  console.log('✅ Réponse finale:', {
      nombre_demandes: response.demandes.length,
      pagination: response.pagination,
      stats: response.statistiques
    }); */

    return res.status(200).json(response);

  } catch (error) {
    console.error('❌ Erreur récupération demandes admin:', error);
    res.status(500).json({
      success: false,
      message: "Erreur lors de la récupération des demandes",
      error: error.message
    });
  }
};

// ✅ APPROUVER UNE DEMANDE DE VENTE (ADMIN SEULEMENT)
// ✅ APPROUVER UNE DEMANDE DE VENTE (ADMIN SEULEMENT)
const approveSaleRequest = async (req, res) => {
  try {
    // Vérifier si l'utilisateur est admin
    const adminUser = await User.findById(req.user?.id || req.userData?.id);
    
    if (!adminUser || adminUser.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: "Accès refusé. Seuls les administrateurs peuvent approuver les demandes."
      });
    }

    const { demandeId } = req.params;
    const { commentaire } = req.body;

    //('✅ Approbation demande de vente:', demandeId);

    // Trouver la demande
    const demande = await ActionsSale.findById(demandeId);
    if (!demande) {
      return res.status(404).json({
        success: false,
        message: "Demande de vente non trouvée"
      });
    }

    // Vérifier si la demande est en attente
    if (demande.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: "Cette demande a déjà été traitée"
      });
    }

    // Récupérer l'utilisateur
    const user = await User.findById(demande.user_id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "Utilisateur non trouvé"
      });
    }

    // Vérifier si l'utilisateur a encore suffisamment d'actions
    if (user.nbre_actions < demande.nombre_actions) {
      return res.status(400).json({
        success: false,
        message: `L'utilisateur ne possède plus assez d'actions. Actions actuelles: ${user.nbre_actions}, demandées: ${demande.nombre_actions}`
      });
    }

    // Effectuer la transaction
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      // Retirer les actions de l'utilisateur
      user.nbre_actions -= demande.nombre_actions;
      
      // Ajouter le montant aux dividendes
      user.dividende = (user.dividende || 0) + demande.montant_total;
      
      await user.save({ session });

      // Mettre à jour le statut de la demande
      demande.status = 'approved';
      demande.date_traitement = new Date();
      demande.commentaire_admin = commentaire || 'Demande approuvée';
      demande.admin_id = adminUser._id;

      await demande.save({ session });

      await session.commitTransaction();
      //('✅ Transaction approuvée et traitée');

      // Message WhatsApp de confirmation
      const confirmationMessage = `✅ VENTE APPROUVÉE - Dioko

Excellente nouvelle ${user.firstName} ${user.lastName} !

Votre demande de vente d'actions a été approuvée ! 🎉

📈 Actions vendues : ${demande.nombre_actions.toLocaleString()}
💰 Montant reçu : ${demande.montant_total.toLocaleString()} FCFA
📊 Actions restantes : ${user.nbre_actions.toLocaleString()}
💳 Nouveau solde dividendes : ${user.dividende.toLocaleString()} FCFA

Le montant a été ajouté à votre compte dividendes.

${commentaire ? `📝 Commentaire admin: ${commentaire}` : ''}

Merci pour votre confiance !
Équipe Dioko 🚀`;

      // Envoyer le message WhatsApp
      try {
        await sendWhatsAppMessageSafe(user.telephone, confirmationMessage);
        //('✅ Message WhatsApp d\'approbation envoyé');
      } catch (msgError) {
        console.error("❌ Erreur envoi WhatsApp:", msgError.message);
      }

      return res.status(200).json({
        success: true,
        message: "Demande de vente approuvée avec succès",
        demande: {
          id: demande._id,
          status: demande.status,
          date_traitement: demande.date_traitement,
          commentaire_admin: demande.commentaire_admin
        },
        user_after_transaction: {
          actions_restantes: user.nbre_actions,
          nouveau_solde_dividendes: user.dividende
        }
      });

    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }

  } catch (error) {
    console.error('❌ Erreur approbation demande:', error);
    res.status(500).json({
      success: false,
      message: "Erreur lors de l'approbation de la demande",
      error: error.message
    });
  }
};

// ✅ REJETER UNE DEMANDE DE VENTE (ADMIN SEULEMENT)
const rejectSaleRequest = async (req, res) => {
  try {
    // Vérifier si l'utilisateur est admin
    const adminUser = await User.findById(req.user?.id || req.userData?.id);
    
    if (!adminUser || adminUser.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: "Accès refusé. Seuls les administrateurs peuvent rejeter les demandes."
      });
    }

    const { demandeId } = req.params;
    const { commentaire } = req.body;

    //('❌ Rejet demande de vente:', demandeId);

    // Trouver la demande
    const demande = await ActionsSale.findById(demandeId);
    if (!demande) {
      return res.status(404).json({
        success: false,
        message: "Demande de vente non trouvée"
      });
    }

    // Vérifier si la demande est en attente
    if (demande.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: "Cette demande a déjà été traitée"
      });
    }

    // Récupérer l'utilisateur
    const user = await User.findById(demande.user_id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "Utilisateur non trouvé"
      });
    }

    // Mettre à jour le statut de la demande
    demande.status = 'rejected';
    demande.date_traitement = new Date();
    demande.commentaire_admin = commentaire || 'Demande rejetée';
    demande.admin_id = adminUser._id;

    await demande.save();
    //('✅ Demande rejetée');

    // Message WhatsApp de rejet
    const rejectionMessage = `❌ VENTE REJETÉE - Dioko

Bonjour ${user.firstName} ${user.lastName},

Nous regrettons de vous informer que votre demande de vente d'actions a été rejetée.

📈 Actions demandées : ${demande.nombre_actions.toLocaleString()}
💰 Montant demandé : ${demande.montant_total.toLocaleString()} FCFA

📝 Raison du rejet : ${commentaire || 'Non spécifiée'}

Vous pouvez soumettre une nouvelle demande si les conditions sont remplies.

Pour plus d'informations, contactez l'administration.

Équipe Dioko`;

    // Envoyer le message WhatsApp
    try {
      await sendWhatsAppMessageSafe(user.telephone, rejectionMessage);
      //('✅ Message WhatsApp de rejet envoyé');
    } catch (msgError) {
      console.error("❌ Erreur envoi WhatsApp:", msgError.message);
    }

    return res.status(200).json({
      success: true,
      message: "Demande de vente rejetée avec succès",
      demande: {
        id: demande._id,
        status: demande.status,
        date_traitement: demande.date_traitement,
        commentaire_admin: demande.commentaire_admin
      }
    });

  } catch (error) {
    console.error('❌ Erreur rejet demande:', error);
    res.status(500).json({
      success: false,
      message: "Erreur lors du rejet de la demande",
      error: error.message
    });
  }
};

// ✅ RÉCUPÉRER LES STATISTIQUES DE VENTE (ADMIN)
const getSalesStatistics = async (req, res) => {
  try {
    // Vérifier si l'utilisateur est admin
    const adminUser = await User.findById(req.user?.id || req.userData?.id);
    
    if (!adminUser || adminUser.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: "Accès refusé. Seuls les administrateurs peuvent voir cette information."
      });
    }

    const { periode = '30' } = req.query;
    const dateLimit = new Date();
    dateLimit.setDate(dateLimit.getDate() - parseInt(periode));

    //('📈 Admin récupération statistiques ventes - Période:', periode, 'jours');

    // Statistiques globales
    const statsGlobales = await ActionsSale.aggregate([
      {
        $group: {
          _id: null,
          total_actions_vendues: {
            $sum: {
              $cond: [{ $eq: ['$status', 'approved'] }, '$nombre_actions', 0]
            }
          },
          total_montant_verse: {
            $sum: {
              $cond: [{ $eq: ['$status', 'approved'] }, '$montant_total', 0]
            }
          },
          demandes_approuvees: {
            $sum: {
              $cond: [{ $eq: ['$status', 'approved'] }, 1, 0]
            }
          },
          demandes_en_attente: {
            $sum: {
              $cond: [{ $eq: ['$status', 'pending'] }, 1, 0]
            }
          },
          demandes_rejetees: {
            $sum: {
              $cond: [{ $eq: ['$status', 'rejected'] }, 1, 0]
            }
          }
        }
      }
    ]);

    // Statistiques pour la période
    const statsPeriode = await ActionsSale.aggregate([
      {
        $match: {
          createdAt: { $gte: dateLimit }
        }
      },
      {
        $group: {
          _id: null,
          actions_vendues_periode: {
            $sum: {
              $cond: [{ $eq: ['$status', 'approved'] }, '$nombre_actions', 0]
            }
          },
          montant_verse_periode: {
            $sum: {
              $cond: [{ $eq: ['$status', 'approved'] }, '$montant_total', 0]
            }
          },
          demandes_periode: { $sum: 1 }
        }
      }
    ]);

    const global = statsGlobales.length > 0 ? statsGlobales[0] : {
      total_actions_vendues: 0,
      total_montant_verse: 0,
      demandes_approuvees: 0,
      demandes_en_attente: 0,
      demandes_rejetees: 0
    };

    const periode_stats = statsPeriode.length > 0 ? statsPeriode[0] : {
      actions_vendues_periode: 0,
      montant_verse_periode: 0,
      demandes_periode: 0
    };

    return res.status(200).json({
      success: true,
      message: "Statistiques de vente récupérées avec succès",
      periode_analysee: `${periode} derniers jours`,
      statistiques: {
        global: {
          total_actions_vendues: global.total_actions_vendues,
          total_montant_verse: parseFloat(global.total_montant_verse.toFixed(2)),
          demandes_approuvees: global.demandes_approuvees,
          demandes_en_attente: global.demandes_en_attente,
          demandes_rejetees: global.demandes_rejetees,
          prix_unitaire_actuel: PRIX_VENTE_ACTION
        },
        periode: {
          actions_vendues: periode_stats.actions_vendues_periode,
          montant_verse: parseFloat(periode_stats.montant_verse_periode.toFixed(2)),
          demandes_periode: periode_stats.demandes_periode
        }
      }
    });

  } catch (error) {
    console.error('❌ Erreur récupération statistiques:', error);
    res.status(500).json({
      success: false,
      message: "Erreur lors de la récupération des statistiques",
      error: error.message
    });
  }
};

module.exports = {
  createSaleRequest,
  getMySaleRequests,
  getAllSaleRequests,
  approveSaleRequest,
  rejectSaleRequest,
  getSalesStatistics
};