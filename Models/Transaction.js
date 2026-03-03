
const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ['payment', 'deposit', 'withdrawal',"dividend_withdrawal", 'refund',"dividend_purchase"],
    required: true
  },
  amount: {
    type: Number,
    required: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  recipientPhone: {
    type: String,
    required: function() { return ['payment', 'withdrawal', 'refund'].includes(this.type); }
  },
  paymentMethod: {
    type: String,
    required: function() { return ['payment', 'withdrawal', 'refund'].includes(this.type); }
  },
  status: {
    type: String,
    enum: ['pending', 'processing', 'completed', 'failed', 'cancelled'],
    default: 'pending'
  },
  description: String,
  
  // Champs spécifiques à Paydunya
  account_alias: {
    type: String,
  },
  withdraw_mode: {
    type: String,
  },
  token: {
    type: String,
    // Remove the unique constraint from the schema definition
    // The sparse unique index will be created separately
  },
  
  // Champ pour renseigner une référence lors de l'envoi
  reference: {
    type: String,
    trim: true
  },
  
  // ID de transaction personnalisé (différent de l'_id MongoDB)
  id_transaction: {
    type: String,
    unique: true,
    sparse: true
  },
  
  transaction_id: {
    type: String,
    unique: true,
    sparse: true // Permet d'avoir des valeurs null/undefined
  },
  
  // Informations de transaction Paydunya
  paydounyaTransactionId: String,
  paydounyaDisburseInvoice: String,
  paydounyaDisburseId: String,
  
  // Informations temporelles
  createdAt: {
    type: Date,
    default: Date.now
  },
  completedAt: Date,
  
  // Informations d'erreur
  errorMessage: String,
  
  // Champs pour les remboursements
  originalTransactionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Transaction'
  },
  refundReason: String,
  
  // Nouveau champ pour indiquer si la transaction a été remboursée
  isRefunded: {
    type: Boolean,
    default: false
  },
  
  // Date du remboursement (optionnel)
  refundedAt: {
    type: Date
  }
});

// Create indexes
transactionSchema.index({ userId: 1, createdAt: -1 });
transactionSchema.index({ status: 1 });
transactionSchema.index({ type: 1 });
transactionSchema.index({ transaction_id: 1 }, { unique: true, sparse: true });
transactionSchema.index({ id_transaction: 1 }, { unique: true, sparse: true });
transactionSchema.index({ isRefunded: 1 }); // Index pour le nouveau champ

// Create a sparse unique index on token to allow multiple null values
// This will prevent duplicate non-null tokens while allowing multiple nulls
transactionSchema.index({ token: 1 }, { unique: true, sparse: true });

const Transaction = mongoose.model('Transaction', transactionSchema);

module.exports = Transaction;