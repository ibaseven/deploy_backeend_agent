const mongoose = require('mongoose');

const bonusHistorySchema = new mongoose.Schema({
  partenaireId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  acheteurId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  transactionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ActionsPurchase'
  },
  montantBonus: {
    type: Number,
    required: true,
    min: 0
  },
  montantAchat: {
    type: Number,
    required: true,
    min: 0
  },
  tauxBonus: {
    type: Number,
    required: true,
    min: 0,
    max: 1,
    default: 0.1
  },
  type: {
    type: String,
    enum: ['parrainage', 'bonus_special', 'promotion'],
    default: 'parrainage'
  },
  dateAttribution: {
    type: Date,
    default: Date.now
  },
  status: {
    type: String,
    enum: ['pending', 'completed', 'cancelled'],
    default: 'completed'
  },
  metadata: {
    campagne: String,
    notes: String
  }
}, {
  timestamps: true
});

// Index pour optimiser les requêtes
bonusHistorySchema.index({ partenaireId: 1, dateAttribution: -1 });
bonusHistorySchema.index({ acheteurId: 1 });
bonusHistorySchema.index({ transactionId: 1 });

module.exports = mongoose.model('BonusHistory', bonusHistorySchema);
