import 'dotenv/config';

import mongoose from 'mongoose';

import { FoodCategory } from '../models/foodCategory.model';
import { normalizeFoodText } from '../utils/foodCategoryValidation';

type CategorySeed = {
  categoryName: string;
  displayName: string;
  description: string;
  aliases: string[];
  keywords: string[];
  foodExamples: string[];
  sortOrder: number;
};

const CATEGORY_SEEDS: CategorySeed[] = [
  {
    categoryName: 'Meat',
    displayName: 'Thịt',
    description: 'Thịt đỏ, thịt gia cầm và các nguyên liệu sống cần chế biến kỹ.',
    aliases: ['meat', 'thit', 'thit do', 'gia cam'],
    keywords: ['thit', 'bo', 'ga', 'heo', 'lon', 'vit', 'de', 'cuu', 'beef', 'chicken', 'pork'],
    foodExamples: ['Thịt bò', 'Thịt gà', 'Thịt heo', 'Ức gà', 'Ba chỉ heo', 'Sườn non'],
    sortOrder: 10,
  },
  {
    categoryName: 'Seafood',
    displayName: 'Hải sản',
    description: 'Hải sản như tôm, cua, mực, nghêu, sò và các nguyên liệu biển.',
    aliases: ['seafood', 'hai san', 'tom cua', 'do bien'],
    keywords: ['hai san', 'tom', 'cua', 'muc', 'ngheu', 'ngao', 'so', 'oc', 'shrimp', 'crab', 'squid'],
    foodExamples: ['Tôm', 'Cua', 'Mực', 'Nghêu', 'Sò', 'Ốc'],
    sortOrder: 20,
  },
  {
    categoryName: 'Fish',
    displayName: 'Cá',
    description: 'Các loại cá tươi, cá đông lạnh hoặc cá phi lê.',
    aliases: ['fish', 'ca'],
    keywords: ['ca', 'fish', 'salmon', 'tuna'],
    foodExamples: ['Cá hồi', 'Cá thu', 'Cá basa', 'Cá ngừ', 'Cá lóc', 'Cá rô'],
    sortOrder: 21,
  },
  {
    categoryName: 'Vegetable',
    displayName: 'Rau củ',
    description: 'Rau xanh, củ quả và nấm dùng cho nấu ăn.',
    aliases: ['vegetable', 'vegetables', 'rau', 'rau cu', 'cu qua'],
    keywords: ['rau', 'cai', 'cu', 'nam', 'dua leo', 'dua chuot', 'bi do', 'bi xanh', 'bau', 'muop', 'kho qua', 'hanh tay', 'carrot', 'tomato', 'cucumber', 'vegetable'],
    foodExamples: ['Rau cải', 'Cà rốt', 'Cà chua', 'Dưa leo', 'Dưa chuột', 'Nấm', 'Bắp cải', 'Súp lơ', 'Bí đỏ', 'Bầu', 'Mướp', 'Khổ qua', 'Hành tây'],
    sortOrder: 30,
  },
  {
    categoryName: 'Fruit',
    displayName: 'Trái cây',
    description: 'Trái cây tươi, có thể ăn trực tiếp hoặc dùng cho món tráng miệng.',
    aliases: ['fruit', 'fruits', 'trai cay', 'hoa qua'],
    keywords: ['tao', 'chuoi', 'cam', 'quyt', 'buoi', 'chanh', 'xoai', 'nho', 'le', 'oi', 'dua hau', 'dua luoi', 'mit', 'dua thom', 'thom', 'khom', 'nhan', 'nhan long', 'vai', 'chom chom', 'mang cut', 'mang cau', 'na', 'sau rieng', 'thanh long', 'hong xiem', 'sapoche', 'luu', 'fruit'],
    foodExamples: ['Táo đỏ', 'Chuối', 'Cam', 'Quýt', 'Bưởi', 'Chanh', 'Xoài', 'Nho', 'Lê', 'Ổi', 'Dưa hấu', 'Dưa lưới', 'Mít', 'Dứa thơm', 'Thơm', 'Khóm', 'Nhãn lồng', 'Vải', 'Chôm chôm', 'Măng cụt', 'Mãng cầu', 'Na', 'Sầu riêng', 'Thanh long', 'Hồng xiêm', 'Sapoche', 'Lựu'],
    sortOrder: 40,
  },
  {
    categoryName: 'Egg',
    displayName: 'Trứng',
    description: 'Trứng gia cầm và sản phẩm từ trứng.',
    aliases: ['egg', 'eggs', 'trung'],
    keywords: ['trung', 'egg'],
    foodExamples: ['Trứng gà', 'Trứng vịt', 'Trứng cút'],
    sortOrder: 50,
  },
  {
    categoryName: 'Dairy',
    displayName: 'Sữa và chế phẩm',
    description: 'Sữa, sữa chua, phô mai và các chế phẩm từ sữa.',
    aliases: ['dairy', 'milk', 'sua', 'che pham sua'],
    keywords: ['sua', 'sua chua', 'yogurt', 'yaourt', 'pho mai', 'phomai', 'cheese', 'milk'],
    foodExamples: ['Sữa tươi', 'Sữa chua', 'Phô mai', 'Bơ lạt'],
    sortOrder: 60,
  },
  {
    categoryName: 'Dry Food',
    displayName: 'Đồ khô / ngũ cốc',
    description: 'Gạo, mì, bún khô, ngũ cốc, đậu hạt và thực phẩm khô.',
    aliases: ['dry food', 'grain', 'grains', 'starch', 'do kho', 'ngu coc', 'tinh bot'],
    keywords: ['gao', 'mi', 'my', 'bun', 'pho', 'yen mach', 'ngu coc', 'dau', 'hat', 'khoai', 'pasta'],
    foodExamples: ['Gạo', 'Mì', 'Bún khô', 'Yến mạch', 'Ngũ cốc', 'Đậu xanh', 'Khoai tây'],
    sortOrder: 70,
  },
  {
    categoryName: 'Cooked Food',
    displayName: 'Đồ ăn chín',
    description: 'Món đã nấu, thức ăn sẵn hoặc đồ ăn có thể dùng trực tiếp.',
    aliases: ['cooked food', 'prepared food', 'ready to eat', 'do an chin', 'thuc an chin', 'an lien'],
    keywords: ['com hop', 'do an chin', 'thuc an chin', 'mon an', 'canh', 'sup', 'chao', 'salad', 'sandwich', 'cooked'],
    foodExamples: ['Cơm hộp', 'Canh rau', 'Cháo gà', 'Salad', 'Sandwich', 'Đồ ăn thừa'],
    sortOrder: 80,
  },
  {
    categoryName: 'Frozen Food',
    displayName: 'Đông lạnh',
    description: 'Thực phẩm bảo quản đông lạnh hoặc sản phẩm chế biến đông lạnh.',
    aliases: ['frozen food', 'frozen', 'dong lanh', 'do dong lanh'],
    keywords: ['dong lanh', 'frozen', 'vien', 'cha ca', 'xuc xich', 'dumpling'],
    foodExamples: ['Cá viên đông lạnh', 'Chả cá', 'Xúc xích đông lạnh', 'Há cảo đông lạnh'],
    sortOrder: 90,
  },
];

