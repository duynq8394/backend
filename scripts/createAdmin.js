const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const Admin = require('../models/Admin');
require('dotenv').config();

const createAdmin = async () => {
  try {
    // Kết nối tới MongoDB
    await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('Connected to MongoDB');

    // Thông tin tài khoản admin
    const username = 'admin';
    const password = 'admin123'; // Đổi mật khẩu nếu cần
    const role = 'admin';

    // Kiểm tra xem admin đã tồn tại chưa
    const existingAdmin = await Admin.findOne({ username });
    if (existingAdmin) {
      console.log('Admin already exists:', username);
      return;
    }

    // Mã hóa mật khẩu
    const hashedPassword = await bcrypt.hash(password, 10);

    // Tạo admin mới
    const admin = new Admin({
      username,
      password: hashedPassword,
      role,
    });

    await admin.save();
    console.log('Admin created successfully:', username);
  } catch (error) {
    console.error('Error creating admin:', error);
  } finally {
    mongoose.connection.close();
  }
};

createAdmin();