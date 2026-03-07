require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// ================= 1. 连接 MongoDB 云数据库 =================
mongoose.connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
}).then(() => console.log('MongoDB 云数据库连接成功！'))
  .catch(err => console.error('MongoDB 连接失败:', err));

// 定义数据模型 (新增了 images 数组支持图集)
const itemSchema = new mongoose.Schema({
    category: String,
    author: String,
    url: String,        // 兼容老版本的单图
    public_id: String,  // 兼容老版本的单图ID
    images: [{          // 新版本的图集数组
        url: String,
        public_id: String
    }],
    title: String,
    note: String,
    segments: Array,    
    date: String,
    time: Number,
    completed: Boolean
});
const Item = mongoose.model('Item', itemSchema);

// ================= 2. 配置 Cloudinary 云图床 =================
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
// 升级为 array，最多允许一次上传 9 张照片
const upload = multer({ storage: storage });

// ================= 3. API 路由 =================

// API: 新增内容 (支持多图图集)
app.post('/api/items', upload.array('files', 9), async (req, res) => {
    try {
        const { category, title, note, date, author } = req.body;
        const timestamp = date ? new Date(date).getTime() : Date.now();
        const displayDate = date ? date : new Date().toISOString().split('T')[0];
        const segments = req.body.segments ? JSON.parse(req.body.segments) : null;

        // 处理多图上传
        let uploadedImages = [];
        if (req.files && req.files.length > 0) {
            uploadedImages = req.files.map(file => ({
                url: file.path,
                public_id: file.filename
            }));
        }

        const newItem = new Item({
            category: category || 'memory',
            author: author,
            images: uploadedImages, // 存入图集
            title: title || '',
            note: note || '',
            segments: segments,
            date: displayDate,
            time: timestamp,
            completed: false
        });
        
        const savedItem = await newItem.save();
        res.json(savedItem);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// API: 获取内容
app.get('/api/items', async (req, res) => {
    try {
        const { q, category } = req.query;
        let query = {};
        if (category) query.category = category;
        if (q) {
            query.$or = [{ note: new RegExp(q, 'i') }, { title: new RegExp(q, 'i') }];
        }
        const items = await Item.find(query).sort({ time: -1 });
        res.json(items);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// API: 岁月拾遗
app.get('/api/random', async (req, res) => {
    try {
        const now = Date.now();
        const randomItems = await Item.aggregate([
            { $match: { category: 'memory', time: { $lte: now } } },
            { $sample: { size: 1 } }
        ]);
        res.json(randomItems.length > 0 ? randomItems[0] : null);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// API: 修改内容
app.put('/api/items/:id', async (req, res) => {
    try {
        const { title, note, completed, segments } = req.body;
        let updateDoc = {};
        if (title !== undefined) updateDoc.title = title;
        if (note !== undefined) updateDoc.note = note;
        if (completed !== undefined) updateDoc.completed = completed;
        if (segments !== undefined) updateDoc.segments = segments;

        await Item.findByIdAndUpdate(req.params.id, { $set: updateDoc });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// API: 抹去内容 (同时删除云端的一张或多张图片)
app.delete('/api/items/:id', async (req, res) => {
    try {
        const item = await Item.findById(req.params.id);
        if (item) {
            // 删除老版本的单张图片
            if (item.public_id) {
                await cloudinary.uploader.destroy(item.public_id);
            }
            // 删除新版本的多图图集
            if (item.images && item.images.length > 0) {
                for (let img of item.images) {
                    await cloudinary.uploader.destroy(img.public_id);
                }
            }
            await Item.findByIdAndDelete(req.params.id);
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
