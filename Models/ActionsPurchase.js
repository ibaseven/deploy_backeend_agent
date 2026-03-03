// Models/ActionsPurchase.js
const mongoose = require('mongoose');
const { Schema } = mongoose;

const actionsPurchaseSchema = new Schema({
  // Référence utilisateur
  user_id: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  telephonePartenaire: {
    type: String,
  },
  partenaireId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    default: null,
    index: true
  },
  // Indique si c'est un nouveau partenaire (première référence)
  nouveauPartenaire: {
    type: Boolean,
    default: false
  },
  // Indique si un bonus a été attribué
  bonusPartenaireAttribue: {
    type: Boolean,
    default: false
  },
  bonusMontant: {
    type: Number,
    default: 0,
    min: 0
  },
  // Nouveau champ pour l'OTP
  otpVerified: {
    type: Boolean,
    default: false
  },
  otpVerifiedAt: {
    type: Date,
    default: null
  },
  // Informations de la transaction PayDunya
  paydunya_transaction_id: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  invoice_token: {
    type: String,
    required: true,
    index: true
  },

  // Détails de l'achat
 nombre_actions: {
  type: Number,
  required: true,
  min: 0.001,  // ← Permet les décimaux à partir de 0.001
  max: 10000,
  validate: {
    validator: function(value) {
      // Vérifier que le nombre n'a pas plus de 3 décimales
      const decimals = value.toString().split('.')[1];
      return !decimals || decimals.length <= 3;
    },
    message: 'Le nombre d\'actions ne peut avoir plus de 3 décimales'
  }
},
  prix_unitaire: {
    type: Number,
    required: true,
    min: 0
  },
  montant_total: {
    type: Number,
    required: true,
    min: 0
  },
  dividende_calculated: {
    type: Number,
    default: 0,
    min: 0
  },

  // Statuts de la transaction
  status: {
    type: String,
    enum: ['pending', 'completed', 'failed', 'cancelled', 'expired'],
    default: 'pending',
    index: true
  },
  paydunya_status: {
    type: String,
    default: 'pending'
  },

  // Informations de paiement
  payment_method: {
    type: String,
    default: null
  },
  payment_date: {
    type: Date,
    default: null
  },
  
  // Détails PayDunya complets
  paydunya_details: {
    customer: {
      name: String,
      phone: String,
      email: String,
      payment_method: String
    },
    response_code: String,
    response_text: String,
    verified_at: Date,
    raw_response: Schema.Types.Mixed
  },

  // Métadonnées
  metadata: {
    pricing_info: {
      entreprise_annee: Number,
      benefice_base: Number,
      prix_unitaire: Number,
      currency: String
    },
    paydunya_response: Schema.Types.Mixed,
    user_agent: String,
    ip_address: String,
    premier_achat: Boolean,
    // Nouveaux champs OTP
    otp_info: {
      required: Boolean,
      verified: Boolean,
      verified_at: Date,
      partner_phone: String
    },
    // Informations bonus
    bonus_info: {
      eligible: Boolean,
      calculated: Boolean,
      amount: Number,
      rate: Number
    }
  },

  // Informations d'échec (si applicable)
  failure_reason: {
    type: String,
    default: null
  },
  failed_at: {
    type: Date,
    default: null
  },

  // Données d'audit
  processed_at: {
    type: Date,
    default: null
  },
  processed_by: {
    type: String,
    default: 'system'
  },

  // Notes administratives
  admin_notes: {
    type: String,
    default: null
  }

}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// ✅ VIRTUELS
actionsPurchaseSchema.virtual('valeur_totale').get(function() {
  return this.nombre_actions * this.prix_unitaire;
});

actionsPurchaseSchema.virtual('is_completed').get(function() {
  return this.status === 'completed';
});

actionsPurchaseSchema.virtual('is_pending').get(function() {
  return this.status === 'pending';
});

actionsPurchaseSchema.virtual('duration_since_creation').get(function() {
  return new Date() - this.createdAt;
});

actionsPurchaseSchema.virtual('is_premier_achat').get(function() {
  return this.metadata && this.metadata.premier_achat === true;
});

actionsPurchaseSchema.virtual('has_partner_bonus').get(function() {
  return this.bonusPartenaireAttribue && this.bonusMontant > 0;
});

