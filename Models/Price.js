const mongoose = require('mongoose');

const priceSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ['VIP', 'NORMAL'],
    required: true,
    unique: true
  },
  prix_unitaire: {
    type: Number,
    required: true,
    min: 0
  },
  currency: {
    type: String,
    default: "XOF"
  },
  description: {
    type: String
  },
  actif: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Price', priceSchema);