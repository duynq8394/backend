const request = require('supertest');
const express = require('express');
const mongoose = require('mongoose');
const apiRoutes = require('../routes/api');
const User = require('../models/User');
const Transaction = require('../models/Transaction');

const app = express();
app.use(express.json());
app.use('/api', apiRoutes);

describe('API Routes', () => {
  beforeEach(async () => {
    await User.deleteMany({});
    await Transaction.deleteMany({});
  });

  describe('POST /api/scan', () => {
    it('should return user info if QR is valid and user exists', async () => {
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

      const qrString = '123456789|987654|Nguyen Van A|01-01-1990|Nam|Hà Nội|01-01-2020';
      const res = await request(app)
        .post('/api/scan')
        .send({ qrString });

      expect(res.status).toBe(200);
      expect(res.body.user.cccd).toBe('123456789');
      expect(res.body.user.fullName).toBe('Nguyen Van A');
      expect(res.body.status).toBe('Chưa có giao dịch');
    });

    it('should return error if user does not exist', async () => {
      const qrString = '999999999|987654|Nguyen Van B|01-01-1990|Nam|Hà Nội|01-01-2020';
      const res = await request(app)
        .post('/api/scan')
        .send({ qrString });

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Chưa đăng ký');
    });
  });

  describe('POST /api/action', () => {
    it('should record a send vehicle action', async () => {
      const user = new User({
        cccd: '123456789',
        licensePlate: '29A-12345',
        fullName: 'Nguyen Van A',
        dateOfBirth: new Date('1990-01-01'),
        gender: 'Nam',
        hometown: 'Hà Nội',
        issueDate: new Date('2020-01-01'),
        vehicleType: 'Xe máy'
      });
      await user.save();

      const res = await request(app)
        .post('/api/action')
        .send({ cccd: '123456789', action: 'Gửi' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.status).toBe('Đang gửi');

      const transaction = await Transaction.findOne({ cccd: '123456789' });
      expect(transaction).toBeTruthy();
      expect(transaction.action).toBe('Gửi');
    });

    it('should return error for invalid user', async () => {
      const res = await request(app)
        .post('/api/action')
        .send({ cccd: '999999999', action: 'Gửi' });

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Chưa đăng ký');
    });
  });
});