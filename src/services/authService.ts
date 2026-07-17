import bcrypt from 'bcryptjs';
import { User } from '../models/user.model';
import { signToken } from '../utils/jwt';
import { UserPreference } from '../models/userPreference.model';

import { OTP } from '../models/otp.model';
import { sendOTP } from '../utils/mailer';

const normalizeEmail = (email: string) => email.trim().toLowerCase();

export const registerUser = async (userData: any) => {
  const { fullName, password, phoneNumber } = userData;
  const email = normalizeEmail(userData.email);

  const existingUser = await User.findOne({ email });
  if (existingUser) {
    throw new Error('Email already in use');
  }

  const salt = await bcrypt.genSalt(10);
  const passwordHash = await bcrypt.hash(password, salt);

  const newUser = await User.create({
    fullName,
    email,
    passwordHash,
    phoneNumber,
    status: 'INACTIVE' // Phải xác nhận OTP mới cho ACTIVE
  });

  await UserPreference.create({ userId: newUser._id });

  // Generate 6-digit OTP
  const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
  await OTP.create({ email, otp: otpCode });

  try {
    await sendOTP(email, otpCode);
  } catch (error) {
    console.error('Lỗi gửi email OTP:', error);
  }

  return {
    user: {
      id: newUser._id,
      email: newUser.email,
      status: newUser.status
    },
    message: "OTP sent to email"
  };
};

export const verifyEmailOTP = async (email: string, otpCode: string) => {
  const normalizedEmail = normalizeEmail(email);
  const otpRecord = await OTP.findOne({ email: normalizedEmail, otp: otpCode });
  if (!otpRecord) {
    throw new Error('Mã OTP không hợp lệ hoặc đã hết hạn');
  }

  const user = await User.findOne({ email: normalizedEmail });
  if (!user) throw new Error('User not found');

  user.status = 'ACTIVE';
  await user.save();

  await OTP.deleteMany({ email: normalizedEmail }); // Xóa hết OTP cũ
  return { message: 'Xác thực thành công' };
};

export const resendEmailOTP = async (email: string) => {
  const normalizedEmail = normalizeEmail(email);
  const user = await User.findOne({ email: normalizedEmail });
  if (!user) throw new Error('User not found');
  if (user.status === 'ACTIVE') throw new Error('Tài khoản đã được xác thực');

  await OTP.deleteMany({ email: normalizedEmail }); // Xóa OTP cũ nếu có

  const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
  await OTP.create({ email: normalizedEmail, otp: otpCode });

  try {
    await sendOTP(normalizedEmail, otpCode);
  } catch (error) {
    console.error('Lỗi gửi lại email OTP:', error);
  }

  return { message: 'Đã gửi lại mã OTP' };
};

export const loginUser = async (credentials: any) => {
  const { password } = credentials;
  const email = normalizeEmail(credentials.email);

  // Check if user exists
  const user = await User.findOne({ email });
  if (!user) {
    throw new Error('Email không tồn tại trong hệ thống');
  }

  // Check password
  const isMatch = await bcrypt.compare(password, user.passwordHash);
  if (!isMatch) {
    throw new Error('Mật khẩu không chính xác');
  }

  if (user.status !== 'ACTIVE') {
    throw new Error(`User account is ${user.status.toLowerCase()}`);
  }

  const token = signToken({ userId: user._id.toString(), role: user.role });

  return {
    user: {
      id: user._id,
      fullName: user.fullName,
      email: user.email,
      role: user.role,
      avatarUrl: user.avatarUrl
    },
    token
  };
};

export const googleLoginService = async (googleUser: any) => {
  const { name, picture } = googleUser;
  const email = normalizeEmail(googleUser.email);
  
  let user = await User.findOne({ email });
  
  if (!user) {
    // Auto register for new Google user
    user = await User.create({
      fullName: name || 'Người dùng Google',
      email: email,
      passwordHash: 'google_sso_' + Math.random().toString(36).substring(2),
      avatarUrl: picture,
      status: 'ACTIVE' // Mặc định ACTIVE vì Google đã xác thực
    });
    
    await UserPreference.create({ userId: user._id });
  } else if (user.status !== 'ACTIVE') {
    user.status = 'ACTIVE';
    await user.save();
  }
  
  const token = signToken({ userId: user._id.toString(), role: user.role });
  
  return {
    user: {
      id: user._id,
      email: user.email,
      fullName: user.fullName,
      avatarUrl: user.avatarUrl,
      role: user.role
    },
    token
  };
};
export const getUserProfile = async (userId: string) => {
  const user = await User.findById(userId).select('-passwordHash');
  if (!user) {
    throw new Error('User not found');
  }
  
  const preferences = await UserPreference.findOne({ userId });
  
  return {
    user,
    preferences
  };
};

export const forgotPasswordService = async (email: string) => {
  const normalizedEmail = normalizeEmail(email);
  const user = await User.findOne({ email: normalizedEmail });
  if (!user) throw new Error('Email không tồn tại trong hệ thống');

  await OTP.deleteMany({ email: normalizedEmail });

  const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
  await OTP.create({ email: normalizedEmail, otp: otpCode });

  try {
    await sendOTP(normalizedEmail, otpCode);
  } catch (error) {
    console.error('Lỗi gửi email quên mật khẩu:', error);
  }

  return { message: 'Mã xác nhận đã được gửi đến email của bạn' };
};

export const resetPasswordService = async (email: string, otpCode: string, newPassword: string) => {
  const normalizedEmail = normalizeEmail(email);
  const otpRecord = await OTP.findOne({ email: normalizedEmail, otp: otpCode });
  if (!otpRecord) {
    throw new Error('Mã OTP không hợp lệ hoặc đã hết hạn');
  }

  const user = await User.findOne({ email: normalizedEmail });
  if (!user) throw new Error('User not found');

  const salt = await bcrypt.genSalt(10);
  const passwordHash = await bcrypt.hash(newPassword, salt);
  
  user.passwordHash = passwordHash;
  await user.save();

  await OTP.deleteMany({ email: normalizedEmail });
  return { message: 'Đặt lại mật khẩu thành công' };
};
