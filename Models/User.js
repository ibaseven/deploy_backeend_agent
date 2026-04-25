// Models/User.js - Version adaptée à votre modèle existant
const mongoose = require("mongoose");
const { Schema } = mongoose;

const userSchema = new Schema(
  {
    // Champs communs à tous les utilisateurs
    firstName: {
      type: String,

      trim: true,
      maxlength: 100,
    },
    lastName: {
      type: String,

      trim: true,
      maxlength: 100,
    },
    telephone: {
      type: String,

      validate: {
        validator: function (v) {
          return /^[\+]?[0-9\s\-\(\)]{8,15}$/.test(v);
        },
        message: "Format de téléphone invalide",
      },
    },
    nationalite: {
      type: String,
    },
    ville: {
      type: String,
    },
    pays: {
      type: String,
    },
     cni: {
      type: String,
    },
    dateNaissance: {
      type: String,
    },
    adresse: {
      type: String,
    },
    password: {
      type: String,

      minlength: 6,
    },
    role: {
      type: String,
      enum: ["admin", "actionnaire","actionnaire3"],

      default: "actionnaire",
    },

    // Champs spécifiques aux actionnaires
    nbre_actions: {
      type: Number,
      min: 0,
      
      
    },
    telephonePartenaire: {
      type: String,
      default: null,
      validate: {
        validator: function (v) {
          return !v || /^\+?[0-9]{8,15}$/.test(v);
        },
        message: "Format de téléphone partenaire invalide",
      },
    },
    // Tableau de tous les parrains (plusieurs partenaires possibles)
    telephonePartenaires: {
      type: [String],
      default: [],
    },
    referral_code: {
      type: String,
      unique: true,
      sparse: true,
      default: null,
    },
    dividende: {
      type: Number,
      min: 0,
      
    },
    isBlocked: {
      type: Boolean,
      default: false,
    },
    status: {
      type: String,
      enum: ["active", "inactive", "blocked", "suspended"],
      default: "active",
    },

    // Champs spécifiques aux admins
    permissions: {
      type: [String],
      default: function () {
        if (this.role === "admin") {
          return ["read", "write", "delete", "manage_users"];
        }
        return undefined;
      },
      validate: {
        validator: function (v) {
          if (this.role === "admin") {
            return Array.isArray(v);
          }
          return v === undefined || v === null;
        },
        message: "Les permissions ne sont applicables que pour les admins",
      },
    },

    // ✅ HISTORIQUE DES ACTIONS (pour traçabilité)
    actionsHistory: [
      {
        date: {
          type: Date,
          default: Date.now,
        },
        type: {
          type: String,
          enum: ["achat", "vente", "dividende"],
        },
        nombre_actions: {
          type: Number,
        },
        montant: {
          type: Number,
        },
        transaction_id: {
          type: String,
        },
        description: {
          type: String,
        },
      },
    ],
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// ✅ MÉTHODES VIRTUELLES
userSchema.virtual("fullName").get(function () {
  return `${this.firstName} ${this.lastName}`;
});

userSchema.virtual("valeurPortefeuille").get(function () {
  return (this.nbre_actions || 0) * 10000; // Prix fixe de 10 000 FCFA par action
});

// ✅ MÉTHODES D'INSTANCE
userSchema.methods.ajouterActions = async function (
  nombreActions,
  transactionId,
  montant
) {
  this.nbre_actions = (this.nbre_actions || 0) + nombreActions;

  // Recalculer les dividendes
  const { calculateDividende } = require("../Services/actionsPurchaseService");
  this.dividende = await calculateDividende(this.nbre_actions);

  // Ajouter à l'historique
  this.actionsHistory.push({
    type: "achat",
    nombre_actions: nombreActions,
    montant: montant,
    transaction_id: transactionId,
    description: `Achat de ${nombreActions} actions pour ${montant.toLocaleString()} FCFA`,
  });

  return this.save();
};

userSchema.methods.retirerActions = async function (
  nombreActions,
  transactionId,
  montant
) {
  if ((this.nbre_actions || 0) < nombreActions) {
    throw new Error("Nombre d'actions insuffisant");
  }

  this.nbre_actions = (this.nbre_actions || 0) - nombreActions;

  // Recalculer les dividendes
  const { calculateDividende } = require("../Services/actionsPurchaseService");
  this.dividende = await calculateDividende(this.nbre_actions);

  // Ajouter à l'historique
  this.actionsHistory.push({
    type: "vente",
    nombre_actions: nombreActions,
    montant: montant,
    transaction_id: transactionId,
    description: `Vente de ${nombreActions} actions pour ${montant.toLocaleString()} FCFA`,
  });

  return this.save();
};

userSchema.methods.ajouterDividendes = async function (montant, transactionId) {
  this.actionsHistory.push({
    type: "dividende",
    nombre_actions: 0,
    montant: montant,
    transaction_id: transactionId,
    description: `Réception de dividendes: ${montant.toLocaleString()} FCFA`,
  });

  return this.save();
};

// ✅ MÉTHODES STATIQUES
userSchema.statics.getTopActionnaires = function (limit = 10) {
  return this.find({
    role: "actionnaire",
    nbre_actions: { $gt: 0 },
  })
    .sort({ nbre_actions: -1 })
    .limit(limit)
    .select("firstName lastName nbre_actions dividende");
};

userSchema.statics.getStatsGlobales = async function () {
  const stats = await this.aggregate([
    { $match: { role: "actionnaire" } },
    {
      $group: {
        _id: null,
        totalActionnaires: { $sum: 1 },
        totalActions: { $sum: "$nbre_actions" },
        totalDividendes: { $sum: "$dividende" },
        actionnairesActifs: {
          $sum: { $cond: [{ $gt: ["$nbre_actions", 0] }, 1, 0] },
        },
      },
    },
  ]);

  return stats.length > 0
    ? stats[0]
    : {
        totalActionnaires: 0,
        totalActions: 0,
        totalDividendes: 0,
        actionnairesActifs: 0,
      };
};

// Index pour optimiser les recherches
userSchema.index({ telephone: 1 });
userSchema.index({ role: 1 });
userSchema.index({ nbre_actions: -1 });
userSchema.index({ status: 1 });

// MIDDLEWARE PRE-SAVE : Nettoyage des champs pour les admins
userSchema.pre("save", async function (next) {
  try {
    if (this.role === "admin") {
      // Pour les admins, supprimer les champs actionnaire
      this.nbre_actions = undefined;
      this.dividende = undefined;
    }

    next();
  } catch (error) {
    next(error);
  }
});

// MIDDLEWARE PRE-VALIDATE : Validation conditionnelle


module.exports = mongoose.model("User", userSchema);
