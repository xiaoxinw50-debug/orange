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
const ALLOWED_RELATIONSHIP_TYPES = new Set(['praise', 'repair', 'ritual', 'temperature', 'companion', 'comfort']);
const ALLOWED_COMPANION_BUCKETS = new Set(['quick', 'weekly', 'someday']);
const ALLOWED_TEMPERATURE_STATES = new Set(['close', 'steady', 'need_hug']);

const DAILY_QUESTION_DECK = [
    { prompt: '今天如果只说一句真心话，你最想让对方听见什么？', options: ['我今天其实很想你', '谢谢你一直在', '我需要你多抱抱我'] },
    { prompt: '如果今晚只能选一种陪伴方式，你最想要哪一种？', options: ['安静抱抱', '认真聊天', '一起出门走走'] },
    { prompt: '这周你最想和对方一起完成的一件小事是什么？', options: ['好好吃一顿饭', '补一条新回忆', '留一段只属于我们的时间'] },
    { prompt: '你今天最想被怎样理解？', options: ['先听我讲完', '先给我一点温柔', '先别急着解决问题'] },
    { prompt: '如果把今天的感情状态写成一句台词，你会选哪句？', options: ['想靠近一点点', '其实已经很满足', '今天特别需要你'] },
    { prompt: '对你来说，最近最被爱的瞬间更像哪一种？', options: ['被照顾到细节', '被认真回应', '被坚定站在身边'] }
];

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
    replies: {
        type: [{
            author: { type: String, required: true },
            text: { type: String, required: true },
            date: { type: String, required: true },
            time: { type: Number, required: true }
        }],
        default: []
    },
    perspectives: {
        type: [{
            author: { type: String, required: true },
            text: { type: String, required: true },
            date: { type: String, required: true },
            time: { type: Number, required: true }
        }],
        default: []
    },
    date: { type: String, required: true },
    time: { type: Number, required: true },
    completed: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
    deletedBy: { type: String, default: '' }
});
const Item = mongoose.model('Item', itemSchema);

const relationshipEntrySchema = new mongoose.Schema({
    type: { type: String, required: true, enum: Array.from(ALLOWED_RELATIONSHIP_TYPES) },
    author: { type: String, required: true },
    title: { type: String, default: '' },
    text: { type: String, default: '' },
    prompt: { type: String, default: '' },
    bucket: { type: String, default: '' },
    state: { type: String, default: '' },
    completed: { type: Boolean, default: false },
    date: { type: String, required: true },
    time: { type: Number, required: true }
});
const RelationshipEntry = mongoose.model('RelationshipEntry', relationshipEntrySchema);

const dailyQuestionSchema = new mongoose.Schema({
    date: { type: String, required: true, unique: true },
    prompt: { type: String, required: true },
    options: { type: [String], default: [] },
    answers: {
        type: [{
            author: { type: String, required: true },
            answer: { type: String, required: true },
            date: { type: String, required: true },
            time: { type: Number, required: true }
        }],
        default: []
    },
    time: { type: Number, required: true }
});
const DailyQuestion = mongoose.model('DailyQuestion', dailyQuestionSchema);

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

function normalizeText(value, label, options = {}) {
    const { required = false, maxLength = 800 } = options;
    const normalized = typeof value === 'string' ? value.trim() : '';
    if (!normalized) {
        if (required) {
            throw createHttpError(400, `${label}不能为空`);
        }
        return '';
    }
    return normalized.slice(0, maxLength);
}

function normalizeRelationshipType(type) {
    const normalized = typeof type === 'string' ? type.trim() : '';
    if (!ALLOWED_RELATIONSHIP_TYPES.has(normalized)) {
        throw createHttpError(400, '关系功能类型无效');
    }
    return normalized;
}

function normalizeCompanionBucket(bucket) {
    const normalized = typeof bucket === 'string' ? bucket.trim() : '';
    if (!ALLOWED_COMPANION_BUCKETS.has(normalized)) {
        throw createHttpError(400, '陪伴清单分类无效');
    }
    return normalized;
}

function normalizeTemperatureState(state) {
    const normalized = typeof state === 'string' ? state.trim() : '';
    if (!ALLOWED_TEMPERATURE_STATES.has(normalized)) {
        throw createHttpError(400, '关系温度状态无效');
    }
    return normalized;
}

function buildTimestamp(date) {
    return new Date(date).getTime();
}

function sanitizeReplyEntry(author, text, date) {
    const safeDate = normalizeDate(date);
    return {
        author: normalizeAuthor(author),
        text: normalizeText(text, '内容', { required: true, maxLength: 600 }),
        date: safeDate,
        time: Date.now()
    };
}

