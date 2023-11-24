require('dotenv').config();
const express = require('express');
const cors = require('cors');
const sql = require('mssql');
const todoRoutes = require('./todoRoutes');
const app = express();

const dbConfig = {
	user: process.env.DB_USER,
	password: process.env.DB_PASSWORD,
	server: process.env.DB_HOST,
	database: process.env.DB_DATABASE,
	port: 1433,
	options: {
		encrypt: true, // 对于 Azure 必须启用加密
		trustServerCertificate: false // 用于本地开发
	}
};

const pool = new sql.ConnectionPool(dbConfig);
const poolConnect = pool.connect();

poolConnect.then(() => {
	console.log('Connected to the database.');
}).catch((err) => {
	console.error('Database connection error:', err);
});

// 中間件
app.use(express.json()); // 解析 JSON 格式的請求體
app.use(cors()); // 啟用 CORS

// 使用 Todo 路由
app.use('/api', todoRoutes);

// 基本路由
app.get('/', (req, res) => {
	res.send('Hello World!');
});

// 啟動服務器
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
	console.log(`Server is running on port ${PORT}`);
});
