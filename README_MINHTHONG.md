SMART HOUSEHOLD FOOD MANAGEMENT SYSTEM
Coding Structure Guide – Short Version
Purpose: define folder structure, key files, modules, database collections, and team task division for coding.
1. Project Scope for Coding
•	Mobile app for household food inventory, expiration tracking, storage suggestion, meal planning, shopping list, Premium, Family Cloud, and nutrition report.
•	Suggested stack: React Native + Expo + TypeScript for mobile app; Node.js + Express + MongoDB Atlas for backend.
•	Architecture style: feature-based frontend structure and layered backend structure: routes → controllers → services → repositories/models.
•	Coding rule: each feature should have its own screens, API/service calls, types, and backend module when possible.
2. Root Repository Structure

shfms/
├── frontend/                  # React Native Expo app
├── backend/                   # Node.js Express API server
├── docs/                      # Report, diagrams, API notes, screenshots
├── database/                  # Seed data, MongoDB indexes, collection notes
├── .gitignore
├── README.md
└── package-notes.md           # Common commands and coding notes

3. Frontend Structure – React Native Expo

frontend/
├── App.tsx
├── package.json
├── app.json
├── tsconfig.json
└── src/
    ├── app/
    │   ├── navigation/
    │   │   ├── AppNavigator.tsx
    │   │   ├── AuthNavigator.tsx
    │   │   ├── MainNavigator.tsx
    │   │   └── navigationTypes.ts
    │   ├── providers/
    │   │   ├── AppProvider.tsx
    │   │   ├── AuthProvider.tsx
    │   │   └── ThemeProvider.tsx
    │   └── store/
    │       ├── index.ts
    │       ├── rootReducer.ts
    │       └── hooks.ts
    ├── assets/
    │   ├── images/
    │   ├── icons/
    │   └── animations/
    ├── components/
    │   ├── common/            # Button, Input, Loading, EmptyState, ModalConfirm
    │   ├── layout/            # ScreenContainer, Header, Card, BottomTabs
    │   └── form/              # FormInput, FormSelect, FormError
    ├── features/
    │   ├── auth/
    │   ├── home/
    │   ├── food/
    │   ├── scan/
    │   ├── storage/
    │   ├── meal/
    │   ├── shopping/
    │   ├── family/
    │   ├── premium/
    │   ├── notification/
    │   ├── nutrition/
    │   ├── admin/
    │   └── profile/
    ├── services/
    │   ├── apiClient.ts
    │   ├── endpoints.ts
    │   ├── storageService.ts
    │   └── notificationService.ts
    ├── hooks/
    │   ├── useDebounce.ts
    │   ├── useKeyboard.ts
    │   └── useNetworkStatus.ts
    ├── utils/
    │   ├── constants.ts
    │   ├── validators.ts
    │   ├── formatDate.ts
    │   └── helpers.ts
    ├── theme/
    │   ├── colors.ts
    │   ├── spacing.ts
    │   ├── typography.ts
    │   └── index.ts
    ├── types/
    │   ├── api.ts
    │   ├── user.ts
    │   ├── food.ts
    │   ├── meal.ts
    │   ├── shopping.ts
    │   └── common.ts
    └── config/
        ├── env.ts
        └── appConfig.ts

3.1 Standard Structure Inside Each Frontend Feature

features/<feature-name>/
├── screens/                   # Screen files
├── components/                # Feature-specific UI components
├── services/                  # API calls of this feature
├── store/                     # Redux slice or local state if needed
├── hooks/                     # Feature-specific hooks
└── types.ts                   # Feature-specific TypeScript types

