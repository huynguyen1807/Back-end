import mongoose, { Model, Schema } from 'mongoose';

export const objectId = Schema.Types.ObjectId;

export const timestamps = {
  timestamps: true,
  versionKey: false
} as const;

export function existingModel(name: string, schema: Schema, collection: string): Model<any> {
  return (mongoose.models[name] as Model<any> | undefined) ?? mongoose.model(name, schema, collection);
}
