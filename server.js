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
const ALLOWED_MOODS = new Set(['', 'spark', 'hug', 'sweet', 'chaos', 'dream', 'brave', 'calm']);

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
    mood: { type: String, default: '' },
    date: { type: String, required: true },
    time: { type: Number, required: true },
    completed: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
    deletedBy: { type: String, default: '' }
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

function normalizeOptionalAuthor(author) {
    if (!author) return null;
    return normalizeAuthor(author);
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

function normalizeMood(mood) {
    const normalized = typeof mood === 'string' ? mood.trim() : '';
    if (!ALLOWED_MOODS.has(normalized)) {
        throw createHttpError(400, '心情贴纸无效');
    }
    return normalized;
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

function parseBooleanFlag(value) {
    if (value === undefined) return false;
    return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function parseDateBoundary(value, boundary) {
    if (!value) return null;
    const normalized = normalizeDate(value);
    const date = new Date(normalized);
    if (boundary === 'end') {
        date.setUTCHours(23, 59, 59, 999);
    } else {
        date.setUTCHours(0, 0, 0, 0);
    }
    return date.getTime();
}

function ensureActiveItem(item, message = '内容已在回收站中，请先恢复') {
    if (item.deletedAt) {
        throw createHttpError(410, message);
    }
}

function buildItemsQuery(queryParams) {
    const query = {};
    const includeDeleted = parseBooleanFlag(queryParams.includeDeleted);
    const deletedOnly = parseBooleanFlag(queryParams.deletedOnly);
    const author = normalizeOptionalAuthor(queryParams.author);
    const mood = queryParams.mood !== undefined ? normalizeMood(queryParams.mood) : null;
    const from = parseDateBoundary(queryParams.from, 'start');
    const to = parseDateBoundary(queryParams.to, 'end');
    const keyword = typeof queryParams.q === 'string' ? queryParams.q.trim() : '';

    if (queryParams.category) {
        query.category = normalizeCategory(queryParams.category);
    }
    if (author) {
        query.author = author;
    }
    if (mood) {
        query.mood = mood;
    }
    if (deletedOnly) {
        query.deletedAt = { $ne: null };
    } else if (!includeDeleted) {
        query.deletedAt = null;
    }
    if (from !== null || to !== null) {
        query.time = {};
        if (from !== null) query.time.$gte = from;
        if (to !== null) query.time.$lte = to;
    }
    if (keyword) {
        const safeKeyword = escapeRegExp(keyword);
        query.$or = [
            { note: new RegExp(safeKeyword, 'i') },
            { title: new RegExp(safeKeyword, 'i') },
            { 'segments.text': new RegExp(safeKeyword, 'i') }
        ];
    }

    return query;
}

function toCardItem(item) {
    return {
        _id: item._id,
        category: item.category,
        author: item.author,
        title: item.title,
        note: item.note,
        segments: item.segments || [],
        mood: item.mood || '',
        date: item.date,
        time: item.time,
        completed: item.completed,
        images: item.images || [],
        url: item.images?.[0]?.url || item.url || '',
        deletedAt: item.deletedAt || null
    };
}

async function destroyItemAssets(item) {
    if (item.images && item.images.length > 0) {
        await Promise.all(item.images.map(img => cloudinary.uploader.destroy(img.public_id)));
    } else if (item.public_id) {
        await cloudinary.uploader.destroy(item.public_id);
    }
}

// ================= 3. API 路由 =================

// API: 新增内容 (创建相册/纪事等)
app.post('/api/items', upload.array('files', 50), async (req, res) => {
    try {
        const category = normalizeCategory(req.body.category);
        const author = normalizeAuthor(req.body.author);
        const mood = normalizeMood(req.body.mood);
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
            mood,
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
        ensureActiveItem(item, '相册已在回收站中，无法继续追加照片');
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
        ensureActiveItem(item, '相册已在回收站中，无法删除照片');
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
        const query = buildItemsQuery(req.query);
        const sort = parseBooleanFlag(req.query.deletedOnly) ? { deletedAt: -1 } : { time: -1 };
        const items = await Item.find(query).sort(sort).lean();
        res.json(items);
    } catch (err) {
        handleError(res, err);
    }
});

app.get('/api/review/anniversary', async (req, res) => {
    try {
        const today = normalizeDate(req.query.date);
        const baseDate = req.query.baseDate ? normalizeDate(req.query.baseDate) : null;
        const md = today.slice(5);
        const year = Number(today.slice(0, 4));
        const items = await Item.find({ deletedAt: null }).sort({ time: -1 }).lean();
        const sameDayHistory = items.filter(item => item.date && item.date.slice(5) === md && item.date < today);
        const lastYearItems = sameDayHistory.filter(item => item.date.startsWith(`${year - 1}-`));
        const latestMemory = items[0] || null;
        const earliestMemory = items[items.length - 1] || null;

        let relationship = null;
        if (baseDate) {
            const diff = Math.floor((new Date(today).getTime() - new Date(baseDate).getTime()) / 86400000);
            if (diff >= 0) {
                relationship = {
                    baseDate,
                    dayCount: diff + 1
                };
            }
        }

        res.json({
            today,
            relationship,
            stats: {
                totalItems: items.length,
                sameDayHistoryCount: sameDayHistory.length,
                lastYearCount: lastYearItems.length
            },
            cards: {
                latestMemory: latestMemory ? toCardItem(latestMemory) : null,
                earliestMemory: earliestMemory ? toCardItem(earliestMemory) : null,
                lastYearToday: lastYearItems.slice(0, 6).map(toCardItem),
                sameDayHistory: sameDayHistory.slice(0, 12).map(toCardItem)
            }
        });
    } catch (err) {
        handleError(res, err);
    }
});

app.get('/api/fun/surprise', async (req, res) => {
    try {
        const pipeline = [
            { $match: { deletedAt: null } }
        ];
        if (req.query.category) {
            pipeline.push({ $match: { category: normalizeCategory(req.query.category) } });
        }
        if (req.query.author) {
            pipeline.push({ $match: { author: normalizeAuthor(req.query.author) } });
        }
        pipeline.push({ $sample: { size: 1 } });

        const items = await Item.aggregate(pipeline);
        res.json(items[0] || null);
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
        const { title, note, completed, segments, mood } = req.body;
        const existingItem = await Item.findById(req.params.id);
        if (!existingItem) {
            throw createHttpError(404, '内容未找到');
        }
        ensureActiveItem(existingItem);
        let updateDoc = {};
        if (title !== undefined) updateDoc.title = title;
        if (note !== undefined) updateDoc.note = note;
        if (completed !== undefined) updateDoc.completed = completed;
        if (segments !== undefined) updateDoc.segments = parseSegments(segments);
        if (mood !== undefined) updateDoc.mood = normalizeMood(mood);

        await Item.findByIdAndUpdate(req.params.id, { $set: updateDoc }, { new: true });
        res.json({ success: true });
    } catch (err) {
        handleError(res, err);
    }
});

app.delete('/api/items/:id', async (req, res) => {
    try {
        ensureObjectId(req.params.id, '内容 ID 无效');
        const item = await Item.findById(req.params.id);
        if (!item) {
            throw createHttpError(404, '内容未找到');
        }
        if (item.deletedAt) {
            throw createHttpError(400, '内容已经在回收站中了');
        }
        item.deletedAt = new Date();
        item.deletedBy = normalizeOptionalAuthor(req.query.author) || '';
        await item.save();
        res.json({ success: true, mode: 'soft_deleted' });
    } catch (err) {
        handleError(res, err);
    }
});

app.post('/api/items/:id/restore', async (req, res) => {
    try {
        ensureObjectId(req.params.id, '内容 ID 无效');
        const item = await Item.findById(req.params.id);
        if (!item) {
            throw createHttpError(404, '内容未找到');
        }
        if (!item.deletedAt) {
            throw createHttpError(400, '内容不在回收站中');
        }
        item.deletedAt = null;
        item.deletedBy = '';
        await item.save();
        res.json({ success: true });
    } catch (err) {
        handleError(res, err);
    }
});

app.delete('/api/items/:id/permanent', async (req, res) => {
    try {
        ensureObjectId(req.params.id, '内容 ID 无效');
        const item = await Item.findById(req.params.id);
        if (!item) {
            throw createHttpError(404, '内容未找到');
        }
        await destroyItemAssets(item);
        await Item.findByIdAndDelete(req.params.id);
        res.json({ success: true, mode: 'permanent_deleted' });
    } catch (err) {
        handleError(res, err);
    }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
