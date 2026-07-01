import { Request, Response } from 'express';
import { registerUser, loginUser, getUserProfile, verifyEmailOTP, resendEmailOTP, googleLoginService } from '../services/authService';
import { AuthRequest } from '../middleware/authMiddleware';

export const register = async (req: Request, res: Response) => {
  try {
    const { fullName, email, password, phoneNumber } = req.body;

    if (!fullName || !email || !password) {
      res.status(400).json({ message: 'Please provide fullName, email and password' });
      return;
    }

    const passwordRegex = /^(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z\d]).{8,}$/;
    if (!passwordRegex.test(password)) {
      res.status(400).json({ 
        message: 'Password must be at least 8 characters long, contain at least 1 uppercase letter, 1 number, and 1 special character' 
      });
      return;
    }

    const result = await registerUser({ fullName, email, password, phoneNumber });
    res.status(201).json({
      ...result,
      message: 'Vui lòng kiểm tra email để lấy mã xác nhận'
    });
  } catch (error: any) {
    if (error.message === 'Email already in use') {
      res.status(400).json({ message: error.message });
    } else {
      res.status(500).json({ message: 'Server error', error: error.message });
    }
  }
};

export const verifyOTP = async (req: Request, res: Response) => {
  try {
    const { email, otp } = req.body;
    if (!email || !otp) {
      res.status(400).json({ message: 'Vui lòng cung cấp email và mã OTP' });
      return;
    }
    const result = await verifyEmailOTP(email, otp);
    res.json(result);
  } catch (error: any) {
    res.status(400).json({ message: error.message });
  }
};

export const resendOTP = async (req: Request, res: Response) => {
  try {
    const { email } = req.body;
    if (!email) {
      res.status(400).json({ message: 'Vui lòng cung cấp email' });
      return;
    }
    const result = await resendEmailOTP(email);
    res.json(result);
  } catch (error: any) {
    res.status(400).json({ message: error.message });
  }
};

export const login = async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      res.status(400).json({ message: 'Please provide email and password' });
      return;
    }

    const result = await loginUser({ email, password });
    res.json({
      message: 'Login successful',
      ...result
    });
  } catch (error: any) {
    if (error.message === 'Invalid credentials' || error.message.includes('account is')) {
      res.status(401).json({ message: error.message });
    } else {
      res.status(500).json({ message: 'Server error', error: error.message });
    }
  }
};

export const googleLogin = async (req: Request, res: Response) => {
  try {
    const { accessToken } = req.body;
    if (!accessToken) {
      res.status(400).json({ message: 'Missing accessToken' });
      return;
    }

    // Xác thực token với Google API
    const response = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    
    if (!response.ok) {
      res.status(401).json({ message: 'Token Google không hợp lệ hoặc đã hết hạn' });
      return;
    }
    
    const userInfo = await response.json();
    if (!userInfo.email) {
      res.status(400).json({ message: 'Không lấy được email từ Google' });
      return;
    }

    const result = await googleLoginService(userInfo);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ message: 'Lỗi máy chủ khi đăng nhập Google', error: error.message });
  }
};
export const getMe = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      res.status(401).json({ message: 'Not authorized' });
      return;
    }

    const result = await getUserProfile(req.user.userId);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};
