import { Router, Request, Response } from 'express';
import multer from 'multer';
import { Readable } from 'stream';
import cloudinary from '../config/cloudinary';
import { protect } from '../middleware/authMiddleware';

const router = Router();

// Configure multer to handle buffer uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  },
});

// POST /api/upload/image - Upload single image to Cloudinary
router.post('/image', protect, upload.single('image'), async (req: Request, res: Response) => {
  try {
    console.log('[Upload] Request headers:', req.headers['content-type']);
    console.log('[Upload] File info:', req.file ? {
      originalname: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size,
    } : 'No file');
    console.log('[Upload] Cloudinary config:', {
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      has_api_key: !!process.env.CLOUDINARY_API_KEY,
      has_api_secret: !!process.env.CLOUDINARY_API_SECRET,
    });

    if (!req.file) {
      res.status(400).json({ message: 'No image file provided' });
      return;
    }

    console.log('[Cloudinary] Uploading image, size:', req.file.size, 'bytes');

    // Upload to Cloudinary using buffer
    const result = await new Promise<any>((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder: 'freshfriends',
          resource_type: 'auto',
        },
        (error, result) => {
          if (error) {
            console.error('[Cloudinary] Upload error:', JSON.stringify(error, null, 2));
            reject(error);
          } else {
            console.log('[Cloudinary] Upload success:', result?.secure_url);
            resolve(result);
          }
        }
      );

      const readable = new Readable();
      readable.push(req.file!.buffer);
      readable.push(null);
      readable.pipe(uploadStream);
    });

    res.status(200).json({
      message: 'Image uploaded successfully',
      data: {
        url: result.secure_url,
        publicId: result.public_id,
        format: result.format,
        width: result.width,
        height: result.height,
        bytes: result.bytes,
      },
    });
  } catch (error: any) {
    console.error('[Cloudinary upload error]', error);
    res.status(500).json({ message: error.message || 'Failed to upload image' });
  }
});

export default router;
