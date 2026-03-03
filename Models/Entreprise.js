// Models/Entreprise.js - Modèle mis à jour

const mongoose = require('mongoose');

const entrepriseSchema = new mongoose.Schema({
  annee: {
    type: Number,
    required: true,
    min: 2000,
    max: 2100
  },
  total_benefice: {
    type: Number,
    min: 0
  },
  rapport: {
    type: String, // Nom du fichier rapport uploadé sur S3
    default: null
  },
  rapportUrl: {
    type: String, // URL complète pour télécharger le fichier
    default: null
  },
  description: {
    type: String, // Description optionnelle
    default: null
  }
}, {
  timestamps: true // Ajoute automatiquement createdAt et updatedAt
});

// Index pour optimiser les recherches par année
entrepriseSchema.index({ annee: -1 });

// Méthode virtuelle pour générer l'URL de téléchargement
entrepriseSchema.virtual('downloadUrl').get(function() {
  if (!this.rapport) return null;
  return `https://${process.env.AWS_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${this.rapport}`;
});

// Assurer que les propriétés virtuelles sont incluses dans JSON
entrepriseSchema.set('toJSON', { virtuals: true });
entrepriseSchema.set('toObject', { virtuals: true });

// Middleware pour nettoyer automatiquement les URLs si le rapport est supprimé
entrepriseSchema.pre('save', function(next) {
  if (!this.rapport) {
    this.rapportUrl = null;
  }
  next();
});

module.exports = mongoose.model('Entreprise', entrepriseSchema);