function equivalentCategory(category: any, seed: CategorySeed) {
  const seedKeys = [seed.categoryName, seed.displayName, ...seed.aliases].map(normalizeFoodText);
  return seedKeys.includes(normalizeFoodText(category.categoryName)) ||
    seedKeys.includes(normalizeFoodText(category.displayName));
}

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is not configured');

  await mongoose.connect(uri, {
    dbName: process.env.MONGODB_DB_NAME ?? 'freshfriends',
    autoIndex: false,
  });

  const existing = await FoodCategory.find({}).select('categoryName displayName').lean();
  const updates: Array<{ categoryName: string; action: 'created' | 'updated' }> = [];

  for (const seed of CATEGORY_SEEDS) {
    const matched = existing.find((category) => equivalentCategory(category, seed));
    const payload = {
      displayName: seed.displayName,
      description: seed.description,
      aliases: seed.aliases,
      keywords: seed.keywords,
      foodExamples: seed.foodExamples,
      sortOrder: seed.sortOrder,
      isActive: true,
    };

    if (matched?._id) {
      await FoodCategory.updateOne({ _id: matched._id }, { $set: payload });
      updates.push({ categoryName: seed.categoryName, action: 'updated' });
    } else {
      await FoodCategory.create({ categoryName: seed.categoryName, ...payload });
      updates.push({ categoryName: seed.categoryName, action: 'created' });
    }
  }

  console.log(JSON.stringify({ ok: true, updated: updates }, null, 2));
  await mongoose.disconnect();
}

void main().catch(async (error) => {
  console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
  try {
    await mongoose.disconnect();
  } catch (_) {
    // no-op
  }
  process.exit(1);
});