function normalizeRelationshipEntryPayload(body) {
    const type = normalizeRelationshipType(body.type);
    const author = normalizeAuthor(body.author);
    const date = normalizeDate(body.date);
    const payload = {
        type,
        author,
        date,
        time: Date.now(),
        title: '',
        text: '',
        prompt: '',
        bucket: '',
        state: '',
        completed: false
    };

    if (type === 'praise') {
        payload.text = normalizeText(body.text, '夸夸内容', { required: true, maxLength: 500 });
        payload.title = normalizeText(body.title, '标题', { maxLength: 60 });
    } else if (type === 'repair') {
        payload.title = normalizeText(body.title, '修复主题', { required: true, maxLength: 80 });
        payload.prompt = normalizeText(body.prompt, '修复问题', { required: true, maxLength: 160 });
        payload.text = normalizeText(body.text, '修复回应', { required: true, maxLength: 800 });
    } else if (type === 'ritual') {
        payload.title = normalizeText(body.title, '仪式名称', { required: true, maxLength: 80 });
        payload.text = normalizeText(body.text, '仪式说明', { maxLength: 600 });
        payload.completed = Boolean(body.completed);
    } else if (type === 'temperature') {
        payload.state = normalizeTemperatureState(body.state);
        payload.text = normalizeText(body.text, '补充说明', { maxLength: 180 });
    } else if (type === 'companion') {
        payload.title = normalizeText(body.title, '陪伴事项', { required: true, maxLength: 80 });
        payload.text = normalizeText(body.text, '陪伴说明', { maxLength: 240 });
        payload.bucket = normalizeCompanionBucket(body.bucket);
        payload.completed = Boolean(body.completed);
    } else if (type === 'comfort') {
        payload.title = normalizeText(body.title, '安慰偏好标题', { required: true, maxLength: 80 });
        payload.text = normalizeText(body.text, '安慰偏好内容', { required: true, maxLength: 400 });
    }

    return payload;
}

function getDailyQuestionByDate(date) {
    const numeric = Number(date.replace(/-/g, ''));
    const index = Math.abs(numeric) % DAILY_QUESTION_DECK.length;
    return DAILY_QUESTION_DECK[index];
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
    return files
        .map(file => {
            const url = normalizeImageUrl(file.path || file.secure_url || file.url || '');
            if (!url) return null;
            return {
                url,
                public_id: file.filename || file.public_id || ''
            };
        })
        .filter(Boolean);
}

function normalizeImageUrl(rawUrl) {
    const url = typeof rawUrl === 'string' ? rawUrl.trim() : '';
    if (!url) return '';
    return url.replace(/^http:\/\//i, 'https://');
}

function normalizeImageEntry(image = {}, fallbackPublicId = '') {
    const url = normalizeImageUrl(image.url || image.path || image.secure_url || '');
    if (!url) return null;
    return {
        ...image,
        url,
        public_id: image.public_id || image.filename || fallbackPublicId || ''
    };
}

function normalizeItemMedia(item) {
    const rawImages = Array.isArray(item.images) ? item.images : [];
    const normalizedImages = rawImages
        .map((image, index) => normalizeImageEntry(image, `${item.public_id || item._id || 'image'}-${index}`))
        .filter(Boolean);

    if (normalizedImages.length === 0 && item.url) {
        const legacyCover = normalizeImageEntry(
            { url: item.url, public_id: item.public_id || `${item._id || 'legacy'}-cover` },
            item.public_id || `${item._id || 'legacy'}-cover`
        );
        if (legacyCover) {
            normalizedImages.push(legacyCover);
        }
    }

    return {
        ...item,
        images: normalizedImages,
        url: normalizedImages[0]?.url || normalizeImageUrl(item.url) || '',
        public_id: normalizedImages[0]?.public_id || item.public_id || ''
    };
}

function toClientItem(item) {
    const plainItem = typeof item?.toObject === 'function' ? item.toObject() : item;
    const normalizedItem = normalizeItemMedia(plainItem);
    return {
        ...normalizedItem,
        replies: Array.isArray(normalizedItem.replies) ? normalizedItem.replies : [],
        perspectives: Array.isArray(normalizedItem.perspectives) ? normalizedItem.perspectives : []
    };
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
    const normalizedItem = normalizeItemMedia(item);
    return {
        _id: normalizedItem._id,
        category: normalizedItem.category,
        author: normalizedItem.author,
        title: normalizedItem.title,
        note: normalizedItem.note,
        segments: normalizedItem.segments || [],
        mood: normalizedItem.mood || '',
        date: normalizedItem.date,
        time: normalizedItem.time,
        completed: normalizedItem.completed,
        images: normalizedItem.images || [],
        url: normalizedItem.url || '',
        deletedAt: normalizedItem.deletedAt || null,
        replies: normalizedItem.replies || [],
        perspectives: normalizedItem.perspectives || []
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
        res.json(toClientItem(savedItem));
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
        res.json(toClientItem(item));
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
        res.json(toClientItem(item));
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
        res.json(items.map(toClientItem));
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
        res.json(items[0] ? toClientItem(items[0]) : null);
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
        res.json(randomItems.length > 0 ? toClientItem(randomItems[0]) : null);
    } catch (err) {
        handleError(res, err);
    }
});

