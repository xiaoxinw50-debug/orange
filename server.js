const express = require('express');
const multer = require('multer');
const Datastore = require('nedb');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

const db = new Datastore({ filename: 'memories.db', autoload: true });

app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(uploadDir)); 
app.use(express.static(__dirname)); 

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'uploads/'),
    filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage });

// API: 新增内容
app.post('/api/items', upload.single('file'), (req, res) => {
    const { category, title, note, date, author } = req.body;
    const timestamp = date ? new Date(date).getTime() : Date.now();
    const displayDate = date ? date : new Date().toISOString().split('T')[0];
    
    // 解析分段故事数据 (如果有)
    const segments = req.body.segments ? JSON.parse(req.body.segments) : null;

    const newItem = {
        category: category || 'memory', 
        author: author,                 
        url: req.file ? `/uploads/${req.file.filename}` : null, 
        title: title || '',             
        note: note || '', 
        segments: segments, // 存入平行世界的故事段落
        date: displayDate,
        time: timestamp,
        completed: false                
    };
    
    db.insert(newItem, (err, doc) => res.json(doc));
});

// API: 获取内容
app.get('/api/items', (req, res) => {
    const { q, category } = req.query;
    let query = {};
    if (category) query.category = category;
    if (q) {
        query.$or = [{ note: new RegExp(q, 'i') }, { title: new RegExp(q, 'i') }];
    }
    
    db.find(query).sort({ time: -1 }).exec((err, docs) => res.json(docs));
});

// API: 岁月拾遗
app.get('/api/random', (req, res) => {
    const now = Date.now();
    db.find({ category: 'memory', time: { $lte: now } }).exec((err, docs) => {
        if (err || docs.length === 0) return res.json(null);
        res.json(docs[Math.floor(Math.random() * docs.length)]);
    });
});

// API: 修改内容
app.put('/api/items/:id', (req, res) => {
    const id = req.params.id;
    const { title, note, completed, segments } = req.body;
    
    let updateDoc = {};
    if (title !== undefined) updateDoc.title = title;
    if (note !== undefined) updateDoc.note = note;
    if (completed !== undefined) updateDoc.completed = completed;
    if (segments !== undefined) updateDoc.segments = segments;

    db.update({ _id: id }, { $set: updateDoc }, {}, (err, numReplaced) => {
        res.json({ success: true });
    });
});

// API: 抹去内容
app.delete('/api/items/:id', (req, res) => {
    db.findOne({ _id: id }, (err, doc) => {
        if (doc && doc.url) {
            const filePath = path.join(__dirname, doc.url);
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        }
        db.remove({ _id: id }, {}, (err) => res.json({ success: true }));
    });
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
