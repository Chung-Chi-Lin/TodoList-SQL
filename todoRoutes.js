const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

module.exports = function(pool) {
	const router = express.Router();

  // 驗證token函式
	function authenticateToken(req, res, next) {
		const authHeader = req.headers['authorization'];

		if (!authHeader) return res.sendStatus(401); // 如果沒有授權頭，返回401

		const token = authHeader.split(' ')[1];

		if (!token) return res.sendStatus(401); // 如果token為null，返回401

		jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
			if (err) {
				console.error(`Token verification error: ${err.message}`); // 日誌輸出token驗證錯誤
				return res.sendStatus(403); // 如果token無效，返回403
			}

			req.user = user; // 將解碼後的用戶信息添加到req對象
			next(); // 繼續下一個middleware
		});
	};

	// 共用的 executeSQL 函数
	async function executeSQL(pool, query, params) {
		try {
			const request = pool.request();
			for (const param in params) {
				request.input(param, params[param]);
			}
			const result = await request.query(query);
			return result;
		} catch (err) {
			console.error('SQL Error:', err);
			throw err;
		}
	}
  // GET 請求 - 驗證 Line ID 並返回對應的用戶資料
	router.get('/check-line-id', async (req, res) => {
		try {
			const lineId = req.query.lineId;
			const result = await executeSQL(pool, "SELECT * FROM users WHERE line_user_id = @line_user_id", { line_user_id: lineId });

			if (result.recordset.length > 0) {
				// 找到匹配的 Line ID，返回相關資料
				const userData = result.recordset[0];
				res.json({
					found: true,
					message: 'Line ID 驗證成功',
					userInfo: {
						lineUserId: userData.line_user_id,
						lineUserName: userData.line_user_name,
						lineUserType: userData.line_user_type,
						lineUserDriver: userData.line_user_driver
					}
				});
			} else {
				// 沒找到匹配的 Line ID
				res.json({ found: false, message: 'Line ID 不存在' });
			}
		} catch (err) {
			console.error('SQL Error:', err);
			res.status(500).send('伺服器錯誤');
		}
	});
	// 註冊
	router.post('/register', async (req, res) => {
		try {
			const { email, name, userType, password } = req.body;

			// 驗證輸入（這裡只是示例，您需要根據您的實際要求進行擴展）
			if (!email || !name || !userType || !password) {
				return res.status(400).json({ message: '缺少必要的註冊資訊' });
			}

			// 雜湊密碼
			const passwordHash = await bcrypt.hash(password, 10);

			// 儲存用戶資料
			const result = await executeSQL(pool,
					'INSERT INTO users_by_pick_time (user_name, password_hash, Email, user_type) VALUES (@name, @passwordHash, @email, @userType)',
					{ name, passwordHash, email, userType }
			);

			// 如果 result 顯示資料插入成功，返回成功訊息
			res.status(201).json({ message: '註冊成功' });
		} catch (err) {
			// 如果捕獲到錯誤，返回錯誤訊息
			console.error('註冊錯誤:', err);
			res.status(500).json({ message: '註冊過程中出現錯誤' });
		}
	});
	// 登入
	router.post('/login', async (req, res) => {
		try {
			const { email, password } = req.body;

			// 从数据库中查找匹配的 Email
			const result = await executeSQL(pool, "SELECT * FROM users_by_pick_time WHERE email = @email", { email: email });

			const userFromDb = result.recordset[0];
			if (userFromDb) {
				const isValid = await bcrypt.compare(password, userFromDb.PasswordHash);
				if (isValid) {
					// 在令牌中加入用户 ID 和 用戶類型
					const token = jwt.sign(
							{
								UserId: userFromDb.UserId,
								email: email,
								userType: userFromDb.userType // 假设您的数据库中有这个字段
							},
							process.env.JWT_SECRET,
							{ expiresIn: '1d' }
					);
					console.log(userFromDb)
					// 返回 token 和必要的用户信息
					res.json({
						token: token,
						userInfo: {
							userName: userFromDb.userName,
							email: email,
							userType: userFromDb.userType // 同上
						}
					});
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

	// ==============================================================================================================
  // 測試: GET 請求 - 獲取所有待辦事項
	// router.get('/', (req, res) => {
	// 	res.json({ message: '獲取所有待辦事項' });
	// });
	//
	// // 註冊用户
	// router.post('/register', async (req, res) => {
	// 	try {
	// 		const { username, password } = req.body;
	// 		const hashedPassword = await bcrypt.hash(password, 10);
	//
	// 		const result = await executeSQL(
	// 				pool,
	// 				'INSERT INTO Users (Username, PasswordHash) VALUES (@username, @password)',
	// 				{ username: username, password: hashedPassword }
	// 		);
	//
	// 		res.status(201).send('註冊成功');
	// 	} catch (err) {
	// 		console.error(err);
	// 		res.status(500).send('註冊失敗');
	// 	}
	// });
	//
	// // 用戶登入
	// router.post('/login', async (req, res) => {
	// 	try {
	// 		const { username, password } = req.body;
	// 		const result = await executeSQL(pool, "SELECT * FROM Users WHERE Username = @username", { username: username });
	//
	// 		const userFromDb = result.recordset[0];
	// 		if (userFromDb) {
	// 			const isValid = await bcrypt.compare(password, userFromDb.PasswordHash);
	// 			if (isValid) {
	// 				const token = jwt.sign({ UserId: userFromDb.UserId, username: username }, process.env.JWT_SECRET, { expiresIn: '1d' });
	// 				res.json({ token });
	// 			} else {
	// 				res.status(401).send('認證失敗');
	// 			}
	// 		} else {
	// 			res.status(400).send('用戶不存在');
	// 		}
	// 	} catch (err) {
	// 		res.status(500).send(err.message);
	// 	}
	// });
	//
  // // GET 請求 - 獲取當前用戶的所有待辦事項
	// router.get('/todos', authenticateToken, async (req, res) => {
	// 	try {
	// 		// 確保連接池已連接
	// 		await pool.connect();
	//
	// 		// 使用當前用戶的 ID 從數據庫中獲取待辦事項
	// 		const result = await executeSQL(pool, "SELECT * FROM TodoTable WHERE UserId = @UserId", { UserId: req.user.UserId });
	//
	// 		if (result.recordset.length > 0) {
	// 			res.json(result.recordset);
	// 		} else {
	// 			res.status(404).json({ message: '沒有找到待辦事項' });
	// 		}
	// 	} catch (err) {
	// 		res.status(500).send(err.message);
	// 	}
	// });
	//
  // // POST 請求 - 創建新的待辦事項
	// router.post('/todos', authenticateToken, async (req, res) => {
	// 	try {
	// 		const { title, description, due_date } = req.body;
	// 		const userId = req.user.UserId; // 从验证后的token中获取用户ID
	// 		const nowUtc = new Date();
	// 		const taiwanTime = new Date(nowUtc.getTime() + (8 * 60 * 60 * 1000));
	// 		const currentTimeForSQL = taiwanTime.toISOString().replace('T', ' ').slice(0, 19);
	// 		// 使用 executeSQL 函数插入新的待办事项到数据库
	// 		const insertResult = await executeSQL(
	// 				pool,
	// 				`INSERT INTO TodoTable (UserId, Title, Description, DueDate, Completed, CreateTime, UpdateTime)
	// 		 OUTPUT INSERTED.id
	// 		 VALUES (@UserId, @Title, @Description, @DueDate, @Completed, @CreateTime, @UpdateTime)`,
	// 				{
	// 					UserId: userId,
	// 					Title: title,
	// 					Description: description,
	// 					DueDate: due_date,
	// 					Completed: 0, // 0 表示未完成
	// 					CreateTime: currentTimeForSQL,
	// 					UpdateTime: currentTimeForSQL
	// 				}
	// 		);
	// 		if (insertResult.recordset && insertResult.recordset.length > 0) {
	// 			// 取得插入的 id
	// 			const insertedId = insertResult.recordset[0].id;
	// 			res.status(201).json({ message: '待辦事項新增成功', todoId: insertedId });
	// 		} else {
	// 			// 如果沒有返回 id，可能是因為 OUTPUT 子句沒有正確使用
	// 			console.log('Insert ID was not returned');
	// 			res.status(500).send('新增待辦失敗');
	// 		}
	// 	} catch (err) {
	// 		console.error('SQL Error:', err);
	// 		res.status(500).send('新增待辦失敗');
	// 	}
	// });
	//
  // // PUT 請求 - 更新特定的待辦事項
	// router.put('/todos/:id', authenticateToken, async (req, res) => {
	// 	try {
	//
	// 		const { id } = req.params;
	// 		const { title, description, due_date, is_completed } = req.body;
	// 		const nowUtc = new Date();
	// 		const taiwanTime = new Date(nowUtc.getTime() + (8 * 60 * 60 * 1000));
	// 		const currentTimeForSQL = taiwanTime.toISOString().replace('T', ' ').slice(0, 19);
	//
	// 		const updateResult = await executeSQL(
	// 				pool,
	// 				`UPDATE TodoTable
  //            SET Title = @Title, Description = @Description, DueDate = @DueDate,
  //                Completed = @Completed, UpdateTime = @UpdateTime
  //            WHERE id = @Id AND UserId = @UserId`,
	// 				{
	// 					Id: id,
	// 					UserId: req.user.UserId,
	// 					Title: title,
	// 					Description: description,
	// 					DueDate: due_date,
	// 					Completed: is_completed ? 1 : 0,
	// 					UpdateTime: currentTimeForSQL
	// 				}
	// 		);
	// 		if (updateResult.rowsAffected[0] > 0) {
	// 			res.json({ message: '待辦事項更新成功' });
	// 		} else {
	// 			res.status(404).json({ message: '更新失敗' });
	// 		}
	// 	} catch (err) {
	// 		console.error('SQL Error:', err);
	// 		res.status(500).send('更新時發生錯誤');
	// 	}
	// });
	//
  // // DELETE 請求 - 刪除特定的待辦事項
	// router.delete('/todos/:id', authenticateToken, async (req, res) => {
	// 	try {
	// 		const { id } = req.params;
	// 		await executeSQL(pool, `DELETE FROM TodoTable WHERE id = ${id}`);
	// 		res.json({ message: '待辦事項刪除成功' });
	// 	} catch (err) {
	// 		res.status(500).send(err.message);
	// 	}
	// });

	return router;
};
