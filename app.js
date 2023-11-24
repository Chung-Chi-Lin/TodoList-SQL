require('dotenv').config();
const express = require('express');
const cors = require('cors');
const sql = require('mssql');
const app = express();

// 连接池配置
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

// 创建连接池
const pool = new sql.ConnectionPool(dbConfig);
const poolConnect = pool.connect();

poolConnect.then(() => {
	console.log('Connected to the database.');
}).catch((err) => {
	console.error('Database connection error:', err);
});

// 中间件
app.use(express.json()); // 解析 JSON 格式的请求体
app.use(cors()); // 启用 CORS

// 导入 todoRoutes 并传递连接池
const todoRoutes = require('./todoRoutes')(pool);

// 使用 Todo 路由
app.use('/api', todoRoutes);

// 基本路由
app.get('/', (req, res) => {
	res.send('Hello World!');
});

// 启动服务器
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
	console.log(`Server is running on port ${PORT}`);
});

module.exports = app; // 导出 app 以便在其他文件中使用
