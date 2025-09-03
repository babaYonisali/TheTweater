const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  telegramId: { 
    type: Number, 
    required: true, 
    unique: true 
  },
  telegramUsername: { 
    type: String, 
    required: false 
  },
  xHandle: { 
    type: String, 
    required: false 
  },
  // Twitter OAuth tokens
  accessToken: {
    type: String,
    required: false
  },
  refreshToken: {
    type: String,
    required: false
  },
  tokenExpiresAt: {
    type: Date,
    required: false
  },
  // Bot session info
  isConnected: {
    type: Boolean,
    default: false
  },
  lastActivity: {
    type: Date,
    default: Date.now
  },
  joinTime: {
    type: Date,
    default: Date.now
  },
  // OAuth session data
  oauth: {
    codeVerifier: String,
    state: String
  }
});

// Update lastActivity on save
userSchema.pre('save', function(next) {
  this.lastActivity = new Date();
  next();
});

module.exports = mongoose.model('User', userSchema, 'botUsers');
