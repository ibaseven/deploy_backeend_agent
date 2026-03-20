const Project = require('../Models/Project');
const ProjectInvestment = require('../Models/ProjectInvestment');
const User = require('../Models/User');
const { initializePayment, checkPaymentStatus: checkDiokolinkStatus, DIOKOLINK_CONFIG } = require('../Services/diokolinkService');

// =====================================================
// 🏗️ ADMIN — GESTION DES PROJETS
// =====================================================

const _buildS3Url = (fileName) => {
  if (!fileName) return null;
  return `https://${process.env.AWS_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${fileName}`;
};

const createProject = async (req, res) => {
  try {
    const { nom, description, prix_action, statut } = req.body;

    if (!nom || !description || !prix_action) {
      return res.status(400).json({
        success: false,
        message: 'Les champs nom, description et prix par action sont obligatoires'
      });
    }

    const prixActionNum = Number(prix_action);
    if (isNaN(prixActionNum) || prixActionNum <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Le prix par action doit être un nombre valide supérieur à 0'
      });
    }

    // Récupérer les fichiers uploadés via multer (champs: logo, rapport)
    const logoFileName = req.uploadedFiles?.find(f => f.field === 'logo')?.fileName
      || req.files?.logo?.[0]?.originalname || null;
    const rapportFileName = req.uploadedFiles?.find(f => f.field === 'rapport')?.fileName
      || req.files?.rapport?.[0]?.originalname || null;

    const project = new Project({
      nom,
      description,
      prix_action: prixActionNum,
      image_url: logoFileName ? _buildS3Url(logoFileName) : null,
      rapport_pdf_url: rapportFileName ? _buildS3Url(rapportFileName) : null,
      statut: statut || 'brouillon',
      cree_par: req.user._id
    });

    await project.save();

    return res.status(201).json({
      success: true,
      message: 'Projet créé avec succès',
      data: project
    });
  } catch (error) {
    console.error('Erreur createProject:', error);
    return res.status(500).json({ success: false, message: 'Erreur serveur', error: error.message });
  }
};

const updateProject = async (req, res) => {
  try {
    const { projectId } = req.params;
    const allowedFields = ['nom', 'description', 'prix_action', 'statut'];

    const updates = {};
    allowedFields.forEach(field => {
      if (req.body[field] !== undefined && req.body[field] !== '') {
        updates[field] = field === 'prix_action' ? Number(req.body[field]) : req.body[field];
      }
    });

    // Valider prix_action si présent
    if (updates.prix_action !== undefined && (isNaN(updates.prix_action) || updates.prix_action <= 0)) {
      return res.status(400).json({
        success: false,
        message: 'Le prix par action doit être un nombre valide supérieur à 0'
      });
    }

    // Gérer les fichiers uploadés si présents
    const logoFileName = req.uploadedFiles?.find(f => f.field === 'logo')?.fileName
      || req.files?.logo?.[0]?.originalname || null;
    const rapportFileName = req.uploadedFiles?.find(f => f.field === 'rapport')?.fileName
      || req.files?.rapport?.[0]?.originalname || null;
    if (logoFileName) updates.image_url = _buildS3Url(logoFileName);
    if (rapportFileName) updates.rapport_pdf_url = _buildS3Url(rapportFileName);

    const project = await Project.findByIdAndUpdate(
      projectId,
      { $set: updates },
      { new: true, runValidators: true }
    );

    if (!project) {
      return res.status(404).json({ success: false, message: 'Projet introuvable' });
    }

    return res.status(200).json({ success: true, message: 'Projet mis à jour', data: project });
  } catch (error) {
    console.error('Erreur updateProject:', error);
    return res.status(500).json({ success: false, message: 'Erreur serveur', error: error.message });
  }
};

