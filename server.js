const express = require('express');
const multer = require('multer');
const Datastore = require('nedb');
const cors = require('cors');
const path = require('path');

const app = express();
const db = new Datastore({ filename: 'letters.db', autoload: true });

app.use(cors());
app.use(express.json());
app.use('/uploads', express.static('uploads')); // 公开上传文件夹

// 配置图片存储
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'uploads/'),
    filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage });

// API: 上传信件照片
app.post('/api/upload', upload.single('letterImage'), (req, res) => {
    const newLetter = {
        type: 'image',
        url: `http://localhost:3000/uploads/${req.file.filename}`,
        note: req.body.note, // 信件的文字备注（用于搜索）
        date: req.body.date || new Date().toLocaleDateString(),
        time: Date.now()
    };
    db.insert(newLetter, (err, doc) => {
        res.json(doc);
    });
});

// API: 获取并搜索信件
app.get('/api/letters', (req, res) => {
    const search = req.query.q || '';
    const query = { note: new RegExp(search, 'i') };
    db.find(query).sort({ time: -1 }).exec((err, docs) => {
        res.json(docs);
    });
});

app.listen(3000, () => console.log('Server running at http://localhost:3000'));
