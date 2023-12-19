const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

module.exports = function (pool) {
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
			const [rows, fields] = await pool.execute(query, params);
			return rows;
		} catch (err) {
			console.error('SQL Error:', err);
			throw err;
		}
	}

	// GET 請求 - 驗證 Line ID 並返回對應的用戶資料
	router.get('/check-line-id', async (req, res) => {
		try {
			const lineId = req.query.lineId;
			const result = await executeSQL(pool, "SELECT * FROM users WHERE line_user_id = ?", [lineId]);
			if (result.length > 0) {
				// 找到匹配的 Line ID，返回相關資料
				const userData = result[0];
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
				res.json({found: false, message: 'Line ID 不存在'});
			}
		} catch (err) {
			console.error('SQL Error:', err);
			res.status(500).send('伺服器錯誤');
		}
	});
	// 註冊
	router.post('/users/register', async (req, res) => {
		try {
			const { email, name, userType, password, lineId } = req.body;
			if (!email || !name || !userType || !password || !lineId) {
				return res.status(400).json({ message: '缺少必要的註冊資訊' });
			}
			const passwordHash = await bcrypt.hash(password, 10);
			const result = await executeSQL(pool, 'INSERT INTO users_by_pick_time (user_name, password_hash, email, user_type, line_id) VALUES (?, ?, ?, ?, ?)', [name, passwordHash, email, userType, lineId]);
			res.status(201).json({ message: '註冊成功' });
		} catch (err) {
			console.error('註冊錯誤:', err);
			res.status(500).json({ message: '註冊過程中出現錯誤' });
		}
	});
	// 登入
	router.post('/users/login', async (req, res) => {
		try {
			const { email, password } = req.body;
			const result = await executeSQL(pool, 'SELECT * FROM users_by_pick_time WHERE email = ?', [email]);
			const userFromDb = result[0];
			if (userFromDb) {
				const isValid = await bcrypt.compare(password, userFromDb.password_hash);

				if (isValid) {
					const token = jwt.sign({ userName: userFromDb.user_name, email: email, userType: userFromDb.user_type }, process.env.JWT_SECRET, { expiresIn: '1d' });
					res.status(200).send({ token: token, userInfo: { userName: userFromDb.user_name, email: email, userType: userFromDb.user_type } });
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
	// 登出
	router.post('/users/sign_out', (req, res) => {
		const token = req.headers.authorization.split(' ')[1];
		// Add token to a revoked list if needed here
		res.status(200).json({ message: '成功登出' });
	});
	// 取得對應費用
	router.post('/fare/get_fare', authenticateToken, async (req, res) => {
		try {
			const { email } = req.user; // 注意，這裡我們使用 req.user.email 而不是 req.body.email，因為 authenticateToken 中間件應該已經提供了驗證過的使用者資料。

			// 從 users_by_pick_time 表中查找對應的 email
			let result = await executeSQL(pool, "SELECT line_id FROM users_by_pick_time WHERE email = ?", [email]);

			if (result.length > 0) {
				// const { line_id } = result[0];
				const line_id = "U584d30a02b64fef171c8a137744aa09e";

				// 使用 MySQL 的日期函數來獲取當月及過去一個月的數據
				const fareResult = await executeSQL(pool, `
					SELECT * FROM fare 
					WHERE line_user_id = ? 
						AND (
							YEAR(update_time) > YEAR(CURRENT_DATE - INTERVAL 1 MONTH)
							OR 
							(YEAR(update_time) = YEAR(CURRENT_DATE - INTERVAL 1 MONTH) 
							 AND MONTH(update_time) >= MONTH(CURRENT_DATE - INTERVAL 1 MONTH))
						);
				`, [line_id]);

				const fareCountResult = await executeSQL(pool, `
					SELECT * FROM fare_count 
					WHERE line_user_id = ? 
						AND (
							YEAR(update_time) > YEAR(CURRENT_DATE - INTERVAL 1 MONTH)
							OR 
							(YEAR(update_time) = YEAR(CURRENT_DATE - INTERVAL 1 MONTH) 
							 AND MONTH(update_time) >= MONTH(CURRENT_DATE - INTERVAL 1 MONTH))
						);
				`, [line_id]);

				// 返回最終結果
				res.json({
					found: true,
					message: '資料查找成功',
					fareData: {
						fare: fareResult,
						fareCount: fareCountResult
					}
				});
			} else {
				res.status(404).json({ found: false, message: 'Email 不存在或未綁定 Line ID' });
			}
		} catch (err) {
			console.error('SQL Error:', err);
			res.status(500).send('伺服器錯誤');
		}
	});
	// 加入匯款紀錄
	router.post('/fare/add_fare', authenticateToken, async (req, res) => {
		try {
			const { email, userFare } = req.body;

			// 檢查 email 和 userFare 是否提供
			if (!email || !userFare) {
				return res.status(400).json({ message: '缺少必要的資訊' });
			}

			// 從 users_by_pick_time 表中查找對應的 email 以獲取 line_id
			const userResult = await executeSQL(pool, "SELECT line_id FROM users_by_pick_time WHERE email = ?", [email]);

			if (userResult.length > 0) {
				// const line_id = userResult[0].line_id;
				const line_id = "U584d30a02b64fef171c8a137744aa09e";
				// 檢查當前月份是否已有記錄
				const currentMonth = new Date().toISOString().slice(0, 7); // 格式為 'YYYY-MM'
				const fareResult = await executeSQL(pool, "SELECT * FROM fare WHERE line_user_id = ? AND DATE_FORMAT(update_time, '%Y-%m') = ?", [line_id, currentMonth]);

				if (fareResult.length > 0) {
					// 更新現有記錄
					const updateResult = await executeSQL(pool, "UPDATE fare SET user_fare = ?, update_time = CURRENT_TIMESTAMP WHERE line_user_id = ? AND DATE_FORMAT(update_time, '%Y-%m') = ?", [userFare, line_id, currentMonth]);
					res.status(200).json({ message: '本月金額已更新' });
				} else {
					// 插入新記錄
					const insertResult = await executeSQL(pool, "INSERT INTO fare (line_user_id, user_fare, update_time) VALUES (?, ?, CURRENT_TIMESTAMP)", [line_id, userFare]);
					res.status(201).json({ message: '金額已成功添加' });
				}
			} else {
				res.status(404).json({ message: '找不到對應的用戶' });
			}
		} catch (err) {
			console.error('處理匯款記錄錯誤:', err);
			res.status(500).json({ message: '處理匯款記錄過程中出現錯誤' });
		}
	});
	// 獲取開車時間
	router.get('/driver_dates', authenticateToken, async (req, res) => {
		try {
			const { email } = req.user;
			const month = req.query.month; // 從查詢參數中獲取月份類型

			// 從 users_by_pick_time 表中查找對應的 email
			const userResult = await executeSQL(pool, "SELECT line_id FROM users_by_pick_time WHERE email = ?", [email]);

			// 初始化返回結果
			const response = {
				drive: null,
				notDrive: null
			};

			if (userResult.length > 0) {
				const line_id = userResult[0].line_id;
				const currentDate = new Date();
				let queryDate = currentDate;

				// 根據查詢參數調整查詢日期
				if (month === 'last') {
					// 如果是上一個月，將日期設為上個月的第一天
					queryDate = new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1);
				}

				const queryDateString = queryDate.toISOString().slice(0, 7);

				const query = `
                SELECT * FROM driver_dates
                WHERE line_user_driver = ?
                AND start_date BETWEEN ? AND LAST_DAY(?)
            `;

				const params = [line_id, `${queryDateString}-01`, `${queryDateString}-01`];
				const driverDatesResult = await executeSQL(pool, query, params);

				// 分類並處理結果
				if (driverDatesResult.length > 0) {
					response.drive = driverDatesResult.filter(record => record.reverse_type === 1);
					response.notDrive = driverDatesResult.filter(record => record.reverse_type === 0);

					response.drive = response.drive.length > 0 ? response.drive : null;
					response.notDrive = response.notDrive.length > 0 ? response.notDrive : null;
				}
			} else {
				response.message = '找不到對應的用戶';
			}

			res.json(response);
		} catch (err) {
			console.error('查詢 driver_dates 錯誤:', err);
			res.status(500).json({ message: '查詢 driver_dates 過程中出現錯誤' });
		}
	});
	// 獲取搭乘時間
	router.get('/passenger_dates', authenticateToken, async (req, res) => {
		try {
			const { email } = req.user;
			const month = req.query.month; // 從查詢參數中獲取月份類型

			// 從 users_by_pick_time 表中查找對應的 email
			const userResult = await executeSQL(pool, "SELECT line_id FROM users_by_pick_time WHERE email = ?", [email]);

			// 初始化返回結果
			const response = {
				takeRide: null,
				notTakeRide: null
			};

			if (userResult.length > 0) {
				const line_id = userResult[0].line_id;
				const currentDate = new Date();
				let queryDate = currentDate;

				// 根據查詢參數調整查詢日期
				if (month === 'last') {
					// 如果是上一個月，將日期設為上個月的第一天
					queryDate = new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1);
				}

				const queryDateString = queryDate.toISOString().slice(0, 7);

				const query = `
                SELECT * FROM passenger_dates
                WHERE line_user_id = ?
                AND start_date BETWEEN ? AND LAST_DAY(?)
            `;

				const params = [line_id, `${queryDateString}-01`, `${queryDateString}-01`];
				const driverDatesResult = await executeSQL(pool, query, params);

				// 分類並處理結果
				if (driverDatesResult.length > 0) {
					response.takeRide = driverDatesResult.filter(record => record.reverse_type === 1);
					response.notTakeRide = driverDatesResult.filter(record => record.reverse_type === 0);

					response.takeRide = response.takeRide.length > 0 ? response.takeRide : null;
					response.notTakeRide = response.notTakeRide.length > 0 ? response.notTakeRide : null;
				}
			} else {
				response.message = '找不到對應的用戶';
			}

			res.json(response);
		} catch (err) {
			console.error('查詢 driver_dates 錯誤:', err);
			res.status(500).json({ message: '查詢 driver_dates 過程中出現錯誤' });
		}
	});
	// 乘客-搭乘
	router.post('/reserve', authenticateToken, async (req, res) => {
		try {
			const { email } = req.user;
			const { start_date, end_date, reverse_type, note } = req.body;
      // 從 users_by_pick_time 表中查找對應的 email
			const userResult = await executeSQL(pool, "SELECT line_id FROM users_by_pick_time WHERE email = ?", [email]);
			const line_user_id = userResult[0].line_id;
			// 確保所有必要的數據都已提供
			if (!line_user_id || !start_date || !end_date || reverse_type === undefined) {
				return res.status(400).json({ message: '缺少必要的預約資訊' });
			}

			// 格式化日期
			const formattedStartDate = new Date(start_date).toISOString().slice(0, 10); // YYYY-MM-DD
			const formattedEndDate = new Date(end_date).toISOString().slice(0, 10); // YYYY-MM-DD

			// 插入數據庫操作
			const insertQuery = `
            INSERT INTO passenger_dates (line_user_id, start_date, end_date, reverse_type, note)
            VALUES (?, ?, ?, ?, ?)
        `;
			const insertResult = await executeSQL(pool, insertQuery, [line_user_id, formattedStartDate, formattedEndDate, reverse_type, note]);
			// 插入成功後的處理
			if (insertResult) {
				res.status(201).json({ message: '預約已成功提交' });
			} else {
				res.status(500).json({ message: '無法創建預約' });
			}
		} catch (err) {
			console.error('創建預約錯誤:', err);
			res.status(500).json({ message: '創建預約時發生錯誤' });
		}
	});
	// 乘客-刪除搭乘記錄
	router.delete('/passenger_dates/:id', authenticateToken, async (req, res) => {
		try {
			const { id } = req.params;
			// 從 passenger_dates 表中刪除對應的紀錄
			const deleteQuery = `DELETE FROM passenger_dates WHERE id = ?`;
			const deleteResult = await executeSQL(pool, deleteQuery, [id]);
			// 刪除成功後的處理
			if (deleteResult) {
				res.json({ message: '預約記錄已成功刪除' });
			} else {
				res.status(404).json({ message: '未找到該預約記錄，無法刪除' });
			}
		} catch (err) {
			console.error('刪除預約記錄錯誤:', err);
			res.status(500).json({ message: '刪除預約記錄時發生錯誤' });
		}
	});
	return router;
};
