const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Transaction = require('../models/Transaction');

// Hàm kiểm tra định dạng biển số xe
const validateLicensePlate = (plate) => {
  if (!plate) return false;
  const cleanPlate = plate.replace(/[-.]/g, '').toUpperCase();
  const regex = /^(\d{2}[A-Z]{1,2}\d{0,1}|\d{2}MĐ\d)(\d{3,5})(\.\d{2})?$/;
  return regex.test(cleanPlate);
};

// Hàm xác định loại xe
const getVehicleType = (plate) => {
  if (!plate) return undefined;
  return plate.includes('MĐ') ? 'Xe máy điện' : 'Xe máy';
};

// Hàm tiện ích chuyển đổi ngày từ chuỗi dd/mm/yyyy sang định dạng Date của JS
const parseDate = (dateString) => {
  if (!dateString) return null;
  const [day, month, year] = dateString.split('/');
  return new Date(`${year}-${month}-${day}`);
};

// Hàm tiện ích định dạng Date sang chuỗi dd/mm/yyyy để hiển thị
const formatDateToDisplay = (date) => {
  if (!date) return '';
  if (typeof date === 'string') return date; // Đã là chuỗi dd/mm/yyyy
  const d = new Date(date);
  if (isNaN(d.getTime())) return date;
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
};

// Hàm giải mã chuỗi QR
const decodeQR = (qrString) => {
  const parts = qrString.split('|');
  return {
    cccd: parts[0],
    oldCmt: parts[1] || '',
    fullName: parts[2],
    dateOfBirth: parts[3],
    gender: parts[4],
    hometown: parts[5],
    issueDate: parts[6],
  };
};

// API quét QR
router.post('/scan', async (req, res) => {
  try {
    const { qrString } = req.body;
    if (!qrString) {
      return res.status(400).json({ error: 'Thiếu dữ liệu QR.' });
    }
    const { cccd } = decodeQR(qrString);
    
    const user = await User.findOne({ cccd });
    
    if (!user) {
      return res.status(404).json({ error: 'Người dùng chưa được đăng ký trong hệ thống' });
    }

    // Tạo bản sao để không thay đổi đối tượng gốc
    const userObject = user.toObject();

    // Định dạng lại ngày tháng để hiển thị cho client
    userObject.dateOfBirth = formatDateToDisplay(user.dateOfBirth);
    userObject.issueDate = formatDateToDisplay(user.issueDate);

    // Đảm bảo vehicleType được gán cho mỗi xe
    userObject.vehicles = userObject.vehicles.map(vehicle => ({
      ...vehicle,
      vehicleType: vehicle.vehicleType || getVehicleType(vehicle.licensePlate),
    }));
    
    res.json({ user: userObject });
  } catch (error) {
    res.status(500).json({ error: 'Lỗi server: ' + error.message });
  }
});

// API Gửi/Lấy xe
router.post('/action', async (req, res) => {
  try {
    const { cccd, licensePlate, action } = req.body;

    if (!validateLicensePlate(licensePlate)) {
      return res.status(400).json({ error: 'Biển số xe không hợp lệ.' });
    }

    const user = await User.findOne({ cccd });

    if (!user) {
      return res.status(404).json({ error: 'Không tìm thấy người dùng.' });
    }
    
    const vehicleIndex = user.vehicles.findIndex(v => v.licensePlate === licensePlate);

    if (vehicleIndex === -1) {
      return res.status(404).json({ error: 'Biển số xe không được đăng ký cho người dùng này.' });
    }
    
    const newStatus = action === 'Gửi' ? 'Đang gửi' : 'Đã lấy';
    const timestamp = new Date();

    // Cập nhật trạng thái và giao dịch cuối cùng của xe
    user.vehicles[vehicleIndex].status = newStatus;
    user.vehicles[vehicleIndex].vehicleType = user.vehicles[vehicleIndex].vehicleType || getVehicleType(licensePlate);
    user.vehicles[vehicleIndex].lastTransaction = { action, timestamp };

    await user.save();
    
    // Tạo một bản ghi giao dịch mới
    const transaction = new Transaction({
      cccd,
      licensePlate,
      action,
      status: newStatus,
      timestamp,
    });
    await transaction.save();

    res.json({ 
      success: true, 
      status: newStatus, 
      timestamp: transaction.timestamp,
      vehicleType: user.vehicles[vehicleIndex].vehicleType,
    });
  } catch (error) {
    res.status(500).json({ error: `Lỗi server: ${error.message}` });
  }
});

module.exports = router;