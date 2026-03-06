const express = require('express');
const multer = require('multer');
const Datastore = require('nedb');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// 确保 uploads 文件夹存在，避免线上部署报错
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir);
}

// 初始化数据库
const db = new Datastore({ filename: 'letters.db', autoload: true });

app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(uploadDir)); 
app.use(express.static(__dirname)); // 允许直接访问 index.html

// 配置文件上传
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'uploads/'),
    filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage });

// API: 入卷 (上传信件)
app.post('/api/upload', upload.single('letterImage'), (req, res) => {
    const userDate = req.body.date; 
    // 若选择了未来的日期，时间戳会自动设为未来，成为时光胶囊
    const timestamp = userDate ? new Date(userDate).getTime() : Date.now();
    const displayDate = userDate ? userDate : new Date().toISOString().split('T')[0];

    const newLetter = {
        type: 'image',
        url: `/uploads/${req.file.filename}`, 
        note: req.body.note, 
        date: displayDate,
        time: timestamp
    };
    
    db.insert(newLetter, (err, doc) => {
        res.json(doc);
    });
});

// API: 阅览 (获取所有信件，按时间倒序)
app.get('/api/letters', (req, res) => {
    const search = req.query.q || '';
    const query = { note: new RegExp(search, 'i') };
    db.find(query).sort({ time: -1 }).exec((err, docs) => {
        res.json(docs);
    });
});

// API: 岁月拾遗 (随机抽取一封"已解封"的过去信件)
app.get('/api/random', (req, res) => {
    const now = Date.now();
    db.find({ time: { $lte: now } }).exec((err, docs) => {
        if (err || docs.length === 0) {
            res.json(null);
        } else {
            const randomIndex = Math.floor(Math.random() * docs.length);
            res.json(docs[randomIndex]);
        }
    });
});

// API: 抹去 (删除信件及物理文件)
app.delete('/api/letters/:id', (req, res) => {
    const id = req.params.id;
    db.findOne({ _id: id }, (err, doc) => {
        if (doc && doc.url) {
            const filePath = path.join(__dirname, doc.url);
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
        }
        db.remove({ _id: id }, {}, (err, numRemoved) => {
            res.json({ success: true });
        });
    });
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
