const express = require('express');
const Datastore = require('nedb');
const cors = require('cors');

const app = express();
const db = new Datastore({ filename: 'chats.db', autoload: true });

app.use(cors());
app.use(express.json());

// 初始化一些测试数据 (仅第一次运行)
// db.insert([{ sender: 'He', text: '想去海边看日落', time: '2023-05-20' }, ...]);

// 获取所有聊天记录或搜索关键词
app.get('/api/messages', (req, res) => {
    const keyword = req.query.q;
    let query = {};
    if (keyword) {
        // 使用正则实现模糊搜索
        query = { text: new RegExp(keyword, 'i') };
    }
    db.find(query).sort({ time: 1 }).exec((err, docs) => {
        res.json(docs);
    });
});

app.listen(3000, () => console.log('Server running on http://localhost:3000'));
