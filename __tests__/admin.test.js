require('dotenv').config();
const request = require('supertest');
const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const adminRoutes = require('../routes/admin');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const Admin = require('../models/Admin');

const app = express();
app.use(express.json());
app.use('/api/admin', adminRoutes);

describe('Admin Routes', () => {
  let token;

  beforeEach(async () => {
    await User.deleteMany({});
    await Transaction.deleteMany({});
    await Admin.deleteMany({});

    // Tạo admin test
    const hashedPassword = await bcrypt.hash('admin123', 10);
    const admin = new Admin({
      username: 'admin',
      password: hashedPassword,
      role: 'admin'
    });
    await admin.save();

    // Tạo token cho test
    token = jwt.sign({ username: 'admin', role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '1h' });
  });

  describe('POST /api/admin/login', () => {
    it('should login admin with correct credentials', async () => {
      const res = await request(app)
        .post('/api/admin/login')
        .send({ username: 'admin', password: 'admin123' });

      expect(res.status).toBe(200);
      expect(res.body.token).toBeTruthy();
    });

    it('should return error for incorrect password', async () => {
      const res = await request(app)
        .post('/api/admin/login')
        .send({ username: 'admin', password: 'wrongpassword' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Mật khẩu sai');
    });

    it('should return error for non-existent admin', async () => {
      const res = await request(app)
        .post('/api/admin/login')
        .send({ username: 'nonexistent', password: 'admin123' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Tài khoản không tồn tại');
    });
  });

  describe('POST /api/admin/add-user', () => {
    it('should add a new user with valid data', async () => {
      const userData = {
        cccd: '123456789',
        oldCmt: '987654',
        fullName: 'Nguyen Van A',
        dateOfBirth: '1990-01-01',
        gender: 'Nam',
        hometown: 'Hà Nội',
        issueDate: '2020-01-01',
        licensePlate: '29A-12345',
        vehicleType: 'Xe máy'
      };

      const res = await request(app)
        .post('/api/admin/add-user')
        .set('Authorization', `Bearer ${token}`)
        .send(userData);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.user.cccd).toBe('123456789');

      const user = await User.findOne({ cccd: '123456789' });
      expect(user).toBeTruthy();
      expect(user.fullName).toBe('Nguyen Van A');
    });

    it('should return error for missing required fields', async () => {
      const res = await request(app)
        .post('/api/admin/add-user')
        .set('Authorization', `Bearer ${token}`)
        .send({ fullName: 'Nguyen Van A' });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Lỗi khi thêm/);
    });

    it('should return error for unauthorized access', async () => {
      const res = await request(app)
        .post('/api/admin/add-user')
        .send({ cccd: '123456789', fullName: 'Nguyen Van A' });

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Không có token');
    });
  });

  describe('PUT /api/admin/update-user/:cccd', () => {
    it('should update user info', async () => {
      const user = new User({
        cccd: '123456789',
        oldCmt: '987654',
        fullName: 'Nguyen Van A',
        dateOfBirth: new Date('1990-01-01'),
        gender: 'Nam',
        hometown: 'Hà Nội',
        issueDate: new Date('2020-01-01'),
        licensePlate: '29A-12345',
        vehicleType: 'Xe máy'
      });
      await user.save();

      const res = await request(app)
        .put('/api/admin/update-user/123456789')
        .set('Authorization', `Bearer ${token}`)
        .send({ fullName: 'Nguyen Van B', licensePlate: '29A-67890' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.user.fullName).toBe('Nguyen Van B');
      expect(res.body.user.licensePlate).toBe('29A-67890');
    });

    it('should return error for non-existent user', async () => {
      const res = await request(app)
        .put('/api/admin/update-user/999999999')
        .set('Authorization', `Bearer ${token}`)
        .send({ fullName: 'Nguyen Van B' });

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Không tìm thấy người dùng');
    });
  });

  describe('GET /api/admin/vehicles', () => {
    it('should return list of vehicles in parking', async () => {
      const user = new User({
        cccd: '123456789',
        fullName: 'Nguyen Van A',
        dateOfBirth: new Date('1990-01-01'),
        gender: 'Nam',
        hometown: 'Hà Nội',
        issueDate: new Date('2020-01-01'),
        licensePlate: '29A-12345',
        vehicleType: 'Xe máy'
      });
      await user.save();

      const transaction = new Transaction({
        cccd: '123456789',
        licensePlate: '29A-12345',
        action: 'Gửi',
        status: 'Đang gửi',
        timestamp: new Date()
      });
      await transaction.save();

      const res = await request(app)
        .get('/api/admin/vehicles')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.vehicles).toHaveLength(1);
      expect(res.body.vehicles[0].cccd).toBe('123456789');
      expect(res.body.vehicles[0].status).toBe('Đang gửi');
      expect(res.body.total).toBe(1);
    });

    it('should filter vehicles by status', async () => {
      const user = new User({
        cccd: '123456789',
        fullName: 'Nguyen Van A',
        dateOfBirth: new Date('1990-01-01'),
        gender: 'Nam',
        hometown: 'Hà Nội',
        issueDate: new Date('2020-01-01'),
        licensePlate: '29A-12345',
        vehicleType: 'Xe máy'
      });
      await user.save();

      await new Transaction({
        cccd: '123456789',
        licensePlate: '29A-12345',
        action: 'Gửi',
        status: 'Đang gửi',
        timestamp: new Date()
      }).save();

      await new Transaction({
        cccd: '123456789',
        licensePlate: '29A-12345',
        action: 'Lấy',
        status: 'Đã lấy',
        timestamp: new Date()
      }).save();

      const res = await request(app)
        .get('/api/admin/vehicles?status=' + encodeURIComponent('Đã lấy'))
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.vehicles).toHaveLength(1);
      expect(res.body.vehicles[0].status).toBe('Đã lấy');
    });
  });

  describe('GET /api/admin/statistics', () => {
    it('should return daily and monthly statistics', async () => {
      const user = new User({
        cccd: '123456789',
        fullName: 'Nguyen Van A',
        dateOfBirth: new Date('1990-01-01'),
        gender: 'Nam',
        hometown: 'Hà Nội',
        issueDate: new Date('2020-01-01'),
        licensePlate: '29A-12345',
        vehicleType: 'Xe máy'
      });
      await user.save();

      await new Transaction({
        cccd: '123456789',
        licensePlate: '29A-12345',
        action: 'Gửi',
        status: 'Đang gửi',
        timestamp: new Date('2025-07-01')
      }).save();

      await new Transaction({
        cccd: '123456789',
        licensePlate: '29A-12345',
        action: 'Gửi',
        status: 'Đang gửi',
        timestamp: new Date('2025-07-02')
      }).save();

      const res = await request(app)
        .get('/api/admin/statistics?startDate=2025-07-01&endDate=2025-07-02')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.daily).toHaveLength(2);
      expect(res.body.daily[0].count).toBe(1);
      expect(res.body.monthly).toHaveLength(1);
      expect(res.body.monthly[0].count).toBe(2);
    });
  });
});