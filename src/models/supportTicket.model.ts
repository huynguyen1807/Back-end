import { Schema } from 'mongoose';
import { existingModel, objectId, timestamps } from './modelHelpers';

const supportTicketSchema = new Schema(
  {
    userId: { type: objectId, ref: 'User', required: true },
    category: {
      type: String,
      enum: ['STUCK_HOUSEHOLD', 'APP_BUG', 'OTHER'],
      default: 'OTHER'
    },
    content: { type: String, required: true },
    status: {
      type: String,
      enum: ['PENDING', 'RESOLVED'],
      default: 'PENDING'
    },
    resolvedAt: { type: Date }
  },
  timestamps
);

export const SupportTicket = existingModel(
  'SupportTicket',
  supportTicketSchema,
  'support_tickets'
);
