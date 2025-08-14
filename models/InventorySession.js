const mongoose = require('mongoose');

const inventorySessionSchema = new mongoose.Schema({
  sessionName: { 
    type: String, 
    required: true, 
    trim: true 
  },
  description: { 
    type: String, 
    trim: true 
  },
  startedBy: { 
    type: String, 
    required: true 
  },
  endedBy: { 
    type: String 
  },
  startedAt: { 
    type: Date, 
    default: Date.now 
  },
  endedAt: { 
    type: Date 
  },
  status: { 
    type: String, 
    enum: ['active', 'completed', 'cancelled'], 
    default: 'active' 
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('InventorySession', inventorySessionSchema); 