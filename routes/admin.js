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

// Định dạng Date thành dd/mm/yyyy
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

    // Kiểm tra vehicles
    if (!vehicles || vehicles.length === 0 || vehicles.every(v => !v.licensePlate)) {
      return res.status(400).json({ error: 'Cần ít nhất một biển số xe hợp lệ' });
    }

    // Kiểm tra định dạng và trùng lặp biển số
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
      cccd,
      oldCmt,
      fullName,
      dateOfBirth,
      gender,
      hometown,
      issueDate,
      vehicles: vehicles.map(v => ({
        licensePlate: v.licensePlate,
        vehicleType: v.vehicleType || getVehicleType(v.licensePlate),
        color: v.color?.trim() || '', // Thêm trường color
        brand: v.brand?.trim() || '', // Thêm trường brand
        status: v.status || 'Đã lấy',
        lastTransaction: v.lastTransaction || null,
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

    // Kiểm tra vehicles
    if (!vehicles || vehicles.length === 0 || vehicles.every(v => !v.licensePlate)) {
      return res.status(400).json({ error: 'Cần ít nhất một biển số xe hợp lệ' });
    }

    // Kiểm tra định dạng và trùng lặp biển số
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

    // Lấy thông tin người dùng hiện tại
    const currentUser = await User.findOne({ cccd: req.params.cccd });
    if (!currentUser) {
      return res.status(404).json({ error: 'Không tìm thấy người dùng' });
    }

    // Tạo danh sách xe mới, giữ nguyên status, lastTransaction, color, brand nếu không được cung cấp
    const updatedVehicles = vehicles.map((newVehicle) => {
      const existingVehicle = currentUser.vehicles.find(
        (v) => v.licensePlate === newVehicle.licensePlate
      );
      return {
        licensePlate: newVehicle.licensePlate,
        vehicleType: newVehicle.vehicleType || getVehicleType(newVehicle.licensePlate),
        color: newVehicle.color?.trim() || (existingVehicle ? existingVehicle.color : ''), // Thêm trường color
        brand: newVehicle.brand?.trim() || (existingVehicle ? existingVehicle.brand : ''), // Thêm trường brand
        status: newVehicle.status || (existingVehicle ? existingVehicle.status : 'Đã lấy'),
        lastTransaction: newVehicle.lastTransaction || (existingVehicle ? existingVehicle.lastTransaction : null),
      };
    });

    const user = await User.findOneAndUpdate(
      { cccd: req.params.cccd },
      {
        oldCmt,
        fullName,
        dateOfBirth,
        gender,
        hometown,
        issueDate,
        vehicles: updatedVehicles,
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

// Lấy danh sách xe trong bãi
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
        color: vehicle.color || '', // Thêm trường color
        brand: vehicle.brand || '', // Thêm trường brand
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

// Tìm kiếm xe theo CCCD
router.get('/search-by-cccd', auth, async (req, res) => {
  try {
    const { cccd } = req.query;
    if (!cccd) {
      return res.status(400).json({ error: 'Vui lòng cung cấp số CCCD.' });
    }

    const user = await User.findOne({ cccd });
    if (!user) {
      return res.status(404).json({ error: 'Không tìm thấy người dùng với CCCD này.' });
    }

    const vehicles = user.vehicles.map((vehicle) => ({
      cccd: user.cccd,
      licensePlate: vehicle.licensePlate,
      vehicleType: vehicle.vehicleType || getVehicleType(vehicle.licensePlate),
      color: vehicle.color || '', // Thêm trường color
      brand: vehicle.brand || '', // Thêm trường brand
      status: vehicle.status,
      timestamp: vehicle.lastTransaction?.timestamp,
      fullName: user.fullName,
      hometown: user.hometown,
      dateOfBirth: formatDateToDisplay(user.dateOfBirth),
      issueDate: formatDateToDisplay(user.issueDate),
    }));

    res.json({ vehicles, total: vehicles.length });
  } catch (error) {
    res.status(500).json({ error: 'Lỗi server: ' + error.message });
  }
});

// Thống kê số xe gửi/lấy theo ngày/tháng và tổng số xe đang gửi
router.get('/statistics', auth, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    // Chuyển đổi startDate và endDate sang UTC
    const start = startDate
      ? new Date(new Date(startDate).toISOString().split('T')[0] + 'T00:00:00.000Z')
      : new Date(new Date().toISOString().split('T')[0] + 'T00:00:00.000Z');
    const end = endDate
      ? new Date(new Date(endDate).toISOString().split('T')[0] + 'T23:59:59.999Z')
      : new Date(new Date().toISOString().split('T')[0] + 'T23:59:59.999Z');

    // Thống kê số xe gửi theo ngày
    const dailyStats = await Transaction.aggregate([
      {
        $match: {
          timestamp: { $gte: start, $lte: end },
          action: 'Gửi',
        },
      },
      {
        $group: {
          _id: {
            $dateToString: { format: '%Y-%m-%d', date: '$timestamp', timezone: 'UTC' },
          },
          count: { $sum: 1 },
        },
      },
      { $sort: { '_id': 1 } },
    ]);

    // Thống kê số xe gửi/lấy theo tháng
    const monthlyStats = await Transaction.aggregate([
      {
        $match: {
          timestamp: { $gte: start, $lte: end },
        },
      },
      {
        $group: {
          _id: {
            date: { $dateToString: { format: '%Y-%m', date: '$timestamp', timezone: 'UTC' } },
            action: '$action',
          },
          count: { $sum: 1 },
        },
      },
      {
        $group: {
          _id: '$_id.date',
          actions: {
            $push: {
              action: '$_id.action',
              count: '$count',
            },
          },
        },
      },
      { $sort: { '_id': 1 } },
      {
        $project: {
          _id: 1,
          actions: { $cond: { if: { $isArray: '$actions' }, then: '$actions', else: [] } },
        },
      },
    ]);

    // Tổng số xe đang gửi
    const parkedVehicles = await User.aggregate([
      { $unwind: '$vehicles' },
      { $match: { 'vehicles.status': 'Đang gửi' } },
      { $count: 'totalParked' },
    ]);

    const totalParked = parkedVehicles.length > 0 ? parkedVehicles[0].totalParked : 0;

    res.json({
      daily: dailyStats,
      monthly: monthlyStats,
      totalParked,
    });
  } catch (error) {
    console.error('Error in /statistics:', error);
    res.status(500).json({ error: 'Lỗi server: ' + error.message });
  }
});

module.exports = router;
