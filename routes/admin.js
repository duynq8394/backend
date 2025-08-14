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
router.get('/statistics', async (req, res) => {
  try {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

    // DAILY - Tính số xe gửi và lấy theo từng ngày (dựa trên action)
    const dailyStats = await Transaction.aggregate([
      { $match: { timestamp: { $gte: start, $lte: end } } },
      {
        $group: {
          _id: {
            date: {
              $dateToString: {
                format: '%Y-%m-%d',
                date: '$timestamp',
                timezone: 'Asia/Ho_Chi_Minh'
              }
            },
            action: '$action'
          },
          count: { $sum: 1 }
        }
      },
      {
        $group: {
          _id: '$_id.date',
          actions: { $push: { action: '$_id.action', count: '$count' } }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    // WEEKLY - Tính số xe gửi và lấy theo từng tuần (dựa trên action)
    const weeklyStats = await Transaction.aggregate([
      { $match: { timestamp: { $gte: start, $lte: end } } },
      {
        $group: {
          _id: {
            year: { $isoWeekYear: { date: '$timestamp', timezone: 'Asia/Ho_Chi_Minh' } },
            week: { $isoWeek: { date: '$timestamp', timezone: 'Asia/Ho_Chi_Minh' } },
            action: '$action'
          },
          count: { $sum: 1 }
        }
      },
      {
        $group: {
          _id: { year: '$_id.year', week: '$_id.week' },
          actions: { $push: { action: '$_id.action', count: '$count' } }
        }
      },
      { $sort: { '_id.year': 1, '_id.week': 1 } },
      {
        $project: {
          _id: {
            $concat: [
              { $toString: '$_id.year' },
              '-W',
              { $toString: '$_id.week' }
            ]
          },
          actions: 1
        }
      }
    ]);

    // MONTHLY - Tính số xe gửi và lấy theo từng tháng (dựa trên action)
    const monthlyStats = await Transaction.aggregate([
      { $match: { timestamp: { $gte: start, $lte: end } } },
      {
        $group: {
          _id: {
            date: {
              $dateToString: {
                format: '%Y-%m',
                date: '$timestamp',
                timezone: 'Asia/Ho_Chi_Minh'
              }
            },
            action: '$action'
          },
          count: { $sum: 1 }
        }
      },
      {
        $group: {
          _id: '$_id.date',
          actions: { $push: { action: '$_id.action', count: '$count' } }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    // Chuyển đổi format dữ liệu để tương thích với frontend
    const convertActionsToStatuses = (data) => {
      return data.map(item => ({
        ...item,
        statuses: item.actions ? item.actions.map(action => ({
          status: action.action === 'Gửi' ? 'Đang gửi' : 'Đã lấy',
          count: action.count
        })) : []
      }));
    };

    // Tổng số xe đang gửi (hiện tại) - đếm số xe có trạng thái "Đang gửi" hiện tại
    // Chỉ đếm những xe thực sự đang trong bãi (không phải tất cả giao dịch)
    // Chỉ đếm những xe thực sự đang trong bãi (không phải tất cả giao dịch)
    const parkedCountAgg = await Transaction.aggregate([
      { $match: { status: 'Đang gửi' } },
      { $count: 'totalParked' }
    ]);
    const totalParked = parkedCountAgg.length > 0 ? parkedCountAgg[0].totalParked : 0;

    // Tính tổng số xe gửi và lấy mới trong tháng hiện tại (dựa trên action)
    // Chỉ đếm những giao dịch thực sự xảy ra trong tháng này
    let totalInMonth = 0;
    let totalOutMonth = 0;

    dailyStats.forEach(day => {
      if (day.actions && Array.isArray(day.actions)) {
        day.actions.forEach(actionItem => {
          if (actionItem.action === 'Gửi') {
            totalInMonth += actionItem.count;
          } else if (actionItem.action === 'Lấy') {
            totalOutMonth += actionItem.count;
          }
        });
      }
    });

    // Kiểm tra lại logic bằng cách query trực tiếp
    const directInMonth = await Transaction.aggregate([
      { 
        $match: { 
          action: 'Gửi',
          timestamp: { $gte: start, $lte: end }
        } 
      },
      { $count: 'count' }
    ]);

    const directOutMonth = await Transaction.aggregate([
      { 
        $match: { 
          action: 'Lấy',
          timestamp: { $gte: start, $lte: end }
        } 
      },
      { $count: 'count' }
    ]);

    const directInCount = directInMonth.length > 0 ? directInMonth[0].count : 0;
    const directOutCount = directOutMonth.length > 0 ? directOutMonth[0].count : 0;

    console.log('Statistics Debug Info:');
    console.log('- Total parked (status = "Đang gửi"):', totalParked);
    console.log('- Total in month (calculated):', totalInMonth);
    console.log('- Total out month (calculated):', totalOutMonth);
    console.log('- Total in month (direct query):', directInCount);
    console.log('- Total out month (direct query):', directOutCount);
    console.log('- Date range:', start, 'to', end);
    console.log('- Daily stats:', dailyStats);

    // Sử dụng kết quả từ direct query để đảm bảo chính xác
    res.json({
      daily: convertActionsToStatuses(dailyStats),
      weekly: convertActionsToStatuses(weeklyStats),
      monthly: convertActionsToStatuses(monthlyStats),
      totalParked,
      totalInMonth: directInCount,
      totalOutMonth: directOutCount
    });

  } catch (error) {
    console.error('Error in /statistics:', error);
    res.status(500).json({ error: 'Lỗi server: ' + error.message });
  }
});

// API test để kiểm tra dữ liệu thống kê
router.get('/statistics-debug', async (req, res) => {
  try {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

    // Kiểm tra tất cả giao dịch
    const allTransactions = await Transaction.find({}).sort({ timestamp: -1 }).limit(10);
    
    // Kiểm tra giao dịch có status "Đang gửi"
    const parkedTransactions = await Transaction.find({ status: 'Đang gửi' }).sort({ timestamp: -1 }).limit(10);
    
    // Kiểm tra giao dịch trong tháng này
    const monthTransactions = await Transaction.find({
      timestamp: { $gte: start, $lte: end }
    }).sort({ timestamp: -1 }).limit(10);

    // Đếm theo action
    const sendCount = await Transaction.countDocuments({ 
      action: 'Gửi',
      timestamp: { $gte: start, $lte: end }
    });
    
    const takeCount = await Transaction.countDocuments({ 
      action: 'Lấy',
      timestamp: { $gte: start, $lte: end }
    });

    // Đếm theo status
    const parkedCount = await Transaction.countDocuments({ status: 'Đang gửi' });
    const takenCount = await Transaction.countDocuments({ status: 'Đã lấy' });

    res.json({
      debug: {
        dateRange: {
          start: start,
          end: end,
          now: now
        },
        counts: {
          totalParked: parkedCount,
          totalTaken: takenCount,
          sendThisMonth: sendCount,
          takeThisMonth: takeCount
        },
        samples: {
          allTransactions: allTransactions.map(t => ({
            cccd: t.cccd,
            licensePlate: t.licensePlate,
            action: t.action,
            status: t.status,
            timestamp: t.timestamp
          })),
          parkedTransactions: parkedTransactions.map(t => ({
            cccd: t.cccd,
            licensePlate: t.licensePlate,
            action: t.action,
            status: t.status,
            timestamp: t.timestamp
          })),
          monthTransactions: monthTransactions.map(t => ({
            cccd: t.cccd,
            licensePlate: t.licensePlate,
            action: t.action,
            status: t.status,
            timestamp: t.timestamp
          }))
        }
      }
    });

  } catch (error) {
    console.error('Error in /statistics-debug:', error);
    res.status(500).json({ error: 'Lỗi server: ' + error.message });
  }
});

// API lấy danh sách người dùng
router.get('/users', auth, async (req, res) => {
  try {
    const users = await User.find().select('-__v');
    res.json({ users });
  } catch (error) {
    console.error('Error in /users:', error);
    res.status(500).json({ error: 'Lỗi server: ' + error.message });
  }
});

// API xóa người dùng
router.delete('/users/:cccd', auth, async (req, res) => {
  try {
    const { cccd } = req.params;
    const user = await User.findOne({ cccd });
    
    if (!user) {
      return res.status(404).json({ error: 'Không tìm thấy người dùng' });
    }

    // Kiểm tra xem có xe nào đang gửi không
    const hasParkedVehicles = user.vehicles.some(vehicle => vehicle.status === 'Đang gửi');
    if (hasParkedVehicles) {
      return res.status(400).json({ error: 'Không thể xóa người dùng có xe đang gửi' });
    }

    await User.deleteOne({ cccd });
    res.json({ message: 'Xóa người dùng thành công' });
  } catch (error) {
    console.error('Error in /users/:cccd DELETE:', error);
    res.status(500).json({ error: 'Lỗi server: ' + error.message });
  }
});

// API lấy thống kê dashboard
router.get('/dashboard-stats', auth, async (req, res) => {
  try {
    // Tổng số người dùng
    const totalUsers = await User.countDocuments();

    // Tổng số xe
    const totalVehicles = await User.aggregate([
      { $unwind: '$vehicles' },
      { $count: 'total' }
    ]);

    // Số xe đang gửi
    const parkedVehicles = await User.aggregate([
      { $unwind: '$vehicles' },
      { $match: { 'vehicles.status': 'Đang gửi' } },
      { $count: 'total' }
    ]);

    // Giao dịch hôm nay (không cần timezone conversion)
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const todayTransactions = await Transaction.countDocuments({
      timestamp: { $gte: today }
    });

    // Giao dịch tháng này (không cần timezone conversion)
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);
    
    const monthlyTransactions = await Transaction.countDocuments({
      timestamp: { $gte: startOfMonth }
    });

    res.json({
      totalUsers,
      totalVehicles: totalVehicles.length > 0 ? totalVehicles[0].total : 0,
      parkedVehicles: parkedVehicles.length > 0 ? parkedVehicles[0].total : 0,
      todayTransactions,
      monthlyTransactions
    });
  } catch (error) {
    console.error('Error in /dashboard-stats:', error);
    res.status(500).json({ error: 'Lỗi server: ' + error.message });
  }
});

module.exports = router;