actionsPurchaseSchema.virtual('requires_otp').get(function() {
  return this.telephonePartenaire && !this.otpVerified;
});

// ✅ MÉTHODES D'INSTANCE
actionsPurchaseSchema.methods.markAsCompleted = function(paymentDetails = {}) {
  this.status = 'completed';
  this.paydunya_status = 'completed';
  this.payment_date = new Date();
  this.processed_at = new Date();
  
  if (paymentDetails.payment_method) {
    this.payment_method = paymentDetails.payment_method;
  }
  
  if (paymentDetails.customer) {
    this.paydunya_details = {
      ...this.paydunya_details,
      customer: paymentDetails.customer,
      verified_at: new Date()
    };
  }
  
  return this.save();
};

actionsPurchaseSchema.methods.markAsFailed = function(reason, paymentDetails = {}) {
  this.status = 'failed';
  this.failure_reason = reason;
  this.failed_at = new Date();
  this.processed_at = new Date();
  
  if (paymentDetails.status) {
    this.paydunya_status = paymentDetails.status;
  }
  
  return this.save();
};

actionsPurchaseSchema.methods.markAsCancelled = function(reason = 'Cancelled by user') {
  this.status = 'cancelled';
  this.failure_reason = reason;
  this.failed_at = new Date();
  this.processed_at = new Date();
  this.paydunya_status = 'cancelled';
  
  return this.save();
};

actionsPurchaseSchema.methods.addAdminNote = function(note, adminId) {
  this.admin_notes = `${new Date().toISOString()} - Admin ${adminId}: ${note}\n${this.admin_notes || ''}`;
  return this.save();
};

// Méthode pour marquer l'OTP comme vérifié
actionsPurchaseSchema.methods.markOTPVerified = function() {
  this.otpVerified = true;
  this.otpVerifiedAt = new Date();
  if (this.metadata) {
    this.metadata.otp_info = {
      required: true,
      verified: true,
      verified_at: new Date(),
      partner_phone: this.telephonePartenaire
    };
  }
  return this.save();
};

// Méthode pour marquer le bonus comme attribué avec montant
actionsPurchaseSchema.methods.markBonusAttribue = function(montantBonus, tauxBonus = 0.1) {
  this.bonusPartenaireAttribue = true;
  this.bonusMontant = montantBonus;
  
  if (this.metadata) {
    this.metadata.bonus_info = {
      eligible: true,
      calculated: true,
      amount: montantBonus,
      rate: tauxBonus
    };
  }
  
  return this.save();
};

// ✅ MÉTHODES STATIQUES
actionsPurchaseSchema.statics.getByUser = function(userId, options = {}) {
  const { 
    status = null, 
    limit = 10, 
    skip = 0, 
    sortBy = '-createdAt' 
  } = options;
  
  let query = { user_id: userId };
  if (status) {
    query.status = status;
  }
  
  return this.find(query)
    .sort(sortBy)
    .limit(limit)
    .skip(skip)
    .populate('user_id', 'firstName lastName telephone')
    .populate('partenaireId', 'firstName lastName telephone');
};

actionsPurchaseSchema.statics.getStats = async function(dateFrom = null, dateTo = null) {
  let matchQuery = {};
  
  if (dateFrom || dateTo) {
    matchQuery.createdAt = {};
    if (dateFrom) matchQuery.createdAt.$gte = new Date(dateFrom);
    if (dateTo) matchQuery.createdAt.$lte = new Date(dateTo);
  }
  
  const stats = await this.aggregate([
    { $match: matchQuery },
    {
      $group: {
        _id: null,
        total_transactions: { $sum: 1 },
        transactions_completed: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } },
        transactions_pending: { $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] } },
        transactions_failed: { $sum: { $cond: [{ $in: ['$status', ['failed', 'cancelled']] }, 1, 0] } },
        total_actions_sold: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, '$nombre_actions', 0] } },
        total_revenue: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, '$montant_total', 0] } },
        average_transaction: { $avg: { $cond: [{ $eq: ['$status', 'completed'] }, '$montant_total', null] } },
        average_actions_per_transaction: { $avg: { $cond: [{ $eq: ['$status', 'completed'] }, '$nombre_actions', null] } },
        total_bonus_partenaires: { $sum: { $cond: [{ $eq: ['$bonusPartenaireAttribue', true] }, 1, 0] } },
        total_bonus_montant: { $sum: { $cond: [{ $eq: ['$bonusPartenaireAttribue', true] }, '$bonusMontant', 0] } },
        nouveaux_partenaires: { $sum: { $cond: [{ $eq: ['$nouveauPartenaire', true] }, 1, 0] } },
        transactions_with_otp: { $sum: { $cond: [{ $eq: ['$otpVerified', true] }, 1, 0] } }
      }
    }
  ]);
  
  return stats.length > 0 ? stats[0] : {
    total_transactions: 0,
    transactions_completed: 0,
    transactions_pending: 0,
    transactions_failed: 0,
    total_actions_sold: 0,
    total_revenue: 0,
    average_transaction: 0,
    average_actions_per_transaction: 0,
    total_bonus_partenaires: 0,
    total_bonus_montant: 0,
    nouveaux_partenaires: 0,
    transactions_with_otp: 0
  };
};

