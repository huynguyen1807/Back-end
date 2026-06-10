import { Schema } from 'mongoose';

import { existingModel } from './modelHelpers';

const storageLocationSchema = new Schema(
  {
    locationName: {
      type: String,
      enum: ['REFRIGERATOR', 'OUTSIDE', 'FREEZER'],
      required: true,
      unique: true
    },
    displayName: { type: String, required: true },
    description: String
  },
  { versionKey: false }
);

export const StorageLocation = existingModel(
  'StorageLocation',
  storageLocationSchema,
  'storage_locations'
);
