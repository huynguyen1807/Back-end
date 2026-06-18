import mongoose from 'mongoose';

import { AdminAuditLog } from '../models/adminAuditLog.model';
import { AIGeneratedData } from '../models/aiGeneratedData.model';
import { AIPrediction } from '../models/aiPrediction.model';
import { FoodCategory } from '../models/foodCategory.model';
import { FoodItem } from '../models/foodItem.model';
import { Household } from '../models/household.model';
import { HouseholdInvitation } from '../models/householdInvitation.model';
import { HouseholdMember } from '../models/householdMember.model';
import { MealPlan } from '../models/mealPlan.model';
import { Notification } from '../models/notification.model';
import { NutritionFact } from '../models/nutritionFact.model';
import { NutritionReport } from '../models/nutritionReport.model';
import { PaymentTransaction } from '../models/paymentTransaction.model';
import { Recipe } from '../models/recipe.model';
import { ScanResult } from '../models/scanResult.model';
import { ShoppingList } from '../models/shoppingList.model';
import { StorageLocation } from '../models/storageLocation.model';
import { StorageRule } from '../models/storageRule.model';
import { Subscription } from '../models/subscription.model';
import { SubscriptionPlan } from '../models/subscriptionPlan.model';
import { User } from '../models/user.model';
import { UserPreference } from '../models/userPreference.model';
import { VideoRecipeSource } from '../models/videoRecipeSource.model';

const databaseModels = [
  User,
  UserPreference,
  Household,
  HouseholdMember,
  HouseholdInvitation,
  SubscriptionPlan,
  Subscription,
  PaymentTransaction,
  FoodCategory,
  StorageLocation,
  StorageRule,
  NutritionFact,
  FoodItem,
  ScanResult,
  AIPrediction,
  AIGeneratedData,
  Recipe,
  MealPlan,
  ShoppingList,
  Notification,
  VideoRecipeSource,
  NutritionReport,
  AdminAuditLog
];

const connectionStates: Record<number, string> = {
  0: 'disconnected',
  1: 'connected',
  2: 'connecting',
  3: 'disconnecting',
  99: 'uninitialized'
};

export function getDatabaseStatus() {
  const readyState = mongoose.connection.readyState;

  return {
    state: connectionStates[readyState] ?? 'unknown',
    host: mongoose.connection.host || null,
    name: mongoose.connection.name || null
  };
}

export async function connectDatabase() {
  const uri = process.env.MONGODB_URI;

  if (!uri) {
    throw new Error('MONGODB_URI is not configured');
  }

  mongoose.set('strictQuery', true);

  const connection = await mongoose.connect(uri, {
    dbName: process.env.MONGODB_DB_NAME ?? 'freshfriends',
    autoIndex: process.env.NODE_ENV !== 'production'
  });

  await Promise.all(databaseModels.map((model) => model.createIndexes()));

  console.log(
    `MongoDB Atlas connected: ${connection.connection.host}/${connection.connection.name}`
  );

  return connection;
}
