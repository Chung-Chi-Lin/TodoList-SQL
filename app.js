require('dotenv').config();
const express = require('express');
const cors = require('cors');
const sql = require('mssql');
// const mysql = require('mysql2/promise');
const app = express();
// 信任代理
app.set('trust proxy', true);
// 先把mssql刪除之後在加回來
// 连接池配置
// const dbConfig = {
// 	host: process.env.DB_HOST,
// 	user: process.env.DB_USER,
// 	password: process.env.DB_PASSWORD,
// 	database: process.env.DB_DATABASE,
// 	waitForConnections: true,
// 	connectionLimit: 10,
// 	queueLimit: 0
// };
const dbConfig = {
	user: process.env.DB_USER,
	password: process.env.DB_PASSWORD,
	server: process.env.DB_HOST,
	database: process.env.DB_DATABASE,
	port: 1433,
	options: {
		encrypt: true, // 對於 Azure 必須啟用加密
	}
};

const pool = new sql.ConnectionPool(dbConfig);
const poolConnect = pool.connect();

// 增加錯誤處理和日誌記錄
pool.on('error', err => {
	console.error('Unexpected error on idle pool', err);
	process.exit(-1);
});

poolConnect.then(() => {
	console.log('Connected to the database.');
}).catch((err) => {
	console.error('Database connection error:', err);
});

app.use(express.json()); // 解析 JSON 格式
app.use(cors());

const todoRoutes = require('./todoRoutes')(pool);

// 使用 Todo 路由
app.use('/api', todoRoutes);

app.use((err, req, res, next) => {
	console.error('Unhandled error:', err);
	res.status(500).send('An error occurred');
});

// 基本路由
app.get('/', (req, res) => {
	res.send('Hello World!');
});

// 服務器
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
	console.log(`Server is running on port ${PORT}`);
});

module.exports = app; // 導出 app 以便在其他文件中使用
