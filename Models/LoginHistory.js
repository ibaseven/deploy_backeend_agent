const mongoose = require('mongoose');

const loginHistorySchema = new mongoose.Schema(
  {
    userId:        { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    telephone:     { type: String, default: null },
    firstName:     { type: String, default: null },
    lastName:      { type: String, default: null },
    ipAddress:     { type: String, default: null },
    country:       { type: String, default: null },
    city:          { type: String, default: null },
    device:        { type: String, default: null }, // mobile | tablet | desktop
    browser:       { type: String, default: null },
    os:            { type: String, default: null },
    status:        { type: String, enum: ['success', 'failed'], required: true },
    failureReason: {
      type:    String,
      enum:    ['user_not_found', 'wrong_password', 'account_blocked', null],
      default: null,
    },
    userAgent: { type: String, default: null },
  },
  { timestamps: true }
);

loginHistorySchema.index({ createdAt: -1 });
loginHistorySchema.index({ userId: 1, createdAt: -1 });
loginHistorySchema.index({ ipAddress: 1 });
loginHistorySchema.index({ status: 1 });

module.exports = mongoose.model('LoginHistory', loginHistorySchema);
