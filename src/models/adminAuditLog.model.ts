import { Schema } from 'mongoose';

import { existingModel, objectId } from './modelHelpers';

const adminAuditLogSchema = new Schema(
  {
    adminId: { type: objectId, ref: 'User', required: true },
    action: { type: String, required: true },
    targetCollection: { type: String, required: true },
    targetId: { type: objectId },
    oldValue: Schema.Types.Mixed,
    newValue: Schema.Types.Mixed
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false }
);

adminAuditLogSchema.index({ adminId: 1, createdAt: -1 });
adminAuditLogSchema.index({ targetCollection: 1, targetId: 1 });

export const AdminAuditLog = existingModel(
  'AdminAuditLog',
  adminAuditLogSchema,
  'admin_audit_logs'
);
