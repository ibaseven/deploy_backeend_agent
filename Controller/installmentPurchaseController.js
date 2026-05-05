const InstallmentPurchase = require('../Models/InstallmentPurchase');
const ActionsPurchase = require('../Models/ActionsPurchase');
const User = require('../Models/User');
const { createPaydunyaInvoice, verifyPaydunyaTransaction } = require('../Services/actionsPurchaseService');
const { validatePartner, hasUserReferredPartner } = require('../Utils/otp-utils');
const userController = require('./UserControler');
const { generateContractPDF } = require('../Services/contractGenerator');
const AWS  = require('aws-sdk');
const qs   = require('qs');
const axios = require('axios');

const s3 = new AWS.S3({
  accessKeyId:     process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region:          process.env.AWS_REGION,
});

// Upload PDF vers S3
const uploadPDFToS3 = async (pdfBuffer, fileName) => {
  const s3Key = `contrats/${fileName}`;
  await s3.putObject({
    Bucket:      process.env.AWS_BUCKET_NAME,
    Key:         s3Key,
    Body:        pdfBuffer,
    ContentType: 'application/pdf',
  }).promise();
  return `https://${process.env.AWS_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${s3Key}`;
};

// Envoyer PDF par WhatsApp
const sendPDFWhatsApp = async (phoneNumber, pdfUrl, fileName, caption) => {
  try {
    const data = qs.stringify({
      token:    process.env.ULTRAMSG_TOKEN,
      to:       phoneNumber.replace(/\D/g, ''),
      filename: fileName,
      document: pdfUrl,
      caption:  caption,
    });
    await axios({
      method: 'post',
      url:    `https://api.ultramsg.com/${process.env.ULTRAMSG_INSTANCE_ID}/messages/document`,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      data,
    });
  } catch (err) {
    console.error('❌ Erreur envoi PDF WhatsApp:', err.message);
  }
};

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

