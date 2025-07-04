const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const Admin = require('../models/Admin');

// Middleware xác thực admin
const auth = (req, res, next) => {
  const token = req.header('Authorization')?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Không có token' });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.role !== 'admin') throw new Error();
    req.admin = decoded;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Token không hợp lệ' });
  }
};
// Thêm vào file admin.js
router.get('/vehicles', auth, async (req, res) => {
  try {
    const { status, cccd } = req.query;
    const query = {};
    if (cccd) query.cccd = cccd;

    const users = await User.find(query);
    const vehicles = users.flatMap((user) =>
      user.vehicles.map((vehicle) => ({
        cccd: user.cccd,
        licensePlate: vehicle.licensePlate,
        vehicleType: vehicle.vehicleType || getVehicleType(vehicle.licensePlate),
        status: vehicle.status,
        timestamp: vehicle.lastTransaction?.timestamp,
        fullName: user.fullName,
        hometown: user.hometown,
        dateOfBirth: formatDateToDisplay(user.dateOfBirth),
        issueDate: formatDateToDisplay(user.issueDate),
      }))
    );

    const filteredVehicles = status ? vehicles.filter((v) => v.status === status) : vehicles;

    res.json({ vehicles: filteredVehicles, total: filteredVehicles.length });
  } catch (error) {
    res.status(500).json({ error: 'Lỗi server: ' + error.message });
  }
});
const validateLicensePlate = (plate) => {
  if (!plate) return false;
  const cleanPlate = plate.replace(/[-.]/g, '').toUpperCase();
  const regex = /^(\d{2}[A-Z]{1,2}\d{0,1}|\d{2}MĐ\d)(\d{3,5})(\.\d{2})?$/;
  return regex.test(cleanPlate);
};

const getVehicleType = (plate) => {
  if (!plate) return undefined;
  return plate.includes('MĐ') ? 'Xe máy điện' : 'Xe máy';
};

const formatDateToDisplay = (date) => {
  if (!date) return '';
  if (typeof date === 'string') return date;
  const d = new Date(date);
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
};

// Đăng nhập admin
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const admin = await Admin.findOne({ username });
    if (!admin) return res.status(400).json({ error: 'Tài khoản không tồn tại' });
    const isMatch = await bcrypt.compare(password, admin.password);
    if (!isMatch) return res.status(400).json({ error: 'Mật khẩu sai' });
    const token = jwt.sign({ username: admin.username, role: admin.role }, process.env.JWT_SECRET, { expiresIn: '1h' });
    res.json({ token });
  } catch (error) {
    res.status(500).json({ error: 'Lỗi server' });
  }
});

// Thêm thông tin người dùng/xe
router.post('/add-user', auth, async (req, res) => {
  try {
    const { cccd, oldCmt, fullName, dateOfBirth, gender, hometown, issueDate, vehicles } = req.body;

    if (!vehicles || vehicles.length === 0 || vehicles.every(v => !v.licensePlate)) {
      return res.status(400).json({ error: 'Cần ít nhất một biển số xe hợp lệ' });
    }

    for (const vehicle of vehicles) {
      if (!validateLicensePlate(vehicle.licensePlate)) {
        return res.status(400).json({ error: `Biển số xe không hợp lệ: ${vehicle.licensePlate}` });
      }
      const existingUser = await User.findOne({
        'vehicles.licensePlate': vehicle.licensePlate,
        cccd: { $ne: cccd },
      });
      if (existingUser) {
        return res.status(400).json({ error: `Biển số xe ${vehicle.licensePlate} đã được đăng ký cho CCCD ${existingUser.cccd}` });
      }
    }

    const user = new User({
      cccd, oldCmt, fullName, dateOfBirth, gender, hometown, issueDate,
      vehicles: vehicles.map(v => ({
        licensePlate: v.licensePlate,
        vehicleType: v.vehicleType || getVehicleType(v.licensePlate),
        status: 'Đã lấy',
        lastTransaction: null,
      })),
    });
    await user.save();
    res.json({
      success: true,
      user: {
        ...user._doc,
        dateOfBirth: formatDateToDisplay(user.dateOfBirth),
        issueDate: formatDateToDisplay(user.issueDate),
      },
    });
  } catch (error) {
    res.status(400).json({ error: 'Lỗi khi thêm: ' + error.message });
  }
});

// Cập nhật thông tin người dùng/xe
router.put('/update-user/:cccd', auth, async (req, res) => {
  try {
    const { cccd, oldCmt, fullName, dateOfBirth, gender, hometown, issueDate, vehicles } = req.body;

    if (!vehicles || vehicles.length === 0 || vehicles.every(v => !v.licensePlate)) {
      return res.status(400).json({ error: 'Cần ít nhất một biển số xe hợp lệ' });
    }

    for (const vehicle of vehicles) {
      if (!validateLicensePlate(vehicle.licensePlate)) {
        return res.status(400).json({ error: `Biển số xe không hợp lệ: ${vehicle.licensePlate}` });
      }
      const existingUser = await User.findOne({
        'vehicles.licensePlate': vehicle.licensePlate,
        cccd: { $ne: cccd },
      });
      if (existingUser) {
        return res.status(400).json({ error: `Biển số xe ${vehicle.licensePlate} đã được đăng ký cho CCCD ${existingUser.cccd}` });
      }
    }

    const user = await User.findOneAndUpdate(
      { cccd: req.params.cccd },
      {
        oldCmt, fullName, dateOfBirth, gender, hometown, issueDate,
        vehicles: vehicles.map(v => ({
          licensePlate: v.licensePlate,
          vehicleType: v.vehicleType || getVehicleType(v.licensePlate),
          status: v.status || 'Đã lấy',
          lastTransaction: v.lastTransaction || null,
        })),
      },
      { new: true }
    );
    if (!user) return res.status(404).json({ error: 'Không tìm thấy người dùng' });
    res.json({
      success: true,
      user: {
        ...user._doc,
        dateOfBirth: formatDateToDisplay(user.dateOfBirth),
        issueDate: formatDateToDisplay(user.issueDate),
      },
    });
  } catch (error) {
    res.status(400).json({ error: 'Lỗi khi cập nhật: ' + error.message });
  }
});

// Thống kê (yêu cầu admin)
router.get('/statistics', auth, async (req, res) => {
    // ... (Giữ nguyên logic thống kê)
});


module.exports = router;