// Nouvelle méthode pour vérifier si c'est le premier achat d'un utilisateur
actionsPurchaseSchema.statics.isPremierAchat = async function(userId) {
  const count = await this.countDocuments({ 
    user_id: userId, 
    status: 'completed'
  });
  
  return count === 0;
};

// Nouvelle méthode pour vérifier si un utilisateur a déjà référencé un partenaire
actionsPurchaseSchema.statics.hasReferredPartner = async function(userId, telephonePartenaire) {
  const count = await this.countDocuments({
    user_id: userId,
    telephonePartenaire: telephonePartenaire,
    status: 'completed'
  });
  
  return count > 0;
};

actionsPurchaseSchema.statics.getPendingTransactions = function(olderThanMinutes = 30) {
  const cutoffTime = new Date(Date.now() - olderThanMinutes * 60 * 1000);
  
  return this.find({
    status: 'pending',
    createdAt: { $lte: cutoffTime }
  }).populate('user_id', 'firstName lastName telephone');
};

actionsPurchaseSchema.statics.getRevenueByPeriod = async function(groupBy = 'day', dateFrom = null, dateTo = null) {
  let matchQuery = {};
  
  if (dateFrom || dateTo) {
    matchQuery.createdAt = {};
    if (dateFrom) matchQuery.createdAt.$gte = new Date(dateFrom);
    if (dateTo) matchQuery.createdAt.$lte = new Date(dateTo);
  }
  
  matchQuery.status = 'completed';
  
  let dateFormat;
  switch (groupBy) {
    case 'hour':
      dateFormat = '%Y-%m-%d %H:00';
      break;
    case 'day':
      dateFormat = '%Y-%m-%d';
      break;
    case 'week':
      dateFormat = '%Y-%U';
      break;
    case 'month':
      dateFormat = '%Y-%m';
      break;
    case 'year':
      dateFormat = '%Y';
      break;
    default:
      dateFormat = '%Y-%m-%d';
  }
  
  return this.aggregate([
    { $match: matchQuery },
    {
      $group: {
        _id: { $dateToString: { format: dateFormat, date: '$createdAt' } },
        revenue: { $sum: '$montant_total' },
        actions_sold: { $sum: '$nombre_actions' },
        transactions: { $sum: 1 },
        avg_transaction_value: { $avg: '$montant_total' },
        bonus_partenaires: { $sum: { $cond: [{ $eq: ['$bonusPartenaireAttribue', true] }, 1, 0] } },
        total_bonus_montant: { $sum: { $cond: [{ $eq: ['$bonusPartenaireAttribue', true] }, '$bonusMontant', 0] } },
        nouveaux_partenaires: { $sum: { $cond: [{ $eq: ['$nouveauPartenaire', true] }, 1, 0] } }
      }
    },
    { $sort: { _id: 1 } }
  ]);
};

