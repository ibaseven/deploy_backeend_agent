const mongoose = require('mongoose');

const otpSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  code: {
    type: String,
    required: true,
    length: 6
  },
  type: {
    type: String,
    required: true,
    enum: ['partner_verification', 'login', 'password_reset'],
    default: 'partner_verification'
  },
  expiresAt: {
    type: Date,
    required: true,
    index: { expireAfterSeconds: 0 } // Suppression automatique après expiration
  },
  used: {
    type: Boolean,
    default: false
  },
  usedAt: {
    type: Date
  },
  attempts: {
    type: Number,
    default: 0,
    max: 3 // Limite de 3 tentatives
  },
  metadata: {
    acheteurId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    acheteurNom: String,
    acheteurTelephone: String,
    ipAddress: String,
    userAgent: String
  }
}, {
  timestamps: true
});

// Index pour optimiser les recherches
otpSchema.index({ userId: 1, type: 1, expiresAt: 1 });
otpSchema.index({ code: 1, type: 1 });
otpSchema.index({ used: 1, expiresAt: 1 });

// Méthode pour marquer comme utilisé
otpSchema.methods.markAsUsed = function() {
  this.used = true;
  this.usedAt = new Date();
  return this.save();
};

// Méthode pour incrémenter les tentatives
otpSchema.methods.incrementAttempts = function() {
  this.attempts += 1;
  return this.save();
};

// Méthode statique pour nettoyer les OTP expirés manuellement
otpSchema.statics.cleanExpired = function() {
  return this.deleteMany({
    expiresAt: { $lt: new Date() }
  });
};

// Méthode statique pour obtenir un OTP valide
otpSchema.statics.findValidOTP = function(userId, code, type = 'partner_verification') {
  return this.findOne({
    userId: userId,
    code: code,
    type: type,
    used: false,
    expiresAt: { $gt: new Date() },
    attempts: { $lt: 3 }
  });
};

module.exports = mongoose.model('OTP', otpSchema);