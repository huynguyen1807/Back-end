import nodemailer from 'nodemailer';

export const sendOTP = async (toEmail: string, otpCode: string) => {
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS?.replace(/\s/g, ''), // Xóa dấu cách nếu có
    },
  });

  const mailOptions = {
    from: `"FreshFriends" <${process.env.SMTP_USER}>`,
    to: toEmail,
    subject: 'Mã xác nhận Đăng ký tài khoản FreshFriends',
    html: `
      <div style="font-family: Arial, sans-serif; padding: 20px;">
        <h2 style="color: #2e7d32;">Chào mừng bạn đến với FreshFriends!</h2>
        <p>Mã xác nhận (OTP) của bạn để kích hoạt tài khoản là:</p>
        <h1 style="color: #4caf50; letter-spacing: 5px; font-size: 32px;">${otpCode}</h1>
        <p>Mã này sẽ hết hạn trong vòng 5 phút.</p>
        <p>Nếu bạn không yêu cầu đăng ký, vui lòng bỏ qua email này.</p>
      </div>
    `,
  };

  await transporter.sendMail(mailOptions);
};