// Méthode pour récupérer les statistiques des bonus par partenaire
actionsPurchaseSchema.statics.getBonusStatsByPartner = async function(dateFrom = null, dateTo = null) {
  let matchQuery = {
    bonusPartenaireAttribue: true,
    status: 'completed'
  };
  
  if (dateFrom || dateTo) {
    matchQuery.createdAt = {};
    if (dateFrom) matchQuery.createdAt.$gte = new Date(dateFrom);
    if (dateTo) matchQuery.createdAt.$lte = new Date(dateTo);
  }
  
  return this.aggregate([
    { $match: matchQuery },
    { 
      $group: {
        _id: "$telephonePartenaire",
        total_bonus: { $sum: "$bonusMontant" },
        transactions: { $sum: 1 },
        total_montant: { $sum: "$montant_total" },
        last_bonus_date: { $max: "$payment_date" }
      }
    },
    {
      $lookup: {
        from: "users",
        let: { tel: "$_id" },
        pipeline: [
          { $match: { $expr: { $eq: ["$telephone", "$$tel"] } } },
          { $project: { firstName: 1, lastName: 1, telephone: 1, email: 1 } }
        ],
        as: "partenaire_info"
      }
    },
    { $unwind: { path: "$partenaire_info", preserveNullAndEmptyArrays: true } },
    { $sort: { total_bonus: -1 } }
  ]);
};

// Statistiques détaillées des bonus
actionsPurchaseSchema.statics.getDetailedBonusStats = async function(dateFrom = null, dateTo = null) {
  let matchQuery = {
    bonusPartenaireAttribue: true,
    status: 'completed'
  };
  
  if (dateFrom || dateTo) {
    matchQuery.createdAt = {};
    if (dateFrom) matchQuery.createdAt.$gte = new Date(dateFrom);
    if (dateTo) matchQuery.createdAt.$lte = new Date(dateTo);
  }
  
  return this.aggregate([
    { $match: matchQuery },
    {
      $group: {
        _id: {
          year: { $year: "$createdAt" },
          month: { $month: "$createdAt" },
          day: { $dayOfMonth: "$createdAt" }
        },
        total_bonus_attribue: { $sum: "$bonusMontant" },
        nombre_transactions: { $sum: 1 },
        total_montant_achats: { $sum: "$montant_total" },
        partenaires_uniques: { $addToSet: "$telephonePartenaire" }
      }
    },
    {
      $project: {
        date: {
          $dateFromParts: {
            year: "$_id.year",
            month: "$_id.month",
            day: "$_id.day"
          }
        },
        total_bonus_attribue: 1,
        nombre_transactions: 1,
        total_montant_achats: 1,
        nombre_partenaires_uniques: { $size: "$partenaires_uniques" }
      }
    },
    { $sort: { date: -1 } }
  ]);
};

// Transactions nécessitant une vérification OTP
actionsPurchaseSchema.statics.getTransactionsNeedingOTP = function() {
  return this.find({
    status: 'pending',
    telephonePartenaire: { $exists: true, $ne: null },
    otpVerified: false,
    createdAt: { $gte: new Date(Date.now() - 30 * 60 * 1000) } // 30 minutes
  }).populate('user_id', 'firstName lastName telephone');
};

// Top partenaires par bonus
actionsPurchaseSchema.statics.getTopPartnersByBonus = async function(limit = 10, dateFrom = null, dateTo = null) {
  let matchQuery = {
    bonusPartenaireAttribue: true,
    status: 'completed',
    partenaireId: { $exists: true, $ne: null }
  };
  
  if (dateFrom || dateTo) {
    matchQuery.createdAt = {};
    if (dateFrom) matchQuery.createdAt.$gte = new Date(dateFrom);
    if (dateTo) matchQuery.createdAt.$lte = new Date(dateTo);
  }
  
  return this.aggregate([
    { $match: matchQuery },
    {
      $group: {
        _id: "$partenaireId",
        total_bonus: { $sum: "$bonusMontant" },
        nombre_filleuls: { $addToSet: "$user_id" },
        nombre_transactions: { $sum: 1 },
        total_montant_genere: { $sum: "$montant_total" },
        dernier_bonus: { $max: "$createdAt" }
      }
    },
    {
      $project: {
        total_bonus: 1,
        nombre_filleuls: { $size: "$nombre_filleuls" },
        nombre_transactions: 1,
        total_montant_genere: 1,
        dernier_bonus: 1
      }
    },
    {
      $lookup: {
        from: "users",
        localField: "_id",
        foreignField: "_id",
        as: "partenaire"
      }
    },
    { $unwind: "$partenaire" },
    {
      $project: {
        total_bonus: 1,
        nombre_filleuls: 1,
        nombre_transactions: 1,
        total_montant_genere: 1,
        dernier_bonus: 1,
        "partenaire.firstName": 1,
        "partenaire.lastName": 1,
        "partenaire.telephone": 1,
        "partenaire.email": 1
      }
    },
    { $sort: { total_bonus: -1 } },
    { $limit: limit }
  ]);
};

