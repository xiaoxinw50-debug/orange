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

// ================= 1. 连接 MongoDB =================
mongoose.connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
}).then(() => console.log('MongoDB 云数据库连接成功！'))
  .catch(err => console.error('MongoDB 连接失败:', err));

const itemSchema = new mongoose.Schema({
    category: String,
    author: String,
    url: String,        
    public_id: String,  
    images: [{          // 相册里的所有照片
        url: String,
        public_id: String
    }],
    title: String,      // 相册名称
    note: String,       // 相册描述
    segments: Array,    
    date: String,
    time: Number,
    completed: Boolean
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
// 放宽限制，一次最多传 50 张
const upload = multer({ storage: storage });

// ================= 3. API 路由 =================

// API: 新增内容 (创建相册/纪事等)
app.post('/api/items', upload.array('files', 50), async (req, res) => {
    try {
        const { category, title, note, date, author } = req.body;
        const timestamp = date ? new Date(date).getTime() : Date.now();
        const displayDate = date ? date : new Date().toISOString().split('T')[0];
        const segments = req.body.segments ? JSON.parse(req.body.segments) : null;

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
            images: uploadedImages,
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

// API: 往已有相册中追加照片 (核心新功能)
app.post('/api/items/:id/images', upload.array('files', 50), async (req, res) => {
    try {
        const item = await Item.findById(req.params.id);
        if (!item) return res.status(404).json({ error: '相册未找到' });

        if (req.files && req.files.length > 0) {
            const newImages = req.files.map(file => ({
                url: file.path,
                public_id: file.filename
            }));
            // 将新照片推入相册数组
            item.images.push(...newImages);
            await item.save();
        }
        res.json(item);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// API: 删除相册中的某一张照片
app.delete('/api/items/:id/images/:imageId', async (req, res) => {
    try {
        const item = await Item.findById(req.params.id);
        if (!item) return res.status(404).json({ error: '相册未找到' });

        const imageIndex = item.images.findIndex(img => img._id.toString() === req.params.imageId);
        if (imageIndex > -1) {
            const img = item.images[imageIndex];
            await cloudinary.uploader.destroy(img.public_id); // 从云端删除
            item.images.splice(imageIndex, 1); // 从相册移除
            await item.save();
        }
        res.json(item);
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
        if (q) query.$or = [{ note: new RegExp(q, 'i') }, { title: new RegExp(q, 'i') }];
        
        const items = await Item.find(query).sort({ time: -1 });
        res.json(items);
    } catch (err) {
        res.status(500).json({ error: err.message });
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
        res.status(500).json({ error: err.message });
    }
});

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

app.delete('/api/items/:id', async (req, res) => {
    try {
        const item = await Item.findById(req.params.id);
        if (item) {
            if (item.public_id) await cloudinary.uploader.destroy(item.public_id);
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
