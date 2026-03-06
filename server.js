const express = require('express');
const multer = require('multer');
const Datastore = require('nedb');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

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
    const userDate = req.body.date; 
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

// API: 获取所有信件
app.get('/api/letters', (req, res) => {
    const search = req.query.q || '';
    const query = { note: new RegExp(search, 'i') };
    db.find(query).sort({ time: -1 }).exec((err, docs) => {
        res.json(docs);
    });
});

// API: 删除信件 (新功能)
app.delete('/api/letters/:id', (req, res) => {
    const id = req.params.id;
    // 先找到信件，获取文件路径
    db.findOne({ _id: id }, (err, doc) => {
        if (doc && doc.url) {
            // 删除物理文件
            const filePath = path.join(__dirname, doc.url);
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
        }
        // 从数据库中删除
        db.remove({ _id: id }, {}, (err, numRemoved) => {
            res.json({ success: true });
        });
    });
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
