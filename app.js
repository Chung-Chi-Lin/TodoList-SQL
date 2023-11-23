const express = require('express');
const app = express();
// azure sql
const sql = require('mssql');
const path = require('path');

require('dotenv').config();

// 在所有其他路由處理之後
if (process.env.NODE_ENV === 'production') {
	app.use(express.static(path.join(__dirname, '../client/dist')));

	app.get('*', (req, res) => {
		res.sendFile(path.join(__dirname, '../client/dist', 'index.html'));
	});
}

const config =  {
	user: process.env.DB_USER,
	password: process.env.DB_PASSWORD,
	database: process.env.DB_DATABASE,
	server: process.env.DB_SERVER,
	pool: {
		max: 10,
		min: 0,
		idleTimeoutMillis: 30000
	},
	options: {
		encrypt: true, // for azure
		trustServerCertificate: false // change to true for local dev / self-signed certs
	}
};
app.use(express.json());
// 獲取所有待辦事項
app.get('/todos', async (req, res) => {
	try {
		await sql.connect(config);
		const result = await sql.query`SELECT * FROM TodoTable`;
		res.json(result.recordset);
	} catch (err) {
		console.error(err);
		res.status(500).send('Error while fetching todos');
	}
});

// 創建一個新的待辦事項
app.post('/todos', async (req, res) => {
	try {
		const { description } = req.body; // 從請求體中解構待辦事項描述
		await sql.connect(config);
		const result = await sql.query`INSERT INTO TodoTable (Description) VALUES (${description})`;
		res.status(201).send(`Todo created with ID: ${result.recordset.insertId}`);
	} catch (err) {
		console.error(err);
		res.status(500).send('Error while creating todo');
	}
});

// 更新一個現有的待辦事項
app.put('/todos/:id', async (req, res) => {
	try {
		const { id } = req.params;
		const { description, completed } = req.body;
		await sql.connect(config);
		const result = await sql.query`
      UPDATE TodoTable
      SET Description = ${description}, Completed = ${completed}
      WHERE Id = ${id}
    `;
		res.json({ message: 'Todo updated', id });
	} catch (err) {
		console.error(err);
		res.status(500).send('Error while updating todo');
	}
});

// 刪除一個待辦事項
app.delete('/todos/:id', async (req, res) => {
	try {
		const { id } = req.params;
		await sql.connect(config);
		const result = await sql.query`
      DELETE FROM TodoTable
      WHERE Id = ${id}
    `;
		res.json({ message: 'Todo deleted', id });
	} catch (err) {
		console.error(err);
		res.status(500).send('Error while deleting todo');
	}
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
	console.log(`Server is running on port ${port}`);
});

