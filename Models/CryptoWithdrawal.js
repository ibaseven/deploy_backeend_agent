const mongoose = require('mongoose');

const cryptoWithdrawalSchema = new mongoose.Schema(
  {
    user_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    montant_fcfa: {
      type: Number,
      required: true,
      min: [1000, 'Montant minimum : 1 000 FCFA'],
    },
    adresse_usdt: {
      type: String,
      required: true,
      trim: true,
    },
    crypto_type: {
      type: String,
      default: 'USDT TRC20',
    },
    status: {
      type: String,
      enum: ['pending', 'accepted', 'rejected'],
      default: 'pending',
    },
    admin_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    admin_note: {
      type: String,
      default: '',
    },
    processed_at: {
      type: Date,
      default: null,
    },
    dividende_avant: {
      type: Number,
      default: null,
    },
    dividende_apres: {
      type: Number,
      default: null,
    },
  },
  { timestamps: true }
);

cryptoWithdrawalSchema.index({ user_id: 1, createdAt: -1 });
cryptoWithdrawalSchema.index({ status: 1 });

const CryptoWithdrawal = mongoose.model('CryptoWithdrawal', cryptoWithdrawalSchema);
module.exports = CryptoWithdrawal;
