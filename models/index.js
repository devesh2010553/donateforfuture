const mongoose = require('mongoose');

// Project State Schema
const projectStateSchema = new mongoose.Schema({
  totalGoal: { type: Number, default: 57700000 },
  currentRaised: { type: Number, default: 4500000 },
  videoLinks: [{ type: String }],
  updatedAt: { type: Date, default: Date.now }
});

// Donor Schema
const donorSchema = new mongoose.Schema({
  name: { type: String, required: true },
  age: { type: Number, required: true },
  place: { type: String, required: true },
  address: { type: String, required: true },
  phone: { type: String },
  email: { type: String },
  amount: { type: Number, required: true },
  upiRef: { type: String },
  verified: { type: Boolean, default: false },
  transactionId: { type: String },
  createdAt: { type: Date, default: Date.now }
});

// Chat Message Schema
const chatSchema = new mongoose.Schema({
  senderName: { type: String, required: true },
  senderPhone: { type: String, required: true },
  message: { type: String, required: true },
  isAdmin: { type: Boolean, default: false },
  sessionId: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
});

// Push Subscription Schema
const pushSubscriptionSchema = new mongoose.Schema({
  subscription: { type: Object, required: true },
  type: { type: String, enum: ['admin', 'user'], default: 'admin' },
  createdAt: { type: Date, default: Date.now }
});

// Admin Session Schema
const adminSessionSchema = new mongoose.Schema({
  token: { type: String, required: true },
  createdAt: { type: Date, default: Date.now, expires: 86400 } // 24h TTL
});

module.exports = {
  ProjectState: mongoose.model('ProjectState', projectStateSchema),
  Donor: mongoose.model('Donor', donorSchema),
  Chat: mongoose.model('Chat', chatSchema),
  PushSubscription: mongoose.model('PushSubscription', pushSubscriptionSchema),
  AdminSession: mongoose.model('AdminSession', adminSessionSchema)
};
