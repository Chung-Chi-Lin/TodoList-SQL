// 引入模塊和配置環境變量
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const sql = require('mssql');

// 初始化Express應用
const app = express();
app.set('trust proxy', true); // 信任代理
app.use(express.json()); // 解析 JSON 格式的請求體
app.use(cors()); // 啟用CORS

// 數據庫連接配置
const dbConfig = {
	user: process.env.DB_USER,
	password: process.env.DB_PASSWORD,
	server: process.env.DB_HOST,
	database: process.env.DB_DATABASE,
	port: 1433,
	options: {
		encrypt: true, // 對於 Azure 必須啟用加密
	},
	connectionTimeout: 30000, // 連接超時設定為 30 秒
	requestTimeout: 15000, // 請求超時設定為 15 秒
};

// 建立數據庫連接池
const pool = new sql.ConnectionPool(dbConfig);
const poolConnect = pool.connect();

// 數據庫連接池事件處理
pool.on('error', err => {
	console.error('Unexpected error on idle pool', err);
	process.exit(-1);
});

poolConnect.then(() => {
	console.log('Connected to the database.');
}).catch((err) => {
	console.error('Database connection error:', err);
});

// 引入並使用Todo路由
const todoRoutes = require('./todoRoutes')(pool);
app.use('/api', todoRoutes);

// 錯誤處理中間件
app.use((err, req, res, next) => {
	console.error('Unhandled error:', err);
	res.status(500).send('An error occurred');
});

// 基本路由
app.get('/', (req, res) => {
	res.send('Hello World!');
});

// 啟動服務器
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
	console.log(`Server is running on port ${PORT}`);
});

// 導出app
module.exports = app;

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