// ═══════════════════════════════════════════════════════════════════════════
// ADMIN : Créer un moratoire et l'assigner à un user
// POST /admin/versements/creer
// ═══════════════════════════════════════════════════════════════════════════
const creerMoratoireAdmin = async (req, res) => {
  try {
    const adminId = req.user?.id || req.userData?.id;
    const { telephone_user, prix_unitaire, montant_total } = req.body;

    if (!telephone_user || !prix_unitaire || !montant_total) {
      return res.status(400).json({ success: false, message: 'telephone_user, prix_unitaire et montant_total sont requis.' });
    }

    const prixU  = parseFloat(prix_unitaire);
    const montantT = parseFloat(montant_total);
    if (isNaN(prixU) || prixU <= 0)   return res.status(400).json({ success: false, message: 'Prix unitaire invalide.' });
    if (isNaN(montantT) || montantT <= 0) return res.status(400).json({ success: false, message: 'Montant total invalide.' });

    // Trouver le user par téléphone
    const user = await User.findOne({ telephone: telephone_user });
    if (!user) return res.status(404).json({ success: false, message: `Aucun utilisateur avec le téléphone ${telephone_user}.` });
    if (user.isBlocked || user.status !== 'active')
      return res.status(403).json({ success: false, message: 'Ce compte est bloqué ou inactif.' });

    const nombre_actions_total = Math.floor(montantT / prixU);
    if (nombre_actions_total < 1)
      return res.status(400).json({ success: false, message: 'Le montant/prix donne moins d\'1 action.' });

    const installment = new InstallmentPurchase({
      user_id:              user._id,
      nombre_actions_total,
      prix_unitaire:        prixU,
      montant_total:        montantT,
      montant_paye:         0,
      montant_restant:      montantT,
      status:               'en_cours',
      versements:           [],
      created_by_admin:     true,
      admin_creator_id:     adminId,
    });
    await installment.save();

    // WhatsApp au user
    const msg =
`📋 *Plan de versements créé — Dioko*

Bonjour ${user.firstName} ${user.lastName},

Un plan de versements a été créé pour vous par l'administration.

📊 Nombre d'actions : *${nombre_actions_total.toLocaleString()}*
💰 Prix par action : *${prixU.toLocaleString()} FCFA*
💳 Montant total : *${montantT.toLocaleString()} FCFA*
📅 1er versement minimum : *${(montantT * 0.10).toLocaleString()} FCFA* (10%)

Connectez-vous à votre espace pour effectuer vos versements.
Équipe Dioko`;

    await sendWhatsAppMessageSafe(user.telephone, msg);

    return res.status(201).json({
      success: true,
      message: `Moratoire créé pour ${user.firstName} ${user.lastName} — ${nombre_actions_total} actions.`,
      data: {
        id:                   installment._id,
        nombre_actions_total,
        prix_unitaire:        prixU,
        montant_total:        montantT,
        montant_minimum_premier_versement: montantT * 0.10,
        user: { nom: `${user.firstName} ${user.lastName}`, telephone: user.telephone },
      },
    });
  } catch (error) {
    console.error('❌ creerMoratoireAdmin:', error.message);
    return res.status(500).json({ success: false, message: 'Erreur serveur.' });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// ADMIN : Enregistrer un versement manuel
// POST /admin/versements/:id/versement-manuel
// ═══════════════════════════════════════════════════════════════════════════
const versementManuelAdmin = async (req, res) => {
  try {
    const { id } = req.params;
    const { montant, note_admin } = req.body;

    if (!montant || parseFloat(montant) <= 0)
      return res.status(400).json({ success: false, message: 'Montant invalide.' });

    const installment = await InstallmentPurchase.findById(id);
    if (!installment) return res.status(404).json({ success: false, message: 'Moratoire introuvable.' });
    if (installment.status !== 'en_cours')
      return res.status(400).json({ success: false, message: `Ce moratoire est déjà ${installment.status}.` });

    const montantF = parseFloat(montant);

    // Vérifier premier versement (10%)
    const estPremier = installment.montant_paye === 0;
    if (estPremier) {
      const min = installment.montant_total * 0.10;
      if (montantF < min)
        return res.status(400).json({ success: false, message: `Premier versement minimum : ${min.toLocaleString()} FCFA (10%).` });
    }
    if (montantF > installment.montant_restant)
      return res.status(400).json({ success: false, message: `Montant dépasse le restant (${installment.montant_restant.toLocaleString()} FCFA).` });

    const user = await User.findById(installment.user_id);
    if (!user) return res.status(404).json({ success: false, message: 'Utilisateur introuvable.' });

    const nombre_actions_equivalent = montantF / installment.prix_unitaire;
    const actionsACrediter = Math.floor(nombre_actions_equivalent);
    const tokenManuel = `MANUEL_${Date.now()}_${installment._id}`;

    // Ajouter le versement
    await installment.addVersement({
      montant:                   montantF,
      nombre_actions_equivalent,
      paydunya_transaction_id:   tokenManuel,
      payment_method:            'manuel_admin',
      payment_date:              new Date(),
    });

    const numeroVers = installment.versements.length;
    const estComplet = installment.status === 'complete';

    // ─── Commissions de parrainage sur ce versement manuel ───────────────────
    try {
      const { attributeBonusAuPartenaire } = require('./actionsPurchaseController');
      const fakeTransaction = {
        montant_total:           montantF,
        telephonePartenaire:     installment.telephonePartenaire || null,
        bonusPartenaireAttribue: false,
      };
      await attributeBonusAuPartenaire(fakeTransaction, user);
      console.log(`💸 Commissions parrainage versement manuel distribuées`);
    } catch (bonusErr) {
      console.error('❌ Erreur commissions versement manuel:', bonusErr.message);
    }

    // Créditer les actions immédiatement
    if (actionsACrediter > 0) {
      user.nbre_actions = (user.nbre_actions || 0) + actionsACrediter;
      if (!user.actionsHistory) user.actionsHistory = [];
      user.actionsHistory.push({
        date:           new Date(),
        type:           'achat',
        nombre_actions: actionsACrediter,
        montant:        montantF,
        transaction_id: tokenManuel,
        description:    `Versement manuel n°${numeroVers} — ${montantF.toLocaleString()} FCFA${note_admin ? ` — ${note_admin}` : ''}`,
      });
      await user.save();
      console.log(`✅ [Manuel] ${actionsACrediter} actions créditées à ${user.telephone}`);
    }

    // Générer et envoyer le contrat PDF
    const captionPDF = estComplet
      ? `🎉 Félicitations ${user.firstName} ${user.lastName} ! Tous vos versements sont complétés. ${actionsACrediter} actions créditées. Total : ${installment.nombre_actions_total.toLocaleString()} actions. Équipe Dioko`
      : `💳 Versement n°${numeroVers} validé — ${montantF.toLocaleString()} FCFA → ${actionsACrediter} actions créditées. Progression : ${installment.getPourcentagePaye()}% (reste ${installment.montant_restant.toLocaleString()} FCFA). Équipe Dioko`;

    try {
      const purchaseData = {
        nombre_actions: actionsACrediter,
        prix_unitaire:  installment.prix_unitaire,
        montant_total:  montantF,
        _id:            installment._id,
      };
      const pdfBuffer = await generateContractPDF(purchaseData, user);
      const fileName  = `ContratVersementManuel_${installment._id}_${numeroVers}_${Date.now()}.pdf`;
      const pdfUrl    = await uploadPDFToS3(pdfBuffer, fileName);
      await sendPDFWhatsApp(user.telephone, pdfUrl, fileName, captionPDF);
      console.log(`✅ Contrat PDF versement manuel n°${numeroVers} envoyé à ${user.telephone}`);
    } catch (pdfErr) {
      console.error('❌ Erreur PDF versement manuel:', pdfErr.message);
      try { await sendWhatsAppMessageSafe(user.telephone, captionPDF); } catch {}
    }

    return res.status(200).json({
      success: true,
      message: `Versement de ${montantF.toLocaleString()} FCFA enregistré — ${actionsACrediter} actions créditées.`,
      data: {
        montant:        montantF,
        actions_creditees: actionsACrediter,
        montant_paye:   installment.montant_paye,
        montant_restant: installment.montant_restant,
        pourcentage:    installment.getPourcentagePaye(),
        status:         installment.status,
      },
    });
  } catch (error) {
    console.error('❌ versementManuelAdmin:', error.message);
    return res.status(500).json({ success: false, message: 'Erreur serveur.' });
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// ADMIN : Liste de tous les moratoires
// GET /admin/versements/liste
// ═══════════════════════════════════════════════════════════════════════════
const getListeMoratoiresAdmin = async (req, res) => {
  try {
    const { status, search } = req.query;

    const filter = {};
    if (status && status !== 'all') filter.status = status;

    const moratoires = await InstallmentPurchase.find(filter)
      .populate('user_id', 'firstName lastName telephone nbre_actions')
      .populate('admin_creator_id', 'firstName lastName')
      .sort({ createdAt: -1 })
      .lean();

    // Filtre texte côté serveur si search
    const q = search?.toLowerCase() || '';
    const filtered = q
      ? moratoires.filter(m =>
          m.user_id?.firstName?.toLowerCase().includes(q) ||
          m.user_id?.lastName?.toLowerCase().includes(q) ||
          m.user_id?.telephone?.includes(q)
        )
      : moratoires;

    return res.status(200).json({
      success: true,
      moratoires: filtered.map(m => ({
        id:                   m._id,
        user:                 m.user_id,
        nombre_actions_total: m.nombre_actions_total,
        prix_unitaire:        m.prix_unitaire,
        montant_total:        m.montant_total,
        montant_paye:         m.montant_paye,
        montant_restant:      m.montant_restant,
        pourcentage_paye:     Math.round((m.montant_paye / m.montant_total) * 100),
        nombre_versements:    m.versements.length,
        status:               m.status,
        created_by_admin:     m.created_by_admin || false,
        admin_creator:        m.admin_creator_id,
        createdAt:            m.createdAt,
        completed_at:         m.completed_at,
      })),
    });
  } catch (error) {
    console.error('❌ getListeMoratoiresAdmin:', error.message);
    return res.status(500).json({ success: false, message: 'Erreur serveur.' });
  }
};

module.exports = {
  initiateInstallmentPurchase,
  addInstallmentPayment,
  getMyInstallmentPurchases,
  getMyInstallmentHistory,
  annulerContratVersement,
  creerMoratoireAdmin,
  versementManuelAdmin,
  getListeMoratoiresAdmin,
};