Feature	Main screens	Main service/store files
auth	LoginScreen.tsx, RegisterScreen.tsx	authApi.ts, authSlice.ts, useAuth.ts
food	InventoryScreen.tsx, FoodDetailScreen.tsx, AddFoodScreen.tsx, UpdateFoodScreen.tsx	foodApi.ts, foodSlice.ts, food.types.ts
scan	ScanFoodScreen.tsx, ScanResultScreen.tsx	scanApi.ts
storage	StorageSuggestionScreen.tsx, StorageLocationScreen.tsx	storageApi.ts
meal	MealPlanScreen.tsx, MealDetailScreen.tsx, RecipeDetailScreen.tsx	mealApi.ts, recipeApi.ts
shopping	ShoppingListScreen.tsx, ShoppingListDetailScreen.tsx	shoppingApi.ts, shoppingSlice.ts
family	FamilyCloudScreen.tsx, InviteMemberScreen.tsx	familyApi.ts
premium	PremiumPlanScreen.tsx, PaymentResultScreen.tsx	paymentApi.ts, subscriptionApi.ts
nutrition	NutritionReportScreen.tsx	nutritionApi.ts
admin	AdminDashboardScreen.tsx, CategoryFormScreen.tsx, StorageRuleFormScreen.tsx	adminApi.ts
4. Backend Structure – Node.js Express + MongoDB Atlas

backend/
├── package.json
├── tsconfig.json or jsconfig.json
├── .env.example
└── src/
    ├── server.js              # App entry point
    ├── app.js                 # Express app config
    ├── config/
    │   ├── database.js
    │   └── env.js
    ├── middleware/
    │   ├── authMiddleware.js
    │   ├── roleMiddleware.js
    │   ├── errorMiddleware.js
    │   └── validateRequest.js
    ├── models/                # Mongoose schemas
    ├── routes/                # Route definitions
    ├── controllers/           # Request/response layer
    ├── services/              # Business logic layer
    ├── repositories/          # Database query layer
    ├── jobs/                  # Cron jobs/background tasks
    ├── utils/                 # Helpers, date, token, response handler
    └── constants/             # Enums and business constants

4.1 Backend Files by Module
Module	Models	Services	Controllers	Routes
auth	User.js	authService.js	authController.js	authRoutes.js
users	UserPreference.js	userService.js	userController.js	userRoutes.js
households	Household.js, HouseholdMember.js	householdService.js	householdController.js	householdRoutes.js
foods	FoodItem.js, FoodCategory.js	foodService.js	foodController.js	foodRoutes.js
scan	ScanResult.js	scanService.js	scanController.js	scanRoutes.js
ai	AIPrediction.js, AIGeneratedData.js	aiService.js	aiController.js	aiRoutes.js
storage	StorageLocation.js, StorageRule.js	storageService.js	storageController.js	storageRoutes.js
meals	MealPlan.js, Recipe.js	mealService.js	mealController.js	mealRoutes.js
shopping	ShoppingList.js	shoppingService.js	shoppingController.js	shoppingRoutes.js
notifications	Notification.js	notificationService.js	notificationController.js	notificationRoutes.js
premium/payment	SubscriptionPlan.js, Subscription.js, PaymentTransaction.js	paymentService.js, subscriptionService.js	paymentController.js, subscriptionController.js	subscriptionRoutes.js, paymentRoutes.js
admin	AdminAuditLog.js	adminService.js	adminController.js	adminRoutes.js
5. Required MongoDB Collections
Collection	Purpose
users	Accounts for users and administrators
user_preferences	Diet goals, allergies, disliked foods, calorie target
households	Family Cloud workspace
household_members	Family members and permissions
household_invitations	Invitation links/tokens for family members
subscription_plans	Free/Premium plan definitions and limits
subscriptions	Current subscription status of users
payment_transactions	Payment records from gateway
food_categories	Food category master data
storage_locations	User/household storage locations
storage_rules	Storage rules by food category and storage type
nutrition_facts	Calories and macro data
food_items	Central inventory collection
scan_results	Barcode/OCR scan results
ai_predictions	AI expiry prediction results
ai_generated_data	AI-generated data waiting for admin review
recipes	Recipe data with embedded ingredients
meal_plans	Daily meal plans with embedded meals
shopping_lists	Shopping lists with embedded items
notifications	Alert and notification history
video_recipe_sources	Recipe extraction from video links
nutrition_reports	Weekly/monthly macro reports for Premium users
admin_audit_logs	Admin update history
6. Minimum API List for Coding
Area	APIs
Auth	POST /api/auth/register; 
POST /api/auth/login; 
GET /api/auth/me
Food Inventory	GET /api/foods; 
POST /api/foods; 
GET /api/foods/:id; 
PUT /api/foods/:id; 
DELETE /api/foods/:id
Scan & AI	POST /api/scan/supermarket; 
POST /api/ai/predict-expiry
Storage	GET /api/storage-locations; 
POST /api/storage-locations; 
GET /api/storage/suggestion
Meal & Recipe	GET /api/recipes; 
POST /api/meal-plans/generate; 
GET /api/meal-plans
Shopping	GET /api/shopping-lists; 
POST /api/shopping-lists; 
POST /api/shopping-lists/:id/items; 
PATCH /api/shopping-lists/:id/items/:itemId/purchased
Family Cloud	POST /api/households; 
POST /api/households/:id/invite; 
GET /api/households/:id/members
Premium & Payment	GET /api/subscription-plans; 
POST /api/payments/create; 
POST /api/payments/callback; 
GET /api/subscriptions/current
Nutrition	GET /api/nutrition/reports; 
POST /api/nutrition/reports/generate
Admin	POST/PUT /api/admin/categories; 
POST/PUT /api/admin/storage-rules; 
POST/PUT /api/admin/nutrition;
 POST/PUT /api/admin/recipes; 
