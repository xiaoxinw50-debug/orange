const express = require('express');
const multer = require('multer');
const Datastore = require('nedb');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
// 获取 Render 动态分配的端口，如果本地运行则使用 3000
const PORT = process.env.PORT || 3000;

// 【关键修复】确保 uploads 文件夹存在，防止 Render 部署时报错
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir);
}

const db = new Datastore({ filename: 'letters.db', autoload: true });

app.use(cors());
app.use(express.json());

// 暴露静态资源目录
app.use('/uploads', express.static(uploadDir)); 
// 允许 Express 直接提供当前目录的 index.html
app.use(express.static(__dirname)); 

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
        // 【关键修复】存入数据库的路径改为相对路径，适应任何域名
        url: `/uploads/${req.file.filename}`, 
        note: req.body.note, 
        date: new Date().toLocaleDateString(),
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

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
