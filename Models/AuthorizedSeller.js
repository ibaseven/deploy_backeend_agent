const mongoose = require('mongoose');

const authorizedSellerSchema = new mongoose.Schema({
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
  notes: {
    type: String
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('AuthorizedSeller', authorizedSellerSchema);
