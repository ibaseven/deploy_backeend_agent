const mongoose = require('mongoose');

const PACKS_CONFIG = [
  { nom: 'Mini',      nbre_actions: 10,   montant_fcfa: 50000,   montant_usd: 100  },
  { nom: 'Bronze',    nbre_actions: 100,  montant_fcfa: 300000,  montant_usd: 600  },
  { nom: 'Silver',    nbre_actions: 200,  montant_fcfa: 400000,  montant_usd: 800  },
  { nom: 'Or',        nbre_actions: 500,  montant_fcfa: 800000,  montant_usd: 1600 },
  { nom: 'Platinium', nbre_actions: 1000, montant_fcfa: 1500000, montant_usd: 3000 },
  { nom: 'Diamond',   nbre_actions: 2000, montant_fcfa: 2000000, montant_usd: 4000 },
];

const packPurchaseSchema = new mongoose.Schema(
  {
    user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    pack_nom: {
      type: String,
      enum: ['Mini', 'Bronze', 'Silver', 'Or', 'Platinium', 'Diamond'],
      required: true,
    },
    nbre_actions: { type: Number, required: true },
    montant_fcfa:  { type: Number, required: true },
    montant_usd:   { type: Number, required: true },
    payment_method: {
      type: String,
      enum: ['fcfa', 'crypto'],
      required: true,
    },
    // Crypto
    adresse_usdt:       { type: String, default: null },
    payment_proof_url:  { type: String, default: null },
    // PayDunya
    paydunya_token: { type: String, default: null },
    status: {
      type: String,
      enum: ['pending', 'completed', 'rejected'],
      default: 'pending',
    },
    contract_sent: { type: Boolean, default: false },
    // Admin
    admin_id:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    admin_note:  { type: String, default: '' },
    processed_at: { type: Date, default: null },
  },
  { timestamps: true }
);

packPurchaseSchema.index({ user_id: 1, createdAt: -1 });
packPurchaseSchema.index({ status: 1 });
packPurchaseSchema.index({ payment_method: 1 });
packPurchaseSchema.index({ paydunya_token: 1 }, { sparse: true });

const PackPurchase = mongoose.model('PackPurchase', packPurchaseSchema);

module.exports = { PackPurchase, PACKS_CONFIG };
