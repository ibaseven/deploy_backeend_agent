const mongoose = require('mongoose');

const vipUserSchema = new mongoose.Schema({
  telephone: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  nom: {
    type: String
  },
  actif: {
    type: Boolean,
    default: true
  },
  date_ajout: {
    type: Date,
    default: Date.now
  },
  notes: {
    type: String
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('VIPUser', vipUserSchema);