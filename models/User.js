const mongoose = require('mongoose');

// Hàm xác định loại xe dựa trên biển số
const getVehicleType = (licensePlate) => {
  if (!licensePlate) return undefined;
  return licensePlate.includes('MĐ') ? 'Xe máy điện' : 'Xe máy';
};

const userSchema = new mongoose.Schema({
  cccd: { type: String, required: true, unique: true, trim: true },
  oldCmt: { type: String, trim: true },
  fullName: { type: String, required: true, trim: true },
  dateOfBirth: { type: String, required: true }, // Lưu dưới dạng chuỗi dd/mm/yyyy
  gender: { type: String, required: true, enum: ['Nam', 'Nữ', 'Khác'] },
  hometown: { type: String, required: true, trim: true },
  issueDate: { type: String, required: true }, // Lưu dưới dạng chuỗi dd/mm/yyyy
  vehicles: [{
    licensePlate: { type: String, required: true, trim: true },
    vehicleType: { 
      type: String, 
      enum: ['Xe máy', 'Xe máy điện'], 
      default: function() { return getVehicleType(this.licensePlate); }
    },
    status: { type: String, default: 'Đã lấy', enum: ['Đang gửi', 'Đã lấy'] },
    lastTransaction: {
      action: String,
      timestamp: Date,
    },
  }],
});

// Thêm chỉ mục để đảm bảo biển số xe không trùng lặp giữa các CCCD
userSchema.index({ 'vehicles.licensePlate': 1 }, { unique: true, sparse: true });

// Middleware kiểm tra biển số xe trước khi lưu
userSchema.pre('save', async function(next) {
  const user = this;
  // Kiểm tra từng biển số xe trong mảng vehicles
  for (const vehicle of user.vehicles) {
    if (vehicle.licensePlate) {
      const existingUser = await mongoose.model('User').findOne({
        'vehicles.licensePlate': vehicle.licensePlate,
        cccd: { $ne: user.cccd }, // Không kiểm tra chính user đang lưu
      });
      if (existingUser) {
        const error = new Error(`Biển số xe ${vehicle.licensePlate} đã được đăng ký cho CCCD ${existingUser.cccd}`);
        return next(error);
      }
      // Gán vehicleType nếu chưa có
      if (!vehicle.vehicleType) {
        vehicle.vehicleType = getVehicleType(vehicle.licensePlate);
      }
    }
  }
  next();
});

// Middleware kiểm tra khi cập nhật
userSchema.pre('findOneAndUpdate', async function(next) {
  const update = this.getUpdate();
  if (update.vehicles) {
    for (const vehicle of update.vehicles) {
      if (vehicle.licensePlate) {
        const existingUser = await mongoose.model('User').findOne({
          'vehicles.licensePlate': vehicle.licensePlate,
          cccd: { $ne: update.cccd || this.getQuery().cccd }, // Không kiểm tra chính user đang cập nhật
        });
        if (existingUser) {
          const error = new Error(`Biển số xe ${vehicle.licensePlate} đã được đăng ký cho CCCD ${existingUser.cccd}`);
          return next(error);
        }
        // Gán vehicleType nếu chưa có
        if (!vehicle.vehicleType) {
          vehicle.vehicleType = getVehicleType(vehicle.licensePlate);
        }
      }
    }
  }
  next();
});

module.exports = mongoose.model('User', userSchema);