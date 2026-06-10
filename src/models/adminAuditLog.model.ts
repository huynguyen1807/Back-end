import { Schema } from 'mongoose';

import { existingModel, objectId } from './modelHelpers';

const adminAuditLogSchema = new Schema(
  {
    adminId: { type: objectId, ref: 'User', required: true, index: true },
    action: { type: String, required: true },
    targetCollection: { type: String, required: true },
    targetId: { type: objectId },
    oldValue: Schema.Types.Mixed,
    newValue: Schema.Types.Mixed
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false }
);

export const AdminAuditLog = existingModel(
  'AdminAuditLog',
  adminAuditLogSchema,
  'admin_audit_logs'
);
