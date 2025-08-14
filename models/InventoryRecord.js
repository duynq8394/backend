const mongoose = require('mongoose');

const inventoryRecordSchema = new mongoose.Schema({
  sessionId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'InventorySession', 
    required: true 
  },
  licensePlate: { 
    type: String, 
    required: true, 
    trim: true 
  },
  status: { 
    type: String, 
    enum: ['checked', 'not_found', 'damaged'], 
    default: 'checked' 
  },
  notes: { 
    type: String, 
    trim: true 
  },
  checkedBy: { 
    type: String, 
    required: true 
  },
  checkedAt: { 
    type: Date, 
    default: Date.now 
  },
  count: { 
    type: Number, 
    default: 1 
  }
}, {
  timestamps: true
});

// Đảm bảo mỗi biển số chỉ có một bản ghi trong một session
inventoryRecordSchema.index({ sessionId: 1, licensePlate: 1 }, { unique: true });

module.exports = mongoose.model('InventoryRecord', inventoryRecordSchema); 