const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
  cccd: { type: String, required: true },
  licensePlate: { type: String, required: true },
  action: { type: String, enum: ['Gửi', 'Lấy'], required: true },
  timestamp: { type: Date, default: Date.now },
  status: { type: String, enum: ['Đang gửi', 'Đã lấy'], required: true }
});

module.exports = mongoose.model('Transaction', transactionSchema);