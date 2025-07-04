const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Transaction = require('../models/Transaction');

// --- CÁC HÀM TIỆN ÍCH ---

// Hàm kiểm tra định dạng biển số xe
const validateLicensePlate = (plate) => {
  if (!plate) return false;
  const cleanPlate = plate.replace(/[-.]/g, '').toUpperCase();
  // Regex này đã được đơn giản hóa để phù hợp với logic chung, bạn có thể điều chỉnh nếu cần
  const regex = /^\d{2}[A-Z]{1,2}\d{3,5}$|^(\d{2}MĐ\d)\d{5}$/;
  return regex.test(cleanPlate);
};

// Hàm xác định loại xe
const getVehicleType = (plate) => {
  if (!plate) return undefined;
  return plate.includes('MĐ') ? 'Xe máy điện' : 'Xe máy';
};

// Hàm tiện ích định dạng Date sang chuỗi dd/mm/yyyy để hiển thị
const formatDateToDisplay = (date) => {
  if (!date) return '';
  if (typeof date === 'string' && date.includes('/')) return date; // Đã là chuỗi dd/mm/yyyy
  const d = new Date(date);
  if (isNaN(d.getTime())) return date.toString();
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

// --- CÁC ROUTES API ---

// API quét QR (Không thay đổi)
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

    const userObject = user.toObject();
    userObject.dateOfBirth = formatDateToDisplay(user.dateOfBirth);
    userObject.issueDate = formatDateToDisplay(user.issueDate);
    userObject.vehicles = userObject.vehicles.map(vehicle => ({
      ...vehicle,
      vehicleType: vehicle.vehicleType || getVehicleType(vehicle.licensePlate),
    }));

    res.json({ user: userObject });
  } catch (error) {
    res.status(500).json({ error: 'Lỗi server: ' + error.message });
  }
});

// API Gửi/Lấy xe (Không thay đổi)
router.post('/action', async (req, res) => {
  try {
    const { cccd, licensePlate, action } = req.body;

    // Đơn giản hóa validate, bạn có thể giữ lại regex cũ nếu cần
    if (!licensePlate) {
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

    user.vehicles[vehicleIndex].status = newStatus;
    user.vehicles[vehicleIndex].vehicleType = user.vehicles[vehicleIndex].vehicleType || getVehicleType(licensePlate);
    user.vehicles[vehicleIndex].lastTransaction = { action, timestamp };
    await user.save();

    const transaction = new Transaction({ cccd, licensePlate, action, status: newStatus, timestamp });
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


// =================================================================
// ĐÃ THÊM: ROUTE TÌM KIẾM CÔNG KHAI (KHÔNG CẦN TOKEN)
// =================================================================
router.get('/search', async (req, res) => {
  try {
    const { query } = req.query;
    if (!query) {
      return res.status(400).json({ error: 'Vui lòng cung cấp thông tin tìm kiếm.' });
    }

    let user;
    // Tìm kiếm theo CCCD hoặc Họ tên không phân biệt chữ hoa/thường
    if (/^\d{12}$/.test(query)) {
      user = await User.findOne({ cccd: query });
    } else {
      // Sử dụng regex để tìm kiếm không phân biệt chữ hoa/thường
      user = await User.findOne({ fullName: { $regex: new RegExp(query, 'i') } });
    }

    if (!user) {
      return res.status(404).json({ error: 'Không tìm thấy người dùng phù hợp.' });
    }

    // Chuyển đổi dữ liệu để trả về cho client
    const userObject = user.toObject();
    userObject.dateOfBirth = formatDateToDisplay(user.dateOfBirth);
    userObject.issueDate = formatDateToDisplay(user.issueDate);
    userObject.vehicles = userObject.vehicles.map(vehicle => ({
      ...vehicle,
      vehicleType: vehicle.vehicleType || getVehicleType(vehicle.licensePlate),
    }));
    
    // Trả về dữ liệu theo cấu trúc mà frontend mong đợi
    res.json({ user: userObject });

  } catch (error) {
    res.status(500).json({ error: 'Lỗi server khi tìm kiếm: ' + error.message });
  }
});
// =================================================================

module.exports = router;