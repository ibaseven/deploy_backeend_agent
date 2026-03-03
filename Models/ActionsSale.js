// Models/ActionsSale.js
const mongoose = require('mongoose');

const actionsSaleSchema = new mongoose.Schema({
  user_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  nombre_actions: {
  type: Number,
  required: true,
  min: 0.001,  // ← Permet les décimaux à partir de 0.001
  max: 10000,
  validate: {
    validator: function(value) {
      // Vérifier que le nombre n'a pas plus de 3 décimales
      const decimals = value.toString().split('.')[1];
      return !decimals || decimals.length <= 3;
    },
    message: 'Le nombre d\'actions ne peut avoir plus de 3 décimales'
  }
},
  prix_unitaire: {
    type: Number,
    required: true
  },
  montant_total: {
    type: Number,
    required: true
  },
  motif: {
    type: String,
    default: "Vente d'actions"
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending'
  },
  date_demande: {
    type: Date,
    default: Date.now
  },
  date_traitement: {
    type: Date
  },
  commentaire_admin: {
    type: String
  },
  admin_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  metadata: {
    type: Object,
    default: {}
  }
}, { timestamps: true });

module.exports = mongoose.model('ActionsSale', actionsSaleSchema);