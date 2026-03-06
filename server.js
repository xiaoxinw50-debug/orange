const express = require('express');
const multer = require('multer');
const Datastore = require('nedb');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// 确保 uploads 文件夹存在
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir);
}

const db = new Datastore({ filename: 'letters.db', autoload: true });

app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(uploadDir)); 
app.use(express.static(__dirname)); 

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'uploads/'),
    filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage });

// API: 上传信件
app.post('/api/upload', upload.single('letterImage'), (req, res) => {
    // 获取前端传来的日期，如果没有则使用今天
    const userDate = req.body.date; 
    const timestamp = userDate ? new Date(userDate).getTime() : Date.now();
    const displayDate = userDate ? userDate : new Date().toISOString().split('T')[0];

    const newLetter = {
        type: 'image',
        url: `/uploads/${req.file.filename}`, 
        note: req.body.note, 
        date: displayDate, // 用于显示的格式 YYYY-MM-DD
        time: timestamp    // 用于数据库绝对排序的时间戳
    };
    
    db.insert(newLetter, (err, doc) => {
        res.json(doc);
    });
});

// API: 获取并搜索信件（按时间倒序）
app.get('/api/letters', (req, res) => {
    const search = req.query.q || '';
    const query = { note: new RegExp(search, 'i') };
    db.find(query).sort({ time: -1 }).exec((err, docs) => {
        res.json(docs);
    });
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
