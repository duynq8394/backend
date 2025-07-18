const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Transaction = require('../models/Transaction');

// --- CÁC HÀM TIỆN ÍCH ---
const validateLicensePlate = (plate) => {
  if (!plate) return false;
  const cleanPlate = plate.replace(/[-.]/g, '').toUpperCase();
  const regex = /^\d{2}[A-Z]{1,2}\d{3,5}$|^(\d{2}MĐ\d)\d{5}$/;
  return regex.test(cleanPlate);
};

const getVehicleType = (plate) => {
  if (!plate) return undefined;
  return plate.includes('MĐ') ? 'Xe máy điện' : 'Xe máy';
};

const formatDateToDisplay = (date) => {
  if (!date) return '';
  if (typeof date === 'string' && date.includes('/')) return date;
  const d = new Date(date);
  if (isNaN(d.getTime())) return date.toString();
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
};

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
      color: vehicle.color || '', // Thêm trường color
      brand: vehicle.brand || '', // Thêm trường brand
    }));

    res.json({ user: userObject });
  } catch (error) {
    res.status(500).json({ error: 'Lỗi server: ' + error.message });
  }
});

router.post('/action', async (req, res) => {
  try {
    const { cccd, licensePlate, action } = req.body;

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
      color: user.vehicles[vehicleIndex].color || '', // Thêm trường color
      brand: user.vehicles[vehicleIndex].brand || '', // Thêm trường brand
    });
  } catch (error) {
    res.status(500).json({ error: `Lỗi server: ${error.message}` });
  }
});

router.get('/search', async (req, res) => {
  try {
    const { query } = req.query;
    if (!query) {
      return res.status(400).json({ error: 'Vui lòng cung cấp thông tin tìm kiếm.' });
    }

    let user;
    if (/^\d{12}$/.test(query)) {
      user = await User.findOne({ cccd: query });
    } else {
      user = await User.findOne({ fullName: { $regex: new RegExp(query, 'i') } });
    }

    if (!user) {
      return res.status(404).json({ error: 'Không tìm thấy người dùng phù hợp.' });
    }

    const userObject = user.toObject();
    userObject.dateOfBirth = formatDateToDisplay(user.dateOfBirth);
    userObject.issueDate = formatDateToDisplay(user.issueDate);
    userObject.vehicles = userObject.vehicles.map(vehicle => ({
      ...vehicle,
      vehicleType: vehicle.vehicleType || getVehicleType(vehicle.licensePlate),
      color: vehicle.color || '', // Thêm trường color
      brand: vehicle.brand || '', // Thêm trường brand
    }));
    
    res.json({ user: userObject });
  } catch (error) {
    res.status(500).json({ error: 'Lỗi server khi tìm kiếm: ' + error.message });
  }
});
// Thêm API công khai để đếm số xe đang gửi
router.get('/public/parked-vehicles', async (req, res) => {
  try {
    const parkedVehicles = await User.aggregate([
      { $unwind: '$vehicles' },
      { $match: { 'vehicles.status': 'Đang gửi' } },
      { $count: 'totalParked' },
    ]);

    const totalParked = parkedVehicles.length > 0 ? parkedVehicles[0].totalParked : 0;

    res.json({ totalParked });
  } catch (error) {
    res.status(500).json({ error: 'Lỗi server: ' + error.message });
  }
});

module.exports = router;