PATCH /api/admin/ai-generated/:id/review
7. Suggested Task Division for 6 Members
Member	Main responsibility	Main tasks
Member 1	Auth + User Profile + Subscription	Login/Register UI, auth API, JWT, user profile, user preferences, subscription status, Free/Premium access control.
Member 2	Food Inventory + Storage	Food CRUD, food categories, storage locations, food status, storage suggestion, inventory limit validation.
Member 3	Scan + AI Expiry + Notification	Barcode/OCR scan, AI expiry prediction, scan results, expiry cron job, push notification/history.
Member 4	Meal + Recipe + Nutrition + Admin Recipe Data	Recipe CRUD, meal plan, calorie calculation, macro report, admin nutrition data, admin recipe data.
Member 5	Shopping List + Family Cloud + Payment	UC-16 to UC-20, shopping list, purchased item flow, shared shopping list, household members, permissions, payment transaction.
8. Recommended Implementation Order
•	Step 1: Set up backend connection to MongoDB Atlas, auth middleware, common response handler, and error middleware.
•	Step 2: Implement users, user_preferences, food_categories, storage_locations, storage_rules seed data.
•	Step 3: Implement Food Inventory CRUD and basic expiration status calculation.
•	Step 4: Implement shopping list CRUD and mark item as purchased.
•	Step 5: Implement scan, AI prediction mock service, and notification history.
•	Step 6: Implement meal plan, recipe, calorie, and macro calculation.
•	Step 7: Implement Premium, subscription plan validation, Family Cloud, and payment sandbox.
•	Step 8: Implement admin screens and APIs for category, storage rule, nutrition fact, recipe, and AI-generated data review.
9. Git Branch and Naming Rules
•	Main branches: main, develop.
•	Feature branch format: feature/<member-name>-<module>, for example feature/my-shopping-list.
•	Commit format: feat(shopping): add item to shopping list API.
•	Do not commit .env, node_modules, build folders, or generated cache files.
•	Before merging, each member should test related API and screen flow.
10. MVP Checklist
Priority	Features
Must Have	Register/Login, Food Inventory CRUD, Expiration Status, Shopping List CRUD, Basic Storage Suggestion
Should Have	Scan supermarket food, AI expiry prediction mock, Meal plan generation, Basic calorie calculation
Could Have	Family Cloud, Premium payment sandbox, Macro report, Video recipe extraction, Admin review AI data
End of document
