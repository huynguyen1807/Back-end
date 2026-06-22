import { Router } from 'express';
import { protect } from '../middleware/authMiddleware';
import {
  listFoods,
  getFood,
  createFood,
  updateFood,
  deleteFood,
  consumeFood,
  listCategories,
  foodSummary,
} from '../controllers/foodController';

const router = Router();

// Tất cả routes yêu cầu đăng nhập
router.use(protect);

router.get('/summary', foodSummary);          // GET /api/foods/summary
router.get('/categories', listCategories);    // GET /api/foods/categories
router.get('/', listFoods);                   // GET /api/foods?filter=NEAR_EXPIRY
router.get('/:id', getFood);                  // GET /api/foods/:id
router.post('/', createFood);                 // POST /api/foods
router.put('/:id', updateFood);               // PUT /api/foods/:id
router.delete('/:id', deleteFood);            // DELETE /api/foods/:id
router.patch('/:id/consume', consumeFood);    // PATCH /api/foods/:id/consume

export default router;
