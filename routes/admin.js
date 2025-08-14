const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const Admin = require('../models/Admin');
const InventorySession = require('../models/InventorySession');
const InventoryRecord = require('../models/InventoryRecord');

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
    const { period = 'month', startDate, endDate } = req.query;
    
    // Xác định khoảng thời gian
    let start, end;
    const now = new Date();
    
    if (startDate && endDate) {
      // Nếu có filter date
      start = new Date(startDate + 'T00:00:00.000Z');
      end = new Date(endDate + 'T23:59:59.999Z');
    } else {
      // Mặc định tháng hiện tại
      start = new Date(now.getFullYear(), now.getMonth(), 1);
      end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
    }

    // Tổng số xe đang gửi (hiện tại) - đếm từ bảng User
    const parkedVehicles = await User.aggregate([
      { $unwind: '$vehicles' },
      { $match: { 'vehicles.status': 'Đang gửi' } },
      { $count: 'totalParked' }
    ]);
    const totalParked = parkedVehicles.length > 0 ? parkedVehicles[0].totalParked : 0;

    // Thống kê theo ngày
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

    // Thống kê theo tuần
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

    // Thống kê theo tháng
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

    // Tính tổng số xe gửi và lấy trong khoảng thời gian
    const totalInPeriod = await Transaction.aggregate([
      { 
        $match: { 
          action: 'Gửi',
          timestamp: { $gte: start, $lte: end }
        } 
      },
      { $count: 'count' }
    ]);

    const totalOutPeriod = await Transaction.aggregate([
      { 
        $match: { 
          action: 'Lấy',
          timestamp: { $gte: start, $lte: end }
        } 
      },
      { $count: 'count' }
    ]);

    const totalIn = totalInPeriod.length > 0 ? totalInPeriod[0].count : 0;
    const totalOut = totalOutPeriod.length > 0 ? totalOutPeriod[0].count : 0;

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

    console.log('Statistics Debug Info:');
    console.log('- Date range:', start, 'to', end);
    console.log('- Total parked (from User):', totalParked);
    console.log('- Total in period:', totalIn);
    console.log('- Total out period:', totalOut);
    console.log('- Period:', period);

    res.json({
      daily: convertActionsToStatuses(dailyStats),
      weekly: convertActionsToStatuses(weeklyStats),
      monthly: convertActionsToStatuses(monthlyStats),
      totalParked,
      totalIn,
      totalOut,
      period,
      dateRange: {
        start: start.toISOString(),
        end: end.toISOString()
      }
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

// API tìm kiếm biển số xe theo 4-5 số cuối
router.get('/search-license-plate/:lastDigits', auth, async (req, res) => {
  try {
    const { lastDigits } = req.params;
    
    if (!lastDigits || lastDigits.length < 4 || lastDigits.length > 5) {
      return res.status(400).json({ error: 'Vui lòng nhập 4-5 số cuối của biển số xe' });
    }

    // Tìm kiếm biển số xe có số cuối khớp
    const users = await User.find({
      'vehicles.licensePlate': { $regex: lastDigits + '$', $options: 'i' }
    }).select('cccd fullName vehicles');

    // Lọc và format kết quả
    const results = [];
    users.forEach(user => {
      user.vehicles.forEach(vehicle => {
        if (vehicle.licensePlate.endsWith(lastDigits)) {
          results.push({
            id: vehicle._id,
            licensePlate: vehicle.licensePlate,
            vehicleType: vehicle.vehicleType,
            color: vehicle.color,
            brand: vehicle.brand,
            status: vehicle.status,
            ownerName: user.fullName,
            ownerCccd: user.cccd
          });
        }
      });
    });

    res.json({ results });
  } catch (error) {
    console.error('Error in /search-license-plate:', error);
    res.status(500).json({ error: 'Lỗi server: ' + error.message });
  }
});

// API bắt đầu phiên kiểm kê mới
router.post('/inventory/start', auth, async (req, res) => {
  try {
    const { sessionName, description } = req.body;
    
    // Tạo session kiểm kê mới
    const inventorySession = new InventorySession({
      sessionName: sessionName || `Kiểm kê ${new Date().toLocaleDateString('vi-VN')}`,
      description: description || '',
      startedBy: req.admin.username,
      startedAt: new Date(),
      status: 'active'
    });

    await inventorySession.save();
    
    res.json({ 
      message: 'Bắt đầu phiên kiểm kê thành công',
      sessionId: inventorySession._id 
    });
  } catch (error) {
    console.error('Error in /inventory/start:', error);
    res.status(500).json({ error: 'Lỗi server: ' + error.message });
  }
});

// API ghi nhận kiểm kê biển số xe
router.post('/inventory/check', auth, async (req, res) => {
  try {
    const { sessionId, licensePlate, status, notes } = req.body;
    
    if (!sessionId || !licensePlate) {
      return res.status(400).json({ error: 'Thiếu thông tin session hoặc biển số xe' });
    }

    // Kiểm tra session có tồn tại và đang active
    const session = await InventorySession.findById(sessionId);
    if (!session || session.status !== 'active') {
      return res.status(400).json({ error: 'Phiên kiểm kê không hợp lệ hoặc đã kết thúc' });
    }

    // Tạo hoặc cập nhật bản ghi kiểm kê
    const inventoryRecord = await InventoryRecord.findOneAndUpdate(
      { sessionId, licensePlate },
      {
        sessionId,
        licensePlate,
        status: status || 'checked',
        notes: notes || '',
        checkedBy: req.admin.username,
        checkedAt: new Date(),
        count: 1 // Tăng bộ đếm
      },
      { upsert: true, new: true }
    );

    res.json({ 
      message: 'Ghi nhận kiểm kê thành công',
      record: inventoryRecord 
    });
  } catch (error) {
    console.error('Error in /inventory/check:', error);
    res.status(500).json({ error: 'Lỗi server: ' + error.message });
  }
});

// API kết thúc phiên kiểm kê
router.post('/inventory/end/:sessionId', auth, async (req, res) => {
  try {
    const { sessionId } = req.params;
    
    // Cập nhật trạng thái session
    const session = await InventorySession.findByIdAndUpdate(
      sessionId,
      { 
        status: 'completed',
        endedAt: new Date(),
        endedBy: req.admin.username
      },
      { new: true }
    );

    if (!session) {
      return res.status(404).json({ error: 'Không tìm thấy phiên kiểm kê' });
    }

    // Lấy tất cả biển số xe có trạng thái "Đang gửi" trong hệ thống
    const parkedVehicles = await User.aggregate([
      { $unwind: '$vehicles' },
      { $match: { 'vehicles.status': 'Đang gửi' } },
      { $project: { licensePlate: '$vehicles.licensePlate' } }
    ]);

    const parkedLicensePlates = parkedVehicles.map(v => v.licensePlate);

    // Lấy danh sách biển số đã kiểm kê
    const checkedRecords = await InventoryRecord.find({ sessionId });
    const checkedLicensePlates = checkedRecords.map(r => r.licensePlate);

    // Tìm biển số chưa kiểm kê (chỉ trong số xe đang gửi)
    const uncheckedLicensePlates = parkedLicensePlates.filter(
      plate => !checkedLicensePlates.includes(plate)
    );

    // Tạo báo cáo tổng hợp
    const report = {
      sessionId,
      sessionName: session.sessionName,
      totalVehicles: parkedLicensePlates.length, // Chỉ đếm xe đang gửi
      checkedVehicles: checkedLicensePlates.length,
      uncheckedVehicles: uncheckedLicensePlates.length,
      checkedRecords: checkedRecords,
      uncheckedLicensePlates: uncheckedLicensePlates, // Chỉ xe đang gửi chưa kiểm kê
      startedAt: session.startedAt,
      endedAt: session.endedAt
    };

    res.json({ 
      message: 'Kết thúc phiên kiểm kê thành công',
      report 
    });
  } catch (error) {
    console.error('Error in /inventory/end:', error);
    res.status(500).json({ error: 'Lỗi server: ' + error.message });
  }
});

// API lấy danh sách phiên kiểm kê
router.get('/inventory/sessions', auth, async (req, res) => {
  try {
    const sessions = await InventorySession.find()
      .sort({ startedAt: -1 })
      .limit(50);
    
    res.json({ sessions });
  } catch (error) {
    console.error('Error in /inventory/sessions:', error);
    res.status(500).json({ error: 'Lỗi server: ' + error.message });
  }
});

// API lấy chi tiết phiên kiểm kê
router.get('/inventory/session/:sessionId', auth, async (req, res) => {
  try {
    const { sessionId } = req.params;
    
    const session = await InventorySession.findById(sessionId);
    if (!session) {
      return res.status(404).json({ error: 'Không tìm thấy phiên kiểm kê' });
    }

    const records = await InventoryRecord.find({ sessionId });
    
    res.json({ session, records });
  } catch (error) {
    console.error('Error in /inventory/session:', error);
    res.status(500).json({ error: 'Lỗi server: ' + error.message });
  }
});

// API tìm kiếm biển số xe cho inventory (tương tự như search-license-plate)
router.get('/inventory/search-license-plate/:lastDigits', auth, async (req, res) => {
  try {
    const { lastDigits } = req.params;
    
    if (!lastDigits || lastDigits.length < 4 || lastDigits.length > 5) {
      return res.status(400).json({ error: 'Vui lòng nhập 4-5 số cuối của biển số xe' });
    }

    // Tìm kiếm biển số xe có số cuối khớp
    const users = await User.find({
      'vehicles.licensePlate': { $regex: lastDigits + '$', $options: 'i' }
    }).select('cccd fullName vehicles');

    // Lọc và format kết quả
    const results = [];
    users.forEach(user => {
      user.vehicles.forEach(vehicle => {
        if (vehicle.licensePlate.endsWith(lastDigits)) {
          results.push({
            id: vehicle._id,
            licensePlate: vehicle.licensePlate,
            vehicleType: vehicle.vehicleType,
            color: vehicle.color,
            brand: vehicle.brand,
            status: vehicle.status,
            ownerName: user.fullName,
            ownerCccd: user.cccd
          });
        }
      });
    });

    res.json({ results });
  } catch (error) {
    console.error('Error in /inventory/search-license-plate:', error);
    res.status(500).json({ error: 'Lỗi server: ' + error.message });
  }
});

module.exports = router;
