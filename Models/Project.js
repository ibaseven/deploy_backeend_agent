const mongoose = require('mongoose');
const { Schema } = mongoose;

const projectSchema = new Schema({
  nom: {
    type: String,
    required: true,
    trim: true,
    maxlength: 200
  },
  description: {
    type: String,
    required: true,
    trim: true
  },
  image_url: {
    type: String,
    default: null
  },
  rapport_pdf_url: {
    type: String,
    default: null
  },
  prix_action: {
    type: Number,
    required: true,
    min: 1
  },
  statut: {
    type: String,
    enum: ['brouillon', 'ouvert', 'ferme', 'termine', 'annule'],
    default: 'brouillon',
    index: true
  },
  // Suivi des investissements (calculé automatiquement)
  montant_collecte: {
    type: Number,
    default: 0,
    min: 0
  },
  nombre_investisseurs: {
    type: Number,
    default: 0,
    min: 0
  },
  cree_par: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    default: null
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

projectSchema.index({ statut: 1, createdAt: -1 });

module.exports = mongoose.model('Project', projectSchema);
