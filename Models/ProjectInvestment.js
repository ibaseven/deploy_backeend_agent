const mongoose = require('mongoose');
const { Schema } = mongoose;

const projectInvestmentSchema = new Schema({
  project_id: {
    type: Schema.Types.ObjectId,
    ref: 'Project',
    required: true,
    index: true
  },
  user_id: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  montant: {
    type: Number,
    required: true,
    min: 1
  },
  // Lien optionnel vers une transaction d'achat d'actions
  actions_purchase_id: {
    type: Schema.Types.ObjectId,
    ref: 'ActionsPurchase',
    default: null
  },
  // Token Diokolink pour le paiement
  diokolink_transaction_id: {
    type: String,
    default: null,
    index: true
  },
  payment_url: {
    type: String,
    default: null
  },
  payment_method: {
    type: String,
    default: null
  },
  payment_date: {
    type: Date,
    default: null
  },
  statut: {
    type: String,
    enum: ['en_attente', 'paiement_initie', 'confirme', 'annule', 'rembourse', 'echec'],
    default: 'en_attente',
    index: true
  },
  date_confirmation: {
    type: Date,
    default: null
  },
  nombre_actions: {
    type: Number,
    default: 0,
    min: 0
  },
  notes: {
    type: String,
    default: null
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

projectInvestmentSchema.index({ project_id: 1, user_id: 1 });
projectInvestmentSchema.index({ user_id: 1, statut: 1 });
projectInvestmentSchema.index({ project_id: 1, statut: 1 });

module.exports = mongoose.model('ProjectInvestment', projectInvestmentSchema);