// ✅ INDEX POUR PERFORMANCE
actionsPurchaseSchema.index({ user_id: 1, status: 1 });
actionsPurchaseSchema.index({ paydunya_transaction_id: 1 });
actionsPurchaseSchema.index({ invoice_token: 1 });
actionsPurchaseSchema.index({ status: 1, createdAt: -1 });
actionsPurchaseSchema.index({ createdAt: -1 });
actionsPurchaseSchema.index({ payment_date: -1 });
actionsPurchaseSchema.index({ bonusPartenaireAttribue: 1 });
actionsPurchaseSchema.index({ nouveauPartenaire: 1 });
actionsPurchaseSchema.index({ user_id: 1, telephonePartenaire: 1 });
// Nouveaux index
actionsPurchaseSchema.index({ partenaireId: 1, bonusPartenaireAttribue: 1 });
actionsPurchaseSchema.index({ otpVerified: 1, status: 1 });
actionsPurchaseSchema.index({ bonusMontant: 1 });
actionsPurchaseSchema.index({ telephonePartenaire: 1, bonusPartenaireAttribue: 1 });
actionsPurchaseSchema.index({ createdAt: -1, bonusPartenaireAttribue: 1 });

// ✅ MIDDLEWARE
// Avant sauvegarde, calculer automatiquement le montant total
actionsPurchaseSchema.pre('save', function(next) {
  // Calcul automatique du montant total
  if (this.isModified('nombre_actions') || this.isModified('prix_unitaire')) {
    this.montant_total = this.nombre_actions * this.prix_unitaire;
  }
  
  // Calcul automatique du bonus si partenaire et pas encore calculé
  if (this.isModified('bonusPartenaireAttribue') && this.bonusPartenaireAttribue && !this.bonusMontant) {
    this.bonusMontant = Math.round(this.montant_total * 0.1); // 10% par défaut
  }
  
  next();
});

// Validation supplémentaire pour l'OTP
actionsPurchaseSchema.pre('save', function(next) {
  // Si un partenaire est défini et que ce n'est pas le partenaire actuel de l'utilisateur,
  // alors l'OTP doit être vérifié
  if (this.telephonePartenaire && this.isNew && !this.otpVerified) {
    console.log('⚠️ Transaction avec partenaire créée sans vérification OTP');
  }
  next();
});

// Après sauvegarde, log des transactions importantes
actionsPurchaseSchema.post('save', function(doc) {
  if (doc.isModified('status')) {
    //(`📊 Transaction ${doc._id} - Statut changé vers: ${doc.status}`);
    
    if (doc.status === 'completed') {
      //(`✅ Achat complété - User: ${doc.user_id}, Actions: ${doc.nombre_actions}, Montant: ${doc.montant_total}`);
      if (doc.bonusPartenaireAttribue) {
        //(`🎁 Bonus partenaire attribué pour cette transaction`);
      }
    }
  }
  
  if (doc.isModified('bonusPartenaireAttribue') && doc.bonusPartenaireAttribue) {
    console.log(`🎁 Bonus de ${doc.bonusMontant} FCFA attribué au partenaire ${doc.telephonePartenaire} pour la transaction ${doc._id}`);
  }
  
  if (doc.isModified('otpVerified') && doc.otpVerified) {
    console.log(`✅ OTP vérifié pour la transaction ${doc._id} avec partenaire ${doc.telephonePartenaire}`);
  }
});

// Validation avant suppression (empêcher la suppression des transactions complétées)
actionsPurchaseSchema.pre('deleteOne', { document: true, query: false }, function(next) {
  if (this.status === 'completed') {
    const error = new Error('Impossible de supprimer une transaction complétée');
    error.status = 400;
    return next(error);
  }
  next();
});

module.exports = mongoose.model('ActionsPurchase', actionsPurchaseSchema);