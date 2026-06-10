export { AdminAuditLog } from './adminAuditLog.model';
export { AIPrediction } from './aiPrediction.model';
export { FoodCategory } from './foodCategory.model';
export { FoodItem } from './foodItem.model';
export { MealPlan } from './mealPlan.model';
export { Notification } from './notification.model';
export { NutritionFact } from './nutritionFact.model';
export { Recipe } from './recipe.model';
export { ScanResult } from './scanResult.model';
export { ShoppingList } from './shoppingList.model';
export { StorageLocation } from './storageLocation.model';
export { StorageRule } from './storageRule.model';
export { User } from './user.model';
export { UserPreference } from './userPreference.model';
export { VideoRecipeSource } from './videoRecipeSource.model';

import { AdminAuditLog } from './adminAuditLog.model';
import { AIPrediction } from './aiPrediction.model';
import { FoodCategory } from './foodCategory.model';
import { FoodItem } from './foodItem.model';
import { MealPlan } from './mealPlan.model';
import { Notification } from './notification.model';
import { NutritionFact } from './nutritionFact.model';
import { Recipe } from './recipe.model';
import { ScanResult } from './scanResult.model';
import { ShoppingList } from './shoppingList.model';
import { StorageLocation } from './storageLocation.model';
import { StorageRule } from './storageRule.model';
import { User } from './user.model';
import { UserPreference } from './userPreference.model';
import { VideoRecipeSource } from './videoRecipeSource.model';

export const databaseModels = [
  User,
  UserPreference,
  FoodCategory,
  StorageLocation,
  StorageRule,
  NutritionFact,
  FoodItem,
  ScanResult,
  AIPrediction,
  Recipe,
  MealPlan,
  ShoppingList,
  Notification,
  VideoRecipeSource,
  AdminAuditLog
];
