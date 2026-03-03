const mongoose = require('mongoose');

const moratoriumConfigSchema = new mongoose.Schema({

  // Activation du moratoire
  actif: {
    type: Boolean,
    default: false
  },

  // Seuil minimum d'actions pour valider
  seuil_actions: {
    type: Number,
    default: 10,
    min: 1
  },

  // Type de validation
  type_validation: {
    type: String,
    enum: ['automatique', 'manuelle'],
    default: 'automatique'
  },

  // Description/Raison du moratoire
  description: {
    type: String
  },

  // Date de début du moratoire
  date_debut: {
    type: Date
  },

  // Date de fin prévue (optionnel)
  date_fin_prevue: {
    type: Date
  },

  // Dernière validation automatique
  derniere_validation_auto: {
    type: Date
  },

  // Nombre total de validations effectuées
  nombre_validations: {
    type: Number,
    default: 0
  },

  // Dernière modification
  modified_by: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },

  // Notes administratives
  admin_notes: {
    type: String
  }

}, {
  timestamps: true
});

// Méthodes statiques

/**
 * Récupérer ou créer la configuration
 * Note: Il n'y a qu'une seule configuration dans la base de données
 */
moratoriumConfigSchema.statics.getConfig = async function() {
  // Récupérer la première configuration (il ne devrait y en avoir qu'une)
  let config = await this.findOne();

  if (!config) {
    // Créer la configuration par défaut si elle n'existe pas
    // MongoDB génèrera automatiquement l'_id
    config = await this.create({
      actif: false,
      seuil_actions: 10,
      type_validation: 'automatique'
    });
  }

  return config;
};

/**
 * Activer le moratoire
 */
moratoriumConfigSchema.statics.activer = async function(seuil, typeValidation, modifiedBy, description) {
  const config = await this.getConfig();

  config.actif = true;
  config.seuil_actions = seuil || 10;
  config.type_validation = typeValidation || 'automatique';
  config.description = description;
  config.date_debut = new Date();
  config.modified_by = modifiedBy;

  await config.save();
  return config;
};

/**
 * Désactiver le moratoire
 */
moratoriumConfigSchema.statics.desactiver = async function(modifiedBy, notes) {
  const config = await this.getConfig();

  config.actif = false;
  config.date_fin_prevue = new Date();
  config.modified_by = modifiedBy;
  if (notes) {
    config.admin_notes = notes;
  }

  await config.save();
  return config;
};

/**
 * Vérifier si le moratoire est actif
 */
moratoriumConfigSchema.statics.estActif = async function() {
  const config = await this.getConfig();
  return config.actif;
};

/**
 * Incrémenter le compteur de validations
 */
moratoriumConfigSchema.statics.incrementerValidations = async function() {
  const config = await this.getConfig();
  config.nombre_validations = (config.nombre_validations || 0) + 1;
  config.derniere_validation_auto = new Date();
  await config.save();
  return config;
};

const MoratoriumConfig = mongoose.model('MoratoriumConfig', moratoriumConfigSchema);

module.exports = MoratoriumConfig;
