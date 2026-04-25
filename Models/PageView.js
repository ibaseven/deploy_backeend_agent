const mongoose = require('mongoose');

const pageViewSchema = new mongoose.Schema(
  {
    userId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    path:      { type: String, required: true },
    ipAddress: { type: String, default: null },
    country:   { type: String, default: null },
    city:      { type: String, default: null },
    device:    { type: String, default: null },
    browser:   { type: String, default: null },
    os:        { type: String, default: null },
    userAgent: { type: String, default: null },
  },
  { timestamps: true }
);

pageViewSchema.index({ createdAt: -1 });
pageViewSchema.index({ path: 1 });
pageViewSchema.index({ userId: 1 });

module.exports = mongoose.model('PageView', pageViewSchema);
