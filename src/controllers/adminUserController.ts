import { Request, Response } from 'express';
import { User } from '../models/user.model';
import { HouseholdMember } from '../models/householdMember.model';
import { Household } from '../models/household.model';
import { PaymentTransaction } from '../models/paymentTransaction.model';
import { Notification } from '../models/notification.model';

export const adminGetStats = async (req: Request, res: Response) => {
  try {
    const totalUsers = await User.countDocuments();
    const activeHouseholds = await Household.countDocuments();
    
    // Doanh thu (tổng số tiền từ các giao dịch thành công)
    const revenueResult = await PaymentTransaction.aggregate([
      { $match: { status: 'SUCCESS' } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);
    const totalRevenue = revenueResult.length > 0 ? revenueResult[0].total : 0;

    // Đăng ký mới hôm nay
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const newUsersToday = await User.countDocuments({ createdAt: { $gte: startOfToday } });

    res.json({
      success: true,
      data: {
        totalUsers,
        activeHouseholds,
        totalRevenue: `${totalRevenue.toLocaleString('vi-VN')}đ`,
        newUsersToday
      }
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

export const adminListUsers = async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const skip = (page - 1) * limit;

    const users = await User.find({})
      .select('-passwordHash')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await User.countDocuments();

    res.json({
      success: true,
      data: users,
      pagination: {
        total,
        page,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

export const adminRemoveUserFromHousehold = async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    
    // Tìm user
    const user = await User.findById(userId);
    if (!user) {
      res.status(404).json({ success: false, message: 'Không tìm thấy người dùng' });
      return;
    }

    // Xóa user khỏi tất cả các household (hỗ trợ kỹ thuật)
    const result = await HouseholdMember.deleteMany({ userId });

    res.json({
      success: true,
      message: `Đã gỡ người dùng khỏi ${result.deletedCount} gia đình (Household).`,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

import { SupportTicket } from '../models/supportTicket.model';

export const adminListTickets = async (req: Request, res: Response) => {
  try {
    const tickets = await SupportTicket.find().populate('userId', 'fullName email').sort({ createdAt: -1 });
    res.json({ success: true, data: tickets });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};

export const adminResolveTicket = async (req: Request, res: Response) => {
  try {
    const ticketId = req.params.ticketId;
    const ticket = await SupportTicket.findById(ticketId);

    if (!ticket) {
      res.status(404).json({ success: false, message: 'Không tìm thấy ticket' });
      return;
    }

    let extraMessage = '';
    // Nếu là đơn kẹt gia đình thì tự động gỡ kẹt
    if (ticket.category === 'STUCK_HOUSEHOLD') {
      const result = await HouseholdMember.deleteMany({ userId: ticket.userId });
      extraMessage = ` và đã tự động gỡ người dùng khỏi ${result.deletedCount} gia đình`;
    }

    ticket.status = 'RESOLVED';
    ticket.resolvedAt = new Date();
    await ticket.save();

    // Tự động tạo thông báo gửi về cho User
    const categoryText = ticket.category === 'STUCK_HOUSEHOLD' ? 'Kẹt gia đình' 
                       : ticket.category === 'APP_BUG' ? 'Lỗi hệ thống' 
                       : 'Góp ý khác';
                       
    await Notification.create({
      userId: ticket.userId,
      title: 'Cập nhật yêu cầu hỗ trợ 🛠️',
      message: `Yêu cầu hỗ trợ của bạn (Phân loại: ${categoryText}) đã được Admin xử lý thành công. Cảm ơn bạn đã báo cáo!`,
      type: 'SUPPORT_UPDATE',
      priority: 'HIGH'
    });

    res.json({ success: true, message: 'Đã đánh dấu xử lý xong' + extraMessage, data: ticket });
  } catch (error: any) {
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
};
