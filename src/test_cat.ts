import 'dotenv/config';
import mongoose from 'mongoose';
import { FoodCategory } from './models/foodCategory.model';

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is not configured');

  await mongoose.connect(uri, {
    dbName: process.env.MONGODB_DB_NAME ?? 'freshfriends',
  });

  const CATEGORY_SELECT = 'categoryName displayName description aliases keywords foodExamples sortOrder';
  const categories = await FoodCategory.find({ isActive: true }).select(CATEGORY_SELECT).sort({ sortOrder: 1, categoryName: 1 });
  
  console.log("Found categories:", categories.length);
  if (categories.length > 0) {
    console.log("First category:", categories[0].categoryName);
  }

  await mongoose.disconnect();
}

main().catch(console.error);