const deleteProject = async (req, res) => {
  try {
    const { projectId } = req.params;

    const project = await Project.findById(projectId);
    if (!project) {
      return res.status(404).json({ success: false, message: 'Projet introuvable' });
    }

    if (!['brouillon', 'annule'].includes(project.statut)) {
      return res.status(400).json({
        success: false,
        message: 'Seuls les projets en brouillon ou annulés peuvent être supprimés'
      });
    }

    await ProjectInvestment.deleteMany({ project_id: projectId });
    await project.deleteOne();

    return res.status(200).json({ success: true, message: 'Projet supprimé avec succès' });
  } catch (error) {
    console.error('Erreur deleteProject:', error);
    return res.status(500).json({ success: false, message: 'Erreur serveur', error: error.message });
  }
};

const getAllProjectsAdmin = async (req, res) => {
  try {
    const { statut, page = 1, limit = 20, sortBy = '-createdAt' } = req.query;

    const filter = {};
    if (statut) filter.statut = statut;

    const skip = (Number.parseInt(page) - 1) * Number.parseInt(limit);

    const [projects, total] = await Promise.all([
      Project.find(filter)
        .sort(sortBy)
        .skip(skip)
        .limit(Number.parseInt(limit))
        .populate('cree_par', 'firstName lastName'),
      Project.countDocuments(filter)
    ]);

    return res.status(200).json({
      success: true,
      data: projects,
      pagination: {
        total,
        page: Number.parseInt(page),
        limit: Number.parseInt(limit),
        pages: Math.ceil(total / Number.parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Erreur getAllProjectsAdmin:', error);
    return res.status(500).json({ success: false, message: 'Erreur serveur', error: error.message });
  }
};

const getProjectByIdAdmin = async (req, res) => {
  try {
    const { projectId } = req.params;

    const project = await Project.findById(projectId).populate('cree_par', 'firstName lastName');
    if (!project) {
      return res.status(404).json({ success: false, message: 'Projet introuvable' });
    }

    const investments = await ProjectInvestment.find({ project_id: projectId })
      .populate('user_id', 'firstName lastName telephone')
      .sort('-createdAt');

    return res.status(200).json({
      success: true,
      data: {
        projet: project,
        investissements: investments,
        total_investisseurs: investments.length
      }
    });
  } catch (error) {
    console.error('Erreur getProjectByIdAdmin:', error);
    return res.status(500).json({ success: false, message: 'Erreur serveur', error: error.message });
  }
};

const getProjectsStats = async (req, res) => {
  try {
    const [projectStats, investStats] = await Promise.all([
      Project.aggregate([
        {
          $group: {
            _id: null,
            total_projets: { $sum: 1 },
            projets_ouverts: { $sum: { $cond: [{ $eq: ['$statut', 'ouvert'] }, 1, 0] } },
            projets_termines: { $sum: { $cond: [{ $eq: ['$statut', 'termine'] }, 1, 0] } },
            montant_collecte_total: { $sum: '$montant_collecte' }
          }
        }
      ]),
      ProjectInvestment.aggregate([
        { $match: { statut: 'confirme' } },
        {
          $group: {
            _id: null,
            total_investissements: { $sum: 1 },
            montant_total_investi: { $sum: '$montant' },
            investisseurs_uniques: { $addToSet: '$user_id' }
          }
        },
        {
          $project: {
            total_investissements: 1,
            montant_total_investi: 1,
            nombre_investisseurs_uniques: { $size: '$investisseurs_uniques' }
          }
        }
      ])
    ]);

    return res.status(200).json({
      success: true,
      data: {
        projets: projectStats[0] || {
          total_projets: 0, projets_ouverts: 0, projets_termines: 0,
          montant_collecte_total: 0
        },
        investissements: investStats[0] || {
          total_investissements: 0, montant_total_investi: 0, nombre_investisseurs_uniques: 0
        }
      }
    });
  } catch (error) {
    console.error('Erreur getProjectsStats:', error);
    return res.status(500).json({ success: false, message: 'Erreur serveur', error: error.message });
  }
};

// Confirmer / annuler / rembourser un investissement manuellement (admin)
const updateInvestmentStatus = async (req, res) => {
  try {
    const { investmentId } = req.params;
    const { statut, notes } = req.body;

    const allowedStatus = ['confirme', 'annule', 'rembourse'];
    if (!allowedStatus.includes(statut)) {
      return res.status(400).json({
        success: false,
        message: `Statut invalide. Valeurs acceptées: ${allowedStatus.join(', ')}`
      });
    }

    const investment = await ProjectInvestment.findById(investmentId);
    if (!investment) {
      return res.status(404).json({ success: false, message: 'Investissement introuvable' });
    }

    investment.statut = statut;
    if (notes) investment.notes = notes;
    if (statut === 'confirme') investment.date_confirmation = new Date();
    await investment.save();

    // Recalculer les totaux du projet
    await _recalculerTotalsProjet(investment.project_id);

    return res.status(200).json({
      success: true,
      message: `Investissement mis à jour: ${statut}`,
      data: investment
    });
  } catch (error) {
    console.error('Erreur updateInvestmentStatus:', error);
    return res.status(500).json({ success: false, message: 'Erreur serveur', error: error.message });
  }
};

// =====================================================
// 👤 ACTIONNAIRE — CONSULTATION
// =====================================================

const getOpenProjects = async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;

    const filter = { statut: 'ouvert' };

    const skip = (Number.parseInt(page) - 1) * Number.parseInt(limit);

    const [projects, total] = await Promise.all([
      Project.find(filter)
        .select('-cree_par')
        .sort('-createdAt')
        .skip(skip)
        .limit(Number.parseInt(limit)),
      Project.countDocuments(filter)
    ]);

    return res.status(200).json({
      success: true,
      data: projects,
      pagination: {
        total,
        page: Number.parseInt(page),
        limit: Number.parseInt(limit),
        pages: Math.ceil(total / Number.parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Erreur getOpenProjects:', error);
    return res.status(500).json({ success: false, message: 'Erreur serveur', error: error.message });
  }
};

const getProjectById = async (req, res) => {
  try {
    const { projectId } = req.params;

    const project = await Project.findOne({ _id: projectId, statut: { $ne: 'brouillon' } })
      .select('-cree_par');

    if (!project) {
      return res.status(404).json({ success: false, message: 'Projet introuvable' });
    }

    return res.status(200).json({ success: true, data: project });
  } catch (error) {
    console.error('Erreur getProjectById:', error);
    return res.status(500).json({ success: false, message: 'Erreur serveur', error: error.message });
  }
};

// =====================================================
// 💳 ACTIONNAIRE — INVESTIR VIA DIOKOLINK
// =====================================================

const investInProject = async (req, res) => {
  try {
    const { projectId } = req.params;
    const { montant } = req.body;
    const userId = req.user?.id || req.user?._id;

    if (!montant || montant <= 0) {
      return res.status(400).json({ success: false, message: 'Montant invalide' });
    }

    const [project, user] = await Promise.all([
      Project.findById(projectId),
      User.findById(userId)
    ]);

    if (!project) {
      return res.status(404).json({ success: false, message: 'Projet introuvable' });
    }
    if (!user) {
      return res.status(404).json({ success: false, message: 'Utilisateur introuvable' });
    }

    if (project.statut !== 'ouvert') {
      return res.status(400).json({
        success: false,
        message: "Ce projet n'accepte plus d'investissements"
      });
    }

    // Calculer le nombre d'actions correspondant au montant
    let nombre_actions = 0;
    if (project.prix_action && project.prix_action > 0) {
      nombre_actions = Math.floor(montant / project.prix_action);
    }

    // Créer l'investissement en attente
    const investment = new ProjectInvestment({
      project_id: projectId,
      user_id: userId,
      montant,
      nombre_actions,
      statut: 'paiement_initie'
    });

    await investment.save();

    // Initialiser le paiement Diokolink
    const reference = `PROJ-${projectId}-${investment._id}-${Date.now()}`;

    const customer = {
      name: `${user.firstName} ${user.lastName}`,
      email: 'dioko@dioko.com',
      phone: user.telephone
    };

    const callbackUrl = `${DIOKOLINK_CONFIG.CALLBACK_URL}/actions/payment/callback`;
    const returnUrl = `${DIOKOLINK_CONFIG.RETURN_URL}/payment/success?investment=${investment._id}`;
    const cancelUrl = `${DIOKOLINK_CONFIG.RETURN_URL}/payment/cancel?investment=${investment._id}`;

    const metadata = {
      transaction_type: 'project_investment',
      project_investment_id: investment._id.toString(),
      project_id: projectId.toString(),
      user_id: userId.toString(),
      montant,
      project_nom: project.nom,
      callback_url: callbackUrl,
      return_url: returnUrl,
      cancel_url: cancelUrl
    };

    const paymentResponse = await initializePayment(
      montant,
      'link',
      customer,
      reference,
      null,
      metadata
    );

    if (!paymentResponse.success) {
      // Annuler l'investissement si le paiement échoue à l'init
      investment.statut = 'annule';
      investment.notes = `Échec initialisation paiement: ${paymentResponse.error}`;
      await investment.save();

      return res.status(500).json({
        success: false,
        message: "Erreur lors de l'initialisation du paiement",
        error: paymentResponse.error
      });
    }

    // Mettre à jour l'investissement avec le token Diokolink
    investment.diokolink_transaction_id = paymentResponse.transaction_id;
    investment.payment_url = paymentResponse.payment_url;
    await investment.save();

    return res.status(201).json({
      success: true,
      message: 'Investissement initié, veuillez procéder au paiement',
      data: {
        investment_id: investment._id,
        transaction_id: paymentResponse.transaction_id,
        payment_url: paymentResponse.payment_url,
        montant,
        projet: project.nom,
        currency: 'XOF'
      },
      redirect_url: paymentResponse.payment_url
    });
  } catch (error) {
    console.error('Erreur investInProject:', error);
    return res.status(500).json({ success: false, message: 'Erreur serveur', error: error.message });
  }
};

// Vérifier le statut de paiement d'un investissement
const checkInvestmentPaymentStatus = async (req, res) => {
  try {
    const { investmentId } = req.params;
    const userId = req.user?.id || req.user?._id;

    const investment = await ProjectInvestment.findOne({
      _id: investmentId,
      user_id: userId
    }).populate('project_id', 'nom statut');

    if (!investment) {
      return res.status(404).json({ success: false, message: 'Investissement introuvable' });
    }

    // Si déjà confirmé ou annulé, retourner le statut directement
    if (['confirme', 'annule', 'rembourse'].includes(investment.statut)) {
      const populated = await ProjectInvestment.findById(investmentId)
        .populate('project_id', 'nom statut prix_action image_url');
      return res.status(200).json({ success: true, data: populated });
    }

    // Vérifier le statut via Diokolink
    if (investment.diokolink_transaction_id) {
      const paymentStatus = await checkDiokolinkStatus(investment.diokolink_transaction_id);

      if (paymentStatus.success) {
        const mappedStatus = _mapDiokolinkStatus(paymentStatus.transaction?.status);

        if (mappedStatus === 'completed' && investment.statut !== 'confirme') {
          await _confirmerInvestissement(investment, paymentStatus.transaction);
        } else if (['failed', 'cancelled'].includes(mappedStatus) && investment.statut !== 'echec') {
          investment.statut = 'echec';
          investment.notes = `Paiement ${mappedStatus}`;
          await investment.save();
        }
      }
    }

    const updated = await ProjectInvestment.findById(investmentId)
      .populate('project_id', 'nom statut prix_action image_url');
    return res.status(200).json({ success: true, data: updated });
  } catch (error) {
    console.error('Erreur checkInvestmentPaymentStatus:', error);
    return res.status(500).json({ success: false, message: 'Erreur serveur', error: error.message });
  }
};

// Historique des investissements de l'actionnaire connecté
const getMyInvestments = async (req, res) => {
  try {
    const userId = req.user?.id || req.user?._id;
    const { statut, page = 1, limit = 10 } = req.query;

    const filter = { user_id: userId };
    if (statut) filter.statut = statut;

    const skip = (Number.parseInt(page) - 1) * Number.parseInt(limit);

    const [investments, total] = await Promise.all([
      ProjectInvestment.find(filter)
        .populate('project_id', 'nom description statut prix_action montant_collecte image_url')
        .sort('-createdAt')
        .skip(skip)
        .limit(Number.parseInt(limit)),
      ProjectInvestment.countDocuments(filter)
    ]);

    const montantTotal = investments
      .filter(i => i.statut === 'confirme')
      .reduce((sum, i) => sum + i.montant, 0);

    return res.status(200).json({
      success: true,
      data: investments,
      montant_total_investi: montantTotal,
      pagination: {
        total,
        page: Number.parseInt(page),
        limit: Number.parseInt(limit),
        pages: Math.ceil(total / Number.parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Erreur getMyInvestments:', error);
    return res.status(500).json({ success: false, message: 'Erreur serveur', error: error.message });
  }
};

// =====================================================
// 🔔 CALLBACK DIOKOLINK — INVESTISSEMENT PROJET
// =====================================================

const handleProjectInvestmentCallback = async (req, res, data, investment) => {
  try {
    const transactionToken = investment.diokolink_transaction_id
      || data.payment_link_token
      || data.transaction_id;

    const paymentStatus = await checkDiokolinkStatus(transactionToken);

    if (paymentStatus.success && _mapDiokolinkStatus(paymentStatus.transaction?.status) === 'completed') {
      if (investment.statut === 'confirme') {
        return res.status(200).json({ success: true, message: 'Investissement déjà confirmé' });
      }

      await _confirmerInvestissement(investment, paymentStatus.transaction);

      return res.status(200).json({
        success: true,
        message: 'Investissement confirmé avec succès'
      });
    } else {
      const mappedStatus = _mapDiokolinkStatus(paymentStatus.transaction?.status);
      if (['failed', 'cancelled'].includes(mappedStatus)) {
        investment.statut = 'echec';
        investment.notes = `Paiement ${mappedStatus}`;
        await investment.save();
      }

      return res.status(200).json({ success: true, message: 'Callback traité' });
    }
  } catch (error) {
    console.error('Erreur handleProjectInvestmentCallback:', error);
    return res.status(500).json({ success: false, message: 'Erreur callback projet', error: error.message });
  }
};

// =====================================================
// 🛠️ FONCTIONS UTILITAIRES INTERNES
// =====================================================

const _mapDiokolinkStatus = (status) => {
  const map = {
    pending: 'pending',
    success: 'completed',
    failed: 'failed',
    expired: 'cancelled',
    cancelled: 'cancelled'
  };
  return map[status] || 'pending';
};

const _confirmerInvestissement = async (investment, transactionData = {}) => {
  investment.statut = 'confirme';
  investment.date_confirmation = new Date();
  investment.payment_method = transactionData?.payment_method || 'DiokoLink';
  investment.payment_date = new Date();
  await investment.save();

  await _recalculerTotalsProjet(investment.project_id);
};

const _recalculerTotalsProjet = async (projectId) => {
  const aggregation = await ProjectInvestment.aggregate([
    { $match: { project_id: projectId, statut: 'confirme' } },
    {
      $group: {
        _id: null,
        montant_collecte: { $sum: '$montant' },
        nombre_investisseurs: { $sum: 1 }
      }
    }
  ]);

  await Project.findByIdAndUpdate(projectId, {
    $set: {
      montant_collecte: aggregation[0]?.montant_collecte || 0,
      nombre_investisseurs: aggregation[0]?.nombre_investisseurs || 0
    }
  });
};

module.exports = {
  // Admin
  createProject,
  updateProject,
  deleteProject,
  getAllProjectsAdmin,
  getProjectByIdAdmin,
  getProjectsStats,
  updateInvestmentStatus,
  // Actionnaire
  getOpenProjects,
  getProjectById,
  investInProject,
  checkInvestmentPaymentStatus,
  getMyInvestments,
  // Callback
  handleProjectInvestmentCallback
};
