import { getMailConfig, getMailTransporter } from '../config/mail';

export const sendOTP = async (toEmail: string, otpCode: string) => {
  const transporter = getMailTransporter();
  const { from } = getMailConfig();

  await transporter.sendMail({
    from,
    to: toEmail,
    subject: 'Mã xác nhận tài khoản FreshFriends',
    text: `Mã xác nhận FreshFriends của bạn là ${otpCode}. Mã này sẽ hết hạn trong 5 phút.`,
    html: `
      <div style="font-family: Arial, sans-serif; padding: 20px; color: #1f2937;">
        <h2 style="color: #166534;">Xác nhận tài khoản FreshFriends</h2>
        <p>Mã xác nhận (OTP) của bạn là:</p>
        <h1 style="color: #4caf50; letter-spacing: 5px; font-size: 32px;">${otpCode}</h1>
        <p>Mã này sẽ hết hạn trong vòng 5 phút.</p>
        <p>Nếu bạn không yêu cầu mã này, vui lòng bỏ qua email.</p>
      </div>
    `,
  });
};
