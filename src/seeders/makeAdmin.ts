import mongoose from 'mongoose';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import { User } from '../models/user.model';

dotenv.config();

const createAdminAccount = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI as string);
    console.log('Connected to MongoDB');

    const email = 'admin@gmail.com';
    const password = '123'; // Mật khẩu mặc định đơn giản

    // Kiểm tra xem đã có chưa
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      existingUser.role = 'ADMIN';
      await existingUser.save();
      console.log(`✅ Đã cập nhật quyền ADMIN cho tài khoản sẵn có: ${email}`);
    } else {
      // Băm mật khẩu và tạo mới
      const salt = await bcrypt.genSalt(10);
      const passwordHash = await bcrypt.hash(password, salt);

      const newAdmin = new User({
        fullName: 'System Admin',
        email,
        passwordHash,
        role: 'ADMIN',
        status: 'ACTIVE'
      });

      await newAdmin.save();
      console.log(`✅ Đã tạo tài khoản ADMIN mới:`);
      console.log(`   Email: ${email}`);
      console.log(`   Password: ${password}`);
    }

    process.exit(0);
  } catch (error) {
    console.error('Lỗi khi tạo admin:', error);
    process.exit(1);
  }
};

createAdminAccount();
