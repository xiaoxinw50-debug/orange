require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');

const app = express();
const PORT = process.env.PORT || 3000;
const ALLOWED_CATEGORIES = new Set(['memory', 'album', 'diary', 'wish', 'story']);
const ALLOWED_AUTHORS = new Set(['小心', '小橙']);

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// ================= 1. 连接 MongoDB =================
if (process.env.MONGO_URI) {
    mongoose.connect(process.env.MONGO_URI)
        .then(() => console.log('MongoDB 云数据库连接成功！'))
        .catch(err => console.error('MongoDB 连接失败:', err));
} else {
    console.warn('MONGO_URI 未配置，数据接口将不可用。');
}

const itemSchema = new mongoose.Schema({
    category: { type: String, required: true, enum: Array.from(ALLOWED_CATEGORIES) },
    author: { type: String, required: true },
    url: String,
    public_id: String,
    images: [{
        url: { type: String, required: true },
        public_id: { type: String, required: true }
    }],
    title: { type: String, default: '' },
    note: { type: String, default: '' },
    segments: { type: Array, default: null },
    date: { type: String, required: true },
    time: { type: Number, required: true },
    completed: { type: Boolean, default: false }
});
const Item = mongoose.model('Item', itemSchema);

// ================= 2. 配置 Cloudinary =================
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

const storage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: {
        folder: 'orange_memories',
        allowed_formats: ['jpg', 'png', 'jpeg', 'gif', 'webp']
    }
});
const upload = multer({
    storage: storage,
    limits: {
        fileSize: 10 * 1024 * 1024
    }
});

function createHttpError(status, message) {
    const error = new Error(message);
    error.status = status;
    return error;
}

function handleError(res, err) {
    const status = err.status || (err instanceof multer.MulterError ? 400 : 500);
    const message = err instanceof multer.MulterError
        ? `上传失败: ${err.message}`
        : err.message || '服务器内部错误';
    if (status >= 500) {
        console.error(err);
    }
    res.status(status).json({ error: message });
}

function normalizeCategory(category) {
    const normalized = category || 'memory';
    if (!ALLOWED_CATEGORIES.has(normalized)) {
        throw createHttpError(400, '不支持的内容分类');
    }
    return normalized;
}

function normalizeAuthor(author) {
    if (!author || !ALLOWED_AUTHORS.has(author)) {
        throw createHttpError(400, '作者信息无效，请重新登录后再试');
    }
    return author;
}

function normalizeDate(date) {
    if (!date) {
        const now = new Date();
        const offset = now.getTimezoneOffset() * 60000;
        return new Date(now.getTime() - offset).toISOString().split('T')[0];
    }
    const normalized = new Date(date);
    if (Number.isNaN(normalized.getTime())) {
        throw createHttpError(400, '日期格式无效');
    }
    return date;
}

function parseSegments(rawSegments) {
    if (!rawSegments) return null;

    let parsed;
    try {
        parsed = typeof rawSegments === 'string' ? JSON.parse(rawSegments) : rawSegments;
    } catch (err) {
        throw createHttpError(400, '故事内容格式无效');
    }

    if (!Array.isArray(parsed)) {
        throw createHttpError(400, '故事内容必须是数组');
    }

    const sanitized = parsed
        .map((segment, index) => ({
            id: String(segment.id || Date.now() + index),
            author: normalizeAuthor(segment.author),
            text: typeof segment.text === 'string' ? segment.text.trim() : ''
        }))
        .filter(segment => segment.text);

    return sanitized.length > 0 ? sanitized : null;
}

function extractImages(files = []) {
    return files.map(file => ({
        url: file.path,
        public_id: file.filename
    }));
}

function ensureObjectId(id, message) {
    if (!mongoose.isValidObjectId(id)) {
        throw createHttpError(400, message);
    }
}

function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ================= 3. API 路由 =================

// API: 新增内容 (创建相册/纪事等)
app.post('/api/items', upload.array('files', 50), async (req, res) => {
    try {
        const category = normalizeCategory(req.body.category);
        const author = normalizeAuthor(req.body.author);
        const displayDate = normalizeDate(req.body.date);
        const timestamp = new Date(displayDate).getTime();
        const segments = category === 'story' ? parseSegments(req.body.segments) : null;
        const uploadedImages = extractImages(req.files);

        if (category === 'story' && !segments) {
            throw createHttpError(400, '浮梦内容不能为空');
        }

        if (category === 'album' && uploadedImages.length === 0) {
            throw createHttpError(400, '相册至少需要一张照片');
        }

        const newItem = new Item({
            category,
            author: author,
            images: uploadedImages,
            title: typeof req.body.title === 'string' ? req.body.title.trim() : '',
            note: typeof req.body.note === 'string' ? req.body.note.trim() : '',
            segments,
            date: displayDate,
            time: timestamp,
            completed: false,
            url: uploadedImages[0]?.url,
            public_id: uploadedImages[0]?.public_id
        });

        const savedItem = await newItem.save();
        res.json(savedItem);
    } catch (err) {
        handleError(res, err);
    }
});

