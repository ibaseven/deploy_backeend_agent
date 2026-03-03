const mongoose = require('mongoose');

/**
 * Modèle pour les achats d'actions par versements échelonnés
 * L'utilisateur achète X actions et paie petit à petit jusqu'à tout payer
 */
const installmentPurchaseSchema = new mongoose.Schema({
  // Référence utilisateur
  user_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },

  // Détails de l'achat
  nombre_actions_total: {
    type: Number,
    required: true,
    min: 10 // Minimum 10 actions
  },

  prix_unitaire: {
    type: Number,
    required: true
  },

  montant_total: {
    type: Number,
    required: true
  },

  // Suivi des paiements
  montant_paye: {
    type: Number,
    default: 0
  },

  montant_restant: {
    type: Number,
    required: true
  },

  // Partenaire de parrainage
  telephonePartenaire: {
    type: String,
    default: null
  },

  partenaireId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },

  // Statut de l'achat
  status: {
    type: String,
    enum: ['en_cours', 'complete', 'annule', 'expire'],
    default: 'en_cours'
  },

  // Liste des versements effectués
  versements: [{
    montant: {
      type: Number,
      required: true
    },
    nombre_actions_equivalent: {
      type: Number,
      required: true
    },
    paydunya_transaction_id: {
      type: String,
      required: true
    },
    payment_method: String,
    payment_date: Date,
    paydunya_details: mongoose.Schema.Types.Mixed,
    createdAt: {
      type: Date,
      default: Date.now
    }
  }],

  // Date de complétion (quand 100% est payé)
  completed_at: {
    type: Date
  },

  // Bonus partenaire
  bonusPartenaireAttribue: {
    type: Boolean,
    default: false
  },

  bonusMontant: {
    type: Number,
    default: 0
  },

  // Date d'expiration (optionnel - par exemple 90 jours pour finaliser)
  expires_at: {
    type: Date
  },

  // Métadonnées
  metadata: {
    type: mongoose.Schema.Types.Mixed
  }

}, {
  timestamps: true
});

// Index pour optimiser les requêtes
installmentPurchaseSchema.index({ user_id: 1, status: 1 });
installmentPurchaseSchema.index({ status: 1, createdAt: -1 });

// Méthodes d'instance

/**
 * Ajouter un versement
 */
installmentPurchaseSchema.methods.addVersement = async function(versementData) {
  this.versements.push(versementData);
  this.montant_paye += versementData.montant;
  this.montant_restant = this.montant_total - this.montant_paye;

  // Si tout est payé, marquer comme complété
  if (this.montant_restant <= 0) {
    this.status = 'complete';
    this.completed_at = new Date();
  }

  await this.save();
  return this;
};

/**
 * Créditer les actions à l'utilisateur (après paiement complet)
 */
installmentPurchaseSchema.methods.crediterActions = async function() {
  if (this.status !== 'complete') {
    throw new Error('Achat non complété - impossible de créditer les actions');
  }

  const User = mongoose.model('User');
  const user = await User.findById(this.user_id);

  if (!user) {
    throw new Error('Utilisateur introuvable');
  }

  // Ajouter les actions
  user.nbre_actions = (user.nbre_actions || 0) + this.nombre_actions_total;

  // Ajouter à l'historique
  if (!user.actionsHistory) {
    user.actionsHistory = [];
  }

  user.actionsHistory.push({
    date: this.completed_at,
    type: 'achat',
    nombre_actions: this.nombre_actions_total,
    montant: this.montant_total,
    transaction_id: this._id.toString(),
    description: `Achat par versements complété - ${this.versements.length} paiements`
  });

  await user.save();

  return user;
};

/**
 * Calculer le pourcentage payé
 */
installmentPurchaseSchema.methods.getPourcentagePaye = function() {
  return Math.round((this.montant_paye / this.montant_total) * 100);
};

// Méthodes statiques

/**
 * Récupérer les achats en cours d'un utilisateur
 */
installmentPurchaseSchema.statics.getUserActivePurchases = async function(userId) {
  return await this.find({
    user_id: userId,
    status: 'en_cours'
  })
    .sort({ createdAt: -1 })
    .exec();
};

/**
 * Récupérer l'historique complet d'un utilisateur
 */
installmentPurchaseSchema.statics.getUserHistory = async function(userId) {
  return await this.find({
    user_id: userId
  })
    .sort({ createdAt: -1 })
    .exec();
};

/**
 * Statistiques globales des achats par versements
 */
installmentPurchaseSchema.statics.getStats = async function() {
  const stats = await this.aggregate([
    {
      $facet: {
        en_cours: [
          { $match: { status: 'en_cours' } },
          {
            $group: {
              _id: null,
              count: { $sum: 1 },
              total_actions: { $sum: '$nombre_actions_total' },
              montant_total: { $sum: '$montant_total' },
              montant_paye: { $sum: '$montant_paye' },
              montant_restant: { $sum: '$montant_restant' }
            }
          }
        ],
        completes: [
          { $match: { status: 'complete' } },
          {
            $group: {
              _id: null,
              count: { $sum: 1 },
              total_actions: { $sum: '$nombre_actions_total' },
              montant_total: { $sum: '$montant_total' }
            }
          }
        ]
      }
    }
  ]);

  return {
    en_cours: stats[0].en_cours[0] || { count: 0, total_actions: 0, montant_total: 0, montant_paye: 0, montant_restant: 0 },
    completes: stats[0].completes[0] || { count: 0, total_actions: 0, montant_total: 0 }
  };
};

const InstallmentPurchase = mongoose.model('InstallmentPurchase', installmentPurchaseSchema);

module.exports = InstallmentPurchase;
