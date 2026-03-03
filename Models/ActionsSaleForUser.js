const mongoose = require("mongoose");

const ActionsSaleUserSchema = new mongoose.Schema({
  vendeur: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  acheteur: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  nbre_actions: {
    type: Number,
    required: true,
    min: 1,
  },
   montant: {
    type: Number,
  },
  telephone_acheteur: {
    type: String,
   
  },
  telephone_vendeur: {
    type: String,
   
  },
  date_transaction: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model("ActionsSaleUser", ActionsSaleUserSchema);
