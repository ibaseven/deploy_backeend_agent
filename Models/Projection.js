const mongoose = require('mongoose');

const projectionSchema = new mongoose.Schema({
  date: { type: Date, default: Date.now },
  users: Number,
  revenue: Number,
  expenses: Number,
  shares: { type: Number, default: 100000 }
});

module.exports = mongoose.model('Projection', projectionSchema);
