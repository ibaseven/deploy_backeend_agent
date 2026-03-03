const mongoose = require('mongoose');

const moratoriumPurchaseSchema = new mongoose.Schema({
  // Référence à la transaction d'achat originale
  actionsPurchase_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ActionsPurchase',
    required: true,
    unique: true
  },

  // Référence à l'utilisateur
  user_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },

  // Détails de l'achat
  nombre_actions: {
    type: Number,
    required: true,
    min: 0.001
  },

  montant_total: {
    type: Number,
    required: true
  },

  prix_unitaire: {
    type: Number,
    required: true
  },

  // Statut du moratoire
  status: {
    type: String,
    enum: ['waiting', 'validated', 'cancelled'],
    default: 'waiting'
  },

  // Batch/Lot de moratoire (pour regrouper les validations)
  batch_id: {
    type: String,
    index: true
  },

  // Date de validation (quand les actions ont été créditées)
  validated_at: {
    type: Date
  },

  // Date d'annulation
  cancelled_at: {
    type: Date
  },

  // Raison d'annulation
  cancellation_reason: {
    type: String
  },

  // Admin qui a validé ou annulé
  processed_by: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },

  // Notes administratives
  admin_notes: {
    type: String
  }

}, {
  timestamps: true
});

// Index pour optimiser les requêtes
moratoriumPurchaseSchema.index({ status: 1, createdAt: -1 });
moratoriumPurchaseSchema.index({ user_id: 1, status: 1 });
moratoriumPurchaseSchema.index({ batch_id: 1 });

// Méthodes statiques

/**
 * Récupérer le total des actions en attente
 */
moratoriumPurchaseSchema.statics.getTotalWaitingActions = async function() {
  const result = await this.aggregate([
    {
      $match: { status: 'waiting' }
    },
    {
      $group: {
        _id: null,
        total_actions: { $sum: '$nombre_actions' },
        total_montant: { $sum: '$montant_total' },
        count: { $sum: 1 }
      }
    }
  ]);

  return result.length > 0 ? result[0] : {
    total_actions: 0,
    total_montant: 0,
    count: 0
  };
};

/**
 * Récupérer tous les achats en attente
 */
moratoriumPurchaseSchema.statics.getWaitingPurchases = async function(options = {}) {
  const query = { status: 'waiting' };

  return await this.find(query)
    .populate('user_id', 'firstName lastName telephone email')
    .populate('actionsPurchase_id')
    .sort({ createdAt: 1 })
    .limit(options.limit || 0)
    .exec();
};

/**
 * Récupérer les achats en attente pour un utilisateur
 */
moratoriumPurchaseSchema.statics.getUserWaitingPurchases = async function(userId) {
  return await this.find({
    user_id: userId,
    status: 'waiting'
  })
    .populate('actionsPurchase_id')
    .sort({ createdAt: -1 })
    .exec();
};

/**
 * Valider tous les achats en attente (créditer les actions)
 */
moratoriumPurchaseSchema.statics.validateAllWaiting = async function(processedBy, adminNotes = '') {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const User = mongoose.model('User');

    // Récupérer tous les achats en attente
    const waitingPurchases = await this.find({ status: 'waiting' }).session(session);

    if (waitingPurchases.length === 0) {
      await session.abortTransaction();
      session.endSession();
      return {
        success: false,
        message: 'Aucun achat en attente',
        validated: 0
      };
    }

    // Générer un batch_id unique
    const batch_id = `BATCH_${Date.now()}`;
    const validated_at = new Date();

    const results = {
      success: true,
      validated: 0,
      failed: 0,
      batch_id,
      errors: []
    };

    // Traiter chaque achat
    for (const purchase of waitingPurchases) {
      try {
        // Créditer les actions à l'utilisateur
        const user = await User.findById(purchase.user_id).session(session);

        if (!user) {
          results.failed++;
          results.errors.push({
            purchase_id: purchase._id,
            error: 'Utilisateur introuvable'
          });
          continue;
        }

        // Ajouter les actions
        user.nbre_actions = (user.nbre_actions || 0) + purchase.nombre_actions;

        // Ajouter à l'historique
        if (!user.actionsHistory) {
          user.actionsHistory = [];
        }

        user.actionsHistory.push({
          date: validated_at,
          type: 'achat',
          nombre_actions: purchase.nombre_actions,
          montant: purchase.montant_total,
          transaction_id: purchase.actionsPurchase_id,
          notes: `Validation moratoire - Batch ${batch_id}`
        });

        await user.save({ session });

        // Mettre à jour le statut du moratoire
        purchase.status = 'validated';
        purchase.validated_at = validated_at;
        purchase.batch_id = batch_id;
        purchase.processed_by = processedBy;
        purchase.admin_notes = adminNotes;

        await purchase.save({ session });

        results.validated++;

      } catch (error) {
        results.failed++;
        results.errors.push({
          purchase_id: purchase._id,
          error: error.message
        });
      }
    }

    await session.commitTransaction();
    session.endSession();

    return results;

  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    throw error;
  }
};

/**
 * Récupérer les participants avec leurs totaux (groupés par utilisateur)
 */
moratoriumPurchaseSchema.statics.getParticipants = async function() {
  return await this.aggregate([
    { $match: { status: 'waiting' } },
    {
      $group: {
        _id: '$user_id',
        total_actions: { $sum: '$nombre_actions' },
        total_montant: { $sum: '$montant_total' },
        nombre_achats: { $sum: 1 },
        premier_achat: { $min: '$createdAt' },
        dernier_achat: { $max: '$createdAt' }
      }
    },
    {
      $lookup: {
        from: 'users',
        localField: '_id',
        foreignField: '_id',
        as: 'user'
      }
    },
    { $unwind: '$user' },
    {
      $project: {
        _id: 1,
        total_actions: 1,
        total_montant: 1,
        nombre_achats: 1,
        premier_achat: 1,
        dernier_achat: 1,
        'user.firstName': 1,
        'user.lastName': 1,
        'user.telephone': 1,
        'user.email': 1
      }
    },
    { $sort: { total_actions: -1 } }
  ]);
};

/**
 * Obtenir les statistiques du moratoire
 */
moratoriumPurchaseSchema.statics.getStats = async function() {
  const stats = await this.aggregate([
    {
      $facet: {
        waiting: [
          { $match: { status: 'waiting' } },
          {
            $group: {
              _id: null,
              total_actions: { $sum: '$nombre_actions' },
              total_montant: { $sum: '$montant_total' },
              count: { $sum: 1 }
            }
          }
        ],
        validated: [
          { $match: { status: 'validated' } },
          {
            $group: {
              _id: null,
              total_actions: { $sum: '$nombre_actions' },
              total_montant: { $sum: '$montant_total' },
              count: { $sum: 1 }
            }
          }
        ],
        cancelled: [
          { $match: { status: 'cancelled' } },
          {
            $group: {
              _id: null,
              count: { $sum: 1 }
            }
          }
        ]
      }
    }
  ]);

  return {
    waiting: stats[0].waiting[0] || { total_actions: 0, total_montant: 0, count: 0 },
    validated: stats[0].validated[0] || { total_actions: 0, total_montant: 0, count: 0 },
    cancelled: stats[0].cancelled[0] || { count: 0 }
  };
};

const MoratoriumPurchase = mongoose.model('MoratoriumPurchase', moratoriumPurchaseSchema);

module.exports = MoratoriumPurchase;