// API: 往已有相册中追加照片 (核心新功能)
app.post('/api/items/:id/images', upload.array('files', 50), async (req, res) => {
    try {
        ensureObjectId(req.params.id, '相册 ID 无效');
        const item = await Item.findById(req.params.id);
        if (!item) return res.status(404).json({ error: '相册未找到' });
        if (item.category !== 'album') {
            throw createHttpError(400, '只有相册可以追加照片');
        }
        if (!req.files || req.files.length === 0) {
            throw createHttpError(400, '请先选择要上传的照片');
        }

        const newImages = extractImages(req.files);
        item.images.push(...newImages);
        item.url = item.images[0]?.url;
        item.public_id = item.images[0]?.public_id;
        await item.save();
        res.json(item);
    } catch (err) {
        handleError(res, err);
    }
});

// API: 删除相册中的某一张照片
app.delete('/api/items/:id/images/:imageId', async (req, res) => {
    try {
        ensureObjectId(req.params.id, '相册 ID 无效');
        ensureObjectId(req.params.imageId, '图片 ID 无效');
        const item = await Item.findById(req.params.id);
        if (!item) return res.status(404).json({ error: '相册未找到' });
        if (item.category !== 'album') {
            throw createHttpError(400, '只有相册可以删除照片');
        }

        const imageIndex = item.images.findIndex(img => img._id.toString() === req.params.imageId);
        if (imageIndex === -1) {
            throw createHttpError(404, '照片未找到');
        }
        const img = item.images[imageIndex];
        await cloudinary.uploader.destroy(img.public_id);
        item.images.splice(imageIndex, 1);
        item.url = item.images[0]?.url || '';
        item.public_id = item.images[0]?.public_id || '';
        await item.save();
        res.json(item);
    } catch (err) {
        handleError(res, err);
    }
});

// API: 获取内容
app.get('/api/items', async (req, res) => {
    try {
        const { q, category } = req.query;
        let query = {};
        if (category) {
            query.category = normalizeCategory(category);
        }
        if (q) {
            const safeKeyword = escapeRegExp(q.trim());
            query.$or = [
                { note: new RegExp(safeKeyword, 'i') },
                { title: new RegExp(safeKeyword, 'i') }
            ];
        }

        const items = await Item.find(query).sort({ time: -1 }).lean();
        res.json(items);
    } catch (err) {
        handleError(res, err);
    }
});

app.get('/api/random', async (req, res) => {
    try {
        const now = Date.now();
        const randomItems = await Item.aggregate([
            { $match: { category: 'memory', time: { $lte: now } } },
            { $sample: { size: 1 } }
        ]);
        res.json(randomItems.length > 0 ? randomItems[0] : null);
    } catch (err) {
        handleError(res, err);
    }
});

app.put('/api/items/:id', async (req, res) => {
    try {
        ensureObjectId(req.params.id, '内容 ID 无效');
        const { title, note, completed, segments } = req.body;
        let updateDoc = {};
        if (title !== undefined) updateDoc.title = title;
        if (note !== undefined) updateDoc.note = note;
        if (completed !== undefined) updateDoc.completed = completed;
        if (segments !== undefined) updateDoc.segments = parseSegments(segments);

        const updatedItem = await Item.findByIdAndUpdate(req.params.id, { $set: updateDoc }, { new: true });
        if (!updatedItem) {
            throw createHttpError(404, '内容未找到');
        }
        res.json({ success: true });
    } catch (err) {
        handleError(res, err);
    }
});

app.delete('/api/items/:id', async (req, res) => {
    try {
        ensureObjectId(req.params.id, '内容 ID 无效');
        const item = await Item.findById(req.params.id);
        if (item) {
            if (item.images && item.images.length > 0) {
                await Promise.all(item.images.map(img => cloudinary.uploader.destroy(img.public_id)));
            } else if (item.public_id) {
                await cloudinary.uploader.destroy(item.public_id);
            }
            await Item.findByIdAndDelete(req.params.id);
        }
        res.json({ success: true });
    } catch (err) {
        handleError(res, err);
    }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
