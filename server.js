require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const multer = require('multer');
const { execFile } = require('child_process');
const { promisify } = require('util');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');

const app = express();
const PORT = process.env.PORT || 3000;
const DEEPSEEK_API_BASE = String(process.env.DEEPSEEK_API_BASE || 'https://api.deepseek.com').trim().replace(/\/+$/, '');
const DEEPSEEK_MODEL = String(process.env.DEEPSEEK_MODEL || 'deepseek-chat').trim() || 'deepseek-chat';
const PYTHON_BIN = String(process.env.PYTHON_BIN || 'python3').trim() || 'python3';
const execFileAsync = promisify(execFile);
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
}, {
    timestamps: true
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

const assistantStyleProfileSchema = new mongoose.Schema({
    author: { type: String, required: true, unique: true },
    sourceName: { type: String, default: '' },
    importedAt: { type: String, required: true },
    messageCount: { type: Number, default: 0 },
    averageLength: { type: Number, default: 0 },
    favoriteFillers: { type: [String], default: [] },
    favoriteEndings: { type: [String], default: [] },
    favoritePhrases: { type: [String], default: [] },
    summary: { type: String, default: '' },
    samples: { type: [String], default: [] }
}, {
    timestamps: true
});
const AssistantStyleProfile = mongoose.model('AssistantStyleProfile', assistantStyleProfileSchema);

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
const assistantUploadDir = path.join(__dirname, '.tmp-assistant');
const assistantDataDir = path.join(__dirname, 'data');
const assistantStyleStore = path.join(assistantDataDir, 'assistant-style-profiles.json');
fs.mkdirSync(assistantUploadDir, { recursive: true });
fs.mkdirSync(assistantDataDir, { recursive: true });
const assistantUpload = multer({
    dest: assistantUploadDir,
    limits: {
        fileSize: 300 * 1024 * 1024
    }
});

function createHttpError(status, message) {
    const error = new Error(message);
    error.status = status;
    return error;
}

function normalizeAssistantMessages(messages) {
    if (!Array.isArray(messages) || messages.length === 0) {
        throw createHttpError(400, '缺少聊天内容');
    }
    return messages
        .slice(-12)
        .map(item => {
            const role = item?.role === 'assistant' ? 'assistant' : 'user';
            const content = typeof item?.content === 'string' ? item.content.trim() : '';
            const attachments = normalizeAssistantAttachments(item?.attachments);
            if (!content && attachments.length === 0) return null;
            return {
                role,
                content: content.slice(0, 1200),
                attachments
            };
        })
        .filter(Boolean);
}

function normalizeAssistantAttachments(attachments) {
    if (!Array.isArray(attachments)) {
        return [];
    }
    return attachments
        .slice(0, 3)
        .map(item => {
            const name = typeof item?.name === 'string' ? item.name.trim().slice(0, 80) : '';
            const type = typeof item?.type === 'string' ? item.type.trim().slice(0, 60) : '';
            const size = Number(item?.size || 0);
            if (!name) return null;
            return {
                name,
                type,
                size: Number.isFinite(size) && size > 0 ? size : 0
            };
        })
        .filter(Boolean);
}

function readAssistantStyleProfiles() {
    try {
        return JSON.parse(fs.readFileSync(assistantStyleStore, 'utf8'));
    } catch (error) {
        return {};
    }
}

function writeAssistantStyleProfiles(profiles) {
    fs.writeFileSync(assistantStyleStore, JSON.stringify(profiles, null, 2), 'utf8');
}

function getAssistantStyleProfileFromFile(author) {
    const profiles = readAssistantStyleProfiles();
    return profiles[author] || null;
}

async function getAssistantStyleProfile(author) {
    if (mongoose.connection.readyState === 1) {
        const profile = await AssistantStyleProfile.findOne({ author }).lean();
        if (profile) return profile;
    }
    return getAssistantStyleProfileFromFile(author);
}

async function saveAssistantStyleProfile(author, profile) {
    if (mongoose.connection.readyState === 1) {
        await AssistantStyleProfile.findOneAndUpdate(
            { author },
            { ...profile, author },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );
        return;
    }
    const profiles = readAssistantStyleProfiles();
    profiles[author] = profile;
    writeAssistantStyleProfiles(profiles);
}

async function deleteAssistantStyleProfile(author) {
    if (mongoose.connection.readyState === 1) {
        await AssistantStyleProfile.deleteOne({ author });
        return;
    }
    const profiles = readAssistantStyleProfiles();
    delete profiles[author];
    writeAssistantStyleProfiles(profiles);
}

function normalizeImportedMessage(text) {
    return String(text || '')
        .replace(/\(cid:\d+\)/g, '')
        .replace(/(?<=[\u4e00-\u9fa5A-Za-z0-9])F$/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function pickTopEntries(counts, limit = 3) {
    return [...counts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, limit)
        .map(([value]) => value);
}

function buildAssistantStyleProfile(messages, author, sourceName = '') {
    const cleaned = messages
        .map(normalizeImportedMessage)
        .filter(Boolean)
        .filter(text => !/^(信息|短信|\d{1,2}:\d{2}|周[一二三四五六日天]|[\d年月日/:\- ]+)$/.test(text));
    if (!cleaned.length) {
        throw createHttpError(400, '没有提取到可用的聊天内容');
    }

    const fillerLexicon = ['哈哈', '哈哈哈', '呜呜', '好耶', '乐', '好哒', '好嘞', '乖乖', '可恶', 'qwq', 'QWQ', '呀', '啦', '呢', '嘛', '哼'];
    const endingLexicon = ['呀', '啦', '呢', '嘛', '哦', '啊', '耶', '～', '~', '！', '…'];
    const fillerCounts = new Map();
    const endingCounts = new Map();
    const phraseCounts = new Map();

    cleaned.forEach(text => {
        fillerLexicon.forEach(token => {
            if (text.includes(token)) fillerCounts.set(token, (fillerCounts.get(token) || 0) + 1);
        });
        endingLexicon.forEach(token => {
            if (text.endsWith(token)) endingCounts.set(token, (endingCounts.get(token) || 0) + 1);
        });
        if (text.length >= 2 && text.length <= 14) {
            phraseCounts.set(text, (phraseCounts.get(text) || 0) + 1);
        }
    });

    const averageLength = Math.round(cleaned.reduce((sum, text) => sum + text.length, 0) / cleaned.length);
    const favoriteFillers = pickTopEntries(fillerCounts, 4);
    const favoriteEndings = pickTopEntries(endingCounts, 4);
    const favoritePhrases = [...phraseCounts.entries()]
        .filter(([, count]) => count >= 2)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([value]) => value);

    const summaryParts = [];
    summaryParts.push(averageLength <= 8 ? '短句偏多' : averageLength <= 16 ? '句子偏短，节奏快' : '会写完整一点的句子');
    if (favoriteFillers.length) summaryParts.push(`常带 ${favoriteFillers.slice(0, 2).join('、')} 这类口头习惯`);
    if (favoriteEndings.length) summaryParts.push(`结尾会落在 ${favoriteEndings.slice(0, 2).join('、')} 这种语气上`);
    if (!favoriteFillers.length && !favoriteEndings.length) summaryParts.push('整体语气比较直接自然');

    return {
        author,
        sourceName,
        importedAt: new Date().toISOString(),
        messageCount: cleaned.length,
        averageLength,
        favoriteFillers,
        favoriteEndings,
        favoritePhrases,
        summary: summaryParts.join('，'),
        samples: cleaned.slice(0, 8)
    };
}

async function extractMessagesFromPdf(filePath, side = 'right', limit = 4000) {
    const scriptPath = path.join(__dirname, 'scripts', 'extract_chat_style.py');
    try {
        const { stdout } = await execFileAsync(PYTHON_BIN, [scriptPath, filePath, side, String(limit)], {
            maxBuffer: 20 * 1024 * 1024
        });
        const parsed = JSON.parse(stdout || '[]');
        return Array.isArray(parsed) ? parsed.map(item => normalizeImportedMessage(item)).filter(Boolean) : [];
    } catch (error) {
        if (error?.code === 'ENOENT') {
            throw createHttpError(500, '服务器没有可用的 python3，暂时不能导入 PDF');
        }
        const stderr = String(error?.stderr || error?.message || '').trim();
        if (/No module named ['"]?pdfplumber/i.test(stderr)) {
            throw createHttpError(500, '服务器缺少 pdfplumber，暂时不能导入 PDF');
        }
        throw error;
    }
}

async function extractMessagesFromUpload(file) {
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (ext === '.pdf') {
        return extractMessagesFromPdf(file.path, 'right', 4000);
    }
    const raw = fs.readFileSync(file.path, 'utf8');
    return raw
        .split(/\r?\n/)
        .map(normalizeImportedMessage)
        .filter(Boolean);
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

function isAllowedRemoteImageUrl(rawUrl) {
    try {
        const parsed = new URL(normalizeImageUrl(rawUrl));
        return ['https:', 'http:'].includes(parsed.protocol) && (
            parsed.hostname === 'res.cloudinary.com' ||
            parsed.hostname.endsWith('.cloudinary.com')
        );
    } catch (error) {
        return false;
    }
}

function proxyRemoteImage(remoteUrl, res, redirectCount = 0) {
    const normalizedUrl = normalizeImageUrl(remoteUrl);
    if (!isAllowedRemoteImageUrl(normalizedUrl)) {
        throw createHttpError(400, '图片地址无效');
    }
    if (redirectCount > 3) {
        throw createHttpError(502, '图片重定向次数过多');
    }

    const client = normalizedUrl.startsWith('https://') ? https : http;
    client.get(normalizedUrl, upstreamRes => {
        const statusCode = upstreamRes.statusCode || 502;
        if ([301, 302, 303, 307, 308].includes(statusCode) && upstreamRes.headers.location) {
            upstreamRes.resume();
            return proxyRemoteImage(upstreamRes.headers.location, res, redirectCount + 1);
        }
        if (statusCode >= 400) {
            upstreamRes.resume();
            return res.status(statusCode).json({ error: '图片读取失败' });
        }

        res.setHeader('Cache-Control', 'public, max-age=86400');
        if (upstreamRes.headers['content-type']) res.setHeader('Content-Type', upstreamRes.headers['content-type']);
        if (upstreamRes.headers['content-length']) res.setHeader('Content-Length', upstreamRes.headers['content-length']);
        upstreamRes.pipe(res);
    }).on('error', err => {
        console.error('图片代理失败:', err);
        if (!res.headersSent) {
            res.status(502).json({ error: '图片代理失败' });
        }
    });
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

function extractAssistantKeywords(text) {
    return Array.from(new Set(String(text || '')
        .match(/[A-Za-z0-9\u4e00-\u9fa5]{2,}/g) || []))
        .filter(token => token.length >= 2)
        .slice(0, 5);
}

function formatAssistantItemContext(item) {
    const categoryLabel = item.category === 'story' ? '代餐' : '记事';
    const title = item.title ? `《${item.title}》` : '';
    const storyText = Array.isArray(item.segments)
        ? item.segments.map(segment => String(segment?.text || '').trim()).filter(Boolean).join(' / ')
        : '';
    const excerpt = String(item.note || storyText || '').replace(/\s+/g, ' ').trim().slice(0, 110);
    return `- [${categoryLabel}] ${item.date || ''} ${title} ${excerpt}`.trim();
}

async function buildAssistantMemoryContext(userText) {
    if (mongoose.connection.readyState !== 1) {
        return '';
    }
    const baseQuery = {
        deletedAt: null,
        category: { $in: ['memory', 'story'] }
    };
    const keywords = extractAssistantKeywords(userText);
    const seenIds = new Set();
    const picked = [];

    if (keywords.length) {
        const keywordPattern = keywords.map(keyword => escapeRegExp(keyword)).join('|');
        const matchedItems = await Item.find({
            ...baseQuery,
            $or: [
                { note: new RegExp(keywordPattern, 'i') },
                { title: new RegExp(keywordPattern, 'i') },
                { 'segments.text': new RegExp(keywordPattern, 'i') }
            ]
        }).sort({ time: -1 }).limit(4).lean();
        matchedItems.forEach(item => {
            const key = String(item._id);
            if (seenIds.has(key)) return;
            seenIds.add(key);
            picked.push(item);
        });
    }

    if (picked.length < 6) {
        const recentItems = await Item.find(baseQuery).sort({ time: -1 }).limit(8).lean();
        recentItems.forEach(item => {
            const key = String(item._id);
            if (seenIds.has(key) || picked.length >= 6) return;
            seenIds.add(key);
            picked.push(item);
        });
    }

    if (!picked.length) {
        return '';
    }

    return picked.map(formatAssistantItemContext).join('\n');
}

function formatAssistantAttachmentContext(attachments) {
    if (!attachments.length) {
        return '';
    }
    return attachments
        .map(item => {
            const type = item.type ? `，类型 ${item.type}` : '';
            const size = item.size ? `，约 ${(item.size / 1024).toFixed(0)}KB` : '';
            return `- ${item.name}${type}${size}`;
        })
        .join('\n');
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

function getActivityTimestamp(item) {
    const createdAt = item?.createdAt ? new Date(item.createdAt).getTime() : 0;
    const updatedAt = item?.updatedAt ? new Date(item.updatedAt).getTime() : 0;
    const legacyTime = Number(item?.time || 0);
    return Math.max(createdAt || 0, updatedAt || 0, legacyTime || 0);
}

function toNotificationItem(item) {
    const cardItem = toCardItem(item);
    return {
        ...cardItem,
        activityTime: getActivityTimestamp(item),
        preview: cardItem.note
            || cardItem.title
            || cardItem.segments?.[0]?.text
            || (cardItem.category === 'album' ? '对方刚刚整理了一本相册。' : '')
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

app.get('/api/notifications/check', async (req, res) => {
    try {
        const viewer = normalizeOptionalAuthor(req.query.viewer);
        const since = Math.max(0, Number(req.query.since || 0));
        const trackedCategories = ['memory', 'album', 'diary', 'story'];
        const query = {
            deletedAt: null,
            category: { $in: trackedCategories }
        };

        if (viewer) {
            query.author = { $ne: viewer };
        }

        const items = await Item.find(query).sort({ updatedAt: -1, createdAt: -1, time: -1 }).limit(32).lean();
        const latestByCategory = {};
        trackedCategories.forEach(category => {
            const item = items.find(entry => entry.category === category);
            latestByCategory[category] = item ? toNotificationItem(item) : null;
        });

        const latestItem = items[0] ? toNotificationItem(items[0]) : null;
        const unseenItems = items
            .map(toNotificationItem)
            .filter(item => item.activityTime > since)
            .slice(0, 6);

        res.json({
            serverTime: Date.now(),
            viewer: viewer || '',
            latestTime: latestItem?.activityTime || 0,
            latestItem,
            latestByCategory,
            unseenCount: unseenItems.length,
            unseenItems
        });
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

app.get('/api/media/proxy', async (req, res) => {
    try {
        const src = typeof req.query.src === 'string' ? req.query.src : '';
        if (!src) {
            throw createHttpError(400, '缺少图片地址');
        }
        proxyRemoteImage(src, res);
    } catch (err) {
        handleError(res, err);
    }
});

app.post('/api/assistant/chat', async (req, res) => {
    try {
        if (!process.env.DEEPSEEK_API_KEY) {
            throw createHttpError(503, 'DEEPSEEK_API_KEY 未配置');
        }
        const author = normalizeAuthor(req.body?.author || '小心');
        const messages = normalizeAssistantMessages(req.body?.messages);
        const modelMode = req.body?.mode === 'reasoner' ? 'reasoner' : 'chat';
        if (!messages.length) {
            throw createHttpError(400, '没有可发送的聊天内容');
        }
        const styleProfile = await getAssistantStyleProfile(author);
        const latestUserMessage = [...messages].reverse().find(item => item.role === 'user');
        const memoryContext = await buildAssistantMemoryContext(latestUserMessage?.content || '');
        const stylePrompt = styleProfile
            ? `你要轻微模仿 ${author} 的说话习惯，但不要机械复读。风格摘要：${styleProfile.summary}。常用词：${styleProfile.favoriteFillers.join('、') || '无'}。常见结尾：${styleProfile.favoriteEndings.join('、') || '无'}。示例：${(styleProfile.samples || []).slice(0, 4).join(' / ')}。`
            : '';
        const attachmentContext = latestUserMessage?.attachments?.length
            ? `用户这次附带了图片附件，但当前接口拿到的是附件信息，不是真实图像内容。你可以温柔追问图片里是什么，或根据附件继续聊天。\n${formatAssistantAttachmentContext(latestUserMessage.attachments)}`
            : '';
        const memoryPrompt = memoryContext
            ? `下面是你们最近的记事和代餐片段，可以在合适时自然引用，不要生硬复述：\n${memoryContext}`
            : '';
        const systemSections = [
            '你叫小心，是一个温柔、自然、口语化的陪伴型聊天助手。回答要简短真诚，少一点官方表达，多一点陪在身边的感觉。不要长篇说教。',
            stylePrompt,
            memoryPrompt,
            attachmentContext
        ].filter(Boolean);

        const response = await fetch(`${DEEPSEEK_API_BASE}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`
            },
            body: JSON.stringify({
                model: modelMode === 'reasoner' ? 'deepseek-reasoner' : DEEPSEEK_MODEL,
                temperature: 0.85,
                messages: [
                    {
                        role: 'system',
                        content: systemSections.join('\n\n')
                    },
                    ...messages.map(item => ({
                        role: item.role,
                        content: [
                            item.content || '',
                            item.attachments?.length
                                ? `\n[附带图片附件]\n${formatAssistantAttachmentContext(item.attachments)}`
                                : ''
                        ].filter(Boolean).join('')
                    }))
                ]
            })
        });

        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
            const message = payload?.error?.message || payload?.message || 'DeepSeek 请求失败';
            throw createHttpError(response.status, message);
        }

        const reply = String(payload?.choices?.[0]?.message?.content || '').trim();
        if (!reply) {
            throw createHttpError(502, 'DeepSeek 没有返回内容');
        }

        res.json({
            reply,
            model: payload?.model || (modelMode === 'reasoner' ? 'deepseek-reasoner' : DEEPSEEK_MODEL),
            provider: 'deepseek'
        });
    } catch (err) {
        handleError(res, err);
    }
});

app.get('/api/assistant/style', async (req, res) => {
    try {
        const author = normalizeAuthor(req.query.author || '小心');
        res.json(await getAssistantStyleProfile(author));
    } catch (err) {
        handleError(res, err);
    }
});

app.post('/api/assistant/style/import', assistantUpload.single('file'), async (req, res) => {
    try {
        const author = normalizeAuthor(req.body?.author || '小心');
        if (!req.file) {
            throw createHttpError(400, '缺少聊天记录文件');
        }
        const messages = await extractMessagesFromUpload(req.file);
        const profile = buildAssistantStyleProfile(messages, author, req.file.originalname || '');
        await saveAssistantStyleProfile(author, profile);
        res.json(profile);
    } catch (err) {
        handleError(res, err);
    } finally {
        if (req.file?.path) {
            fs.promises.unlink(req.file.path).catch(() => {});
        }
    }
});

app.delete('/api/assistant/style', async (req, res) => {
    try {
        const author = normalizeAuthor(req.query.author || '小心');
        await deleteAssistantStyleProfile(author);
        res.json({ ok: true });
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