app.post('/api/items/:id/replies', async (req, res) => {
    try {
        ensureObjectId(req.params.id, '内容 ID 无效');
        const item = await Item.findById(req.params.id);
        if (!item) {
            throw createHttpError(404, '内容未找到');
        }
        ensureActiveItem(item);
        const reply = sanitizeReplyEntry(req.body.author, req.body.text, req.body.date);
        item.replies = item.replies || [];
        item.replies.push(reply);
        await item.save();
        res.json(toClientItem(item));
    } catch (err) {
        handleError(res, err);
    }
});

app.post('/api/items/:id/perspectives', async (req, res) => {
    try {
        ensureObjectId(req.params.id, '内容 ID 无效');
        const item = await Item.findById(req.params.id);
        if (!item) {
            throw createHttpError(404, '内容未找到');
        }
        ensureActiveItem(item);
        const perspective = sanitizeReplyEntry(req.body.author, req.body.text, req.body.date);
        item.perspectives = item.perspectives || [];
        const existingIndex = item.perspectives.findIndex(entry => entry.author === perspective.author);
        if (existingIndex >= 0) {
            item.perspectives[existingIndex] = perspective;
        } else {
            item.perspectives.push(perspective);
        }
        item.perspectives.sort((a, b) => b.time - a.time);
        await item.save();
        res.json(toClientItem(item));
    } catch (err) {
        handleError(res, err);
    }
});

app.get('/api/relationship/entries', async (req, res) => {
    try {
        const query = {};
        if (req.query.type) {
            query.type = normalizeRelationshipType(req.query.type);
        }
        if (req.query.author) {
            query.author = normalizeAuthor(req.query.author);
        }
        const entries = await RelationshipEntry.find(query).sort({ time: -1 }).lean();
        res.json(entries);
    } catch (err) {
        handleError(res, err);
    }
});

app.post('/api/relationship/entries', async (req, res) => {
    try {
        const payload = normalizeRelationshipEntryPayload(req.body);
        const entry = await RelationshipEntry.create(payload);
        res.json(entry);
    } catch (err) {
        handleError(res, err);
    }
});

app.put('/api/relationship/entries/:id', async (req, res) => {
    try {
        ensureObjectId(req.params.id, '关系记录 ID 无效');
        const entry = await RelationshipEntry.findById(req.params.id);
        if (!entry) {
            throw createHttpError(404, '关系记录未找到');
        }

        if (req.body.completed !== undefined) {
            entry.completed = Boolean(req.body.completed);
        }
        if (entry.type === 'companion' && req.body.bucket !== undefined) {
            entry.bucket = normalizeCompanionBucket(req.body.bucket);
        }
        if (entry.type === 'temperature' && req.body.state !== undefined) {
            entry.state = normalizeTemperatureState(req.body.state);
        }
        if (req.body.title !== undefined) {
            entry.title = normalizeText(req.body.title, '标题', { maxLength: 80 });
        }
        if (req.body.text !== undefined) {
            entry.text = normalizeText(req.body.text, '内容', { maxLength: 800 });
        }
        if (req.body.prompt !== undefined) {
            entry.prompt = normalizeText(req.body.prompt, '问题', { maxLength: 160 });
        }

        await entry.save();
        res.json(entry);
    } catch (err) {
        handleError(res, err);
    }
});

app.get('/api/relationship/daily-question', async (req, res) => {
    try {
        const date = normalizeDate(req.query.date);
        let question = await DailyQuestion.findOne({ date });
        if (!question) {
            const seed = getDailyQuestionByDate(date);
            question = await DailyQuestion.create({
                date,
                prompt: seed.prompt,
                options: seed.options,
                answers: [],
                time: buildTimestamp(date)
            });
        }
        res.json(question);
    } catch (err) {
        handleError(res, err);
    }
});

app.post('/api/relationship/daily-question/answer', async (req, res) => {
    try {
        const date = normalizeDate(req.body.date);
        const author = normalizeAuthor(req.body.author);
        const answer = normalizeText(req.body.answer, '答案', { required: true, maxLength: 120 });
        let question = await DailyQuestion.findOne({ date });
        if (!question) {
            const seed = getDailyQuestionByDate(date);
            question = await DailyQuestion.create({
                date,
                prompt: seed.prompt,
                options: seed.options,
                answers: [],
                time: buildTimestamp(date)
            });
        }
        const existingIndex = question.answers.findIndex(item => item.author === author);
        const payload = { author, answer, date, time: Date.now() };
        if (existingIndex >= 0) {
            question.answers[existingIndex] = payload;
        } else {
            question.answers.push(payload);
        }
        await question.save();
        res.json(question);
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
