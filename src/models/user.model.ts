import { Schema } from 'mongoose';

import { existingModel, timestamps } from './modelHelpers';

const userSchema = new Schema(
  {
    fullName: { type: String, required: true, trim: true },
    email: { type: String, required: true, trim: true, lowercase: true, unique: true },
    passwordHash: { type: String, required: true },
    avatarUrl: String,
    role: { type: String, enum: ['USER', 'ADMIN'], default: 'USER' },
    status: { type: String, enum: ['ACTIVE', 'INACTIVE'], default: 'ACTIVE' }
  },
  timestamps
);

export const User = existingModel('User', userSchema, 'users');
