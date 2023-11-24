const express = require('express');
const bcrypt = require('bcrypt');
const router = express.Router();
const jwt = require('jsonwebtoken');

// 範例: GET 請求 - 獲取所有待辦事項
router.get('/todos', (req, res) => {
	// 待實現: 從資料庫獲取數據
	res.json({ message: '獲取所有待辦事項' });
});

// 用戶登入
router.post('/login', async (req, res) => {
	try {
		const { username, password } = req.body;

		// 從資料庫中查找用戶
		const result = await sql.query`SELECT * FROM Users WHERE Username = ${username}`;
		const userFromDb = result.recordset[0];

		if (userFromDb) {
			const isValid = await bcrypt.compare(password, userFromDb.PasswordHash);

			if (isValid) {
				const token = jwt.sign({ UserId: userFromDb.UserId, username: username }, process.env.JWT_SECRET, { expiresIn: '1h' });
				res.json({ token });
			} else {
				res.status(401).send('認證失敗');
			}
		} else {
			res.status(400).send('用戶不存在');
		}
	} catch (err) {
		res.status(500).send(err.message);
	}
});

// 註冊用戶
router.post('/register', async (req, res) => {
	try {
		const { username, password } = req.body;
		const hashedPassword = await bcrypt.hash(password, 10);

		// 插入用戶到資料庫
		const result = await sql.query`INSERT INTO Users (Username, PasswordHash) VALUES (${username}, ${hashedPassword})`;

		res.status(201).send('用戶註冊成功');
	} catch (err) {
		res.status(500).send(err.message);
	}
});

// POST 請求 - 創建新的待辦事項
router.post('/todos', async (req, res) => {
	try {
		const { title, description, due_date } = req.body;
		// 在資料庫中插入新的待辦事項
		const result = await sql.query(`INSERT INTO Todos (title, description, due_date) VALUES ('${title}', '${description}', '${due_date}')`);
		res.json({ message: '待辦事項創建成功', todo: result.recordset });
	} catch (err) {
		res.status(500).send(err.message);
	}
});

// GET 請求 - 獲取所有待辦事項
router.get('/todos', authenticateToken, async (req, res) => {
	try {
		const result = await sql.query('SELECT * FROM Todos');
		res.json(result.recordset);
	} catch (err) {
		res.status(500).send(err.message);
	}
});

// PUT 請求 - 更新特定的待辦事項
router.put('/todos/:id', async (req, res) => {
	try {
		const { id } = req.params;
		const { title, description, due_date, is_completed } = req.body;
		// 在資料庫中更新待辦事項
		await sql.query(`UPDATE Todos SET title = '${title}', description = '${description}', due_date = '${due_date}', is_completed = ${is_completed} WHERE id = ${id}`);
		res.json({ message: '待辦事項更新成功' });
	} catch (err) {
		res.status(500).send(err.message);
	}
});

// DELETE 請求 - 刪除特定的待辦事項
router.delete('/todos/:id', async (req, res) => {
	try {
		const { id } = req.params;
		// 在資料庫中刪除待辦事項
		await sql.query(`DELETE FROM Todos WHERE id = ${id}`);
		res.json({ message: '待辦事項刪除成功' });
	} catch (err) {
		res.status(500).send(err.message);
	}
});

function authenticateToken(req, res, next) {
	const authHeader = req.headers['authorization'];
	const token = authHeader && authHeader.split(' ')[1];

	if (token == null) return res.sendStatus(401);

	jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
		if (err) return res.sendStatus(403);
		req.user = user;
		next();
	});
}

module.exports = router;
