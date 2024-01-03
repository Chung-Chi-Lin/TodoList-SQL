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
			console.log('Executing SQL query:', query, params);
			const request = pool.request();
			for (const param in params) {
				request.input(param, params[param]);
			}
			const result = await request.query(query);
			console.log('SQL query executed successfully', result);
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
			const result = await executeSQL(pool, 'INSERT INTO users_by_pick_time (user_name, password_hash, email, user_type, line_id) VALUES (@user_name, @password_hash, @email, @user_type, @line_id)', { user_name: name, password_hash: passwordHash, email: email, user_type: userType, line_id: lineId });
			res.status(201).json({ message: '註冊成功' });
		} catch (err) {
			console.error('註冊錯誤:', err);
			res.status(500).json({ message: '註冊過程中出現錯誤' });
		}
	});
	// 登入
	router.post('/users/login', async (req, res) => {
		console.log('Login request received', req.body);
		try {
			const { email, password } = req.body;
			const result = await executeSQL(pool, 'SELECT * FROM users_by_pick_time WHERE email = @email', { email });
			const userFromDb = result.recordset[0];
			if (userFromDb) {
				console.log('User found in database', userFromDb);
				const isValid = await bcrypt.compare(password, userFromDb.password_hash);
				console.log('Password comparison result:', isValid);
				if (isValid) {
					console.log('Sending response with token', token);
					const token = jwt.sign({ userName: userFromDb.user_name, email: email, userType: userFromDb.user_type }, process.env.JWT_SECRET, { expiresIn: '1d' });
					res.status(200).send({ token: token, userInfo: { userName: userFromDb.user_name, email: email, userType: userFromDb.user_type } });
				} else {
					console.log('Authentication failed for user', email);
					res.status(401).send('認證失敗');
				}
			} else {
				res.status(400).send('用戶不存在');
			}
		} catch (err) {
			console.error('Error during login:', err);
			res.status(500).send(err.message);
		}
	});
	// 登出
	router.post('/users/sign_out', (req, res) => {
		const token = req.headers.authorization.split(' ')[1];
		// Add token to a revoked list if needed here
		res.status(200).json({ message: '成功登出' });
	});
	// 乘客-取得乘客費用
	router.post('/fare/get_fare', authenticateToken, async (req, res) => {
		try {
			const { email } = req.user;

			// 從 users_by_pick_time 表中查找對應的 email
			let result = await executeSQL(pool, "SELECT line_id FROM users_by_pick_time WHERE email = @email", { email });

			if (result.recordset && result.recordset.length > 0) {
				const { line_id } = result.recordset[0];

				// 使用 SQL Server 的日期函數來獲取當月及過去一個月的數據
				const localTimeQuery = "DATEADD(HOUR, 8, GETDATE())"; // 將伺服器時間轉換為台灣時間
				const fareResult = await executeSQL(pool, `
						SELECT * FROM fare 
						WHERE line_user_id = @line_user_id 
										AND (
														YEAR(update_time) > YEAR(DATEADD(MONTH, -1, ${localTimeQuery}))
														OR 
														(YEAR(update_time) = YEAR(DATEADD(MONTH, -1, ${localTimeQuery})) 
														 AND MONTH(update_time) >= MONTH(DATEADD(MONTH, -1, ${localTimeQuery})))
										);
				`, { line_user_id: line_id });

				const fareCountResult = await executeSQL(pool, `
						SELECT * FROM fare_count 
						WHERE line_user_id = @line_user_id  
										AND (
														YEAR(update_time) > YEAR(DATEADD(MONTH, -1, ${localTimeQuery}))
														OR 
														(YEAR(update_time) = YEAR(DATEADD(MONTH, -1, ${localTimeQuery})) 
														 AND MONTH(update_time) >= MONTH(DATEADD(MONTH, -1, ${localTimeQuery})))
										);
				`, { line_user_id: line_id });

				res.json({
					found: true,
					message: '資料查找成功',
					fareData: {
						fare: fareResult.recordset,
						fareCount: fareCountResult.recordset
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
	async function getMonthlyFare(passenger, isCurrentMonth) {
		let fareResult, fareCountResult;
		const localTimeQuery = "DATEADD(HOUR, 8, GETDATE())"; // 轉換為台灣時間
		let monthCondition = isCurrentMonth ? `MONTH(DATEADD(HOUR, 8, GETDATE()))` : `MONTH(DATEADD(MONTH, -1, DATEADD(HOUR, 8, GETDATE())))`;
		let yearCondition = isCurrentMonth ? `YEAR(DATEADD(HOUR, 8, GETDATE()))` : `YEAR(DATEADD(MONTH, -1, DATEADD(HOUR, 8, GETDATE())))`;

		fareResult = await executeSQL(pool, `
        SELECT user_fare, update_time FROM fare 
        WHERE line_user_id = @line_user_id 
        AND MONTH(update_time) = ${monthCondition} 
        AND YEAR(update_time) = ${yearCondition};
    `, { line_user_id: passenger.line_user_id });

		fareCountResult = await executeSQL(pool, `
        SELECT * FROM fare_count 
        WHERE line_user_id = @line_user_id 
        AND MONTH(update_time) = ${monthCondition} 
        AND YEAR(update_time) = ${yearCondition};
    `, { line_user_id: passenger.line_user_id });

		return {
			name: passenger.line_user_name,
			fare: fareResult.recordset.length > 0 ? fareResult.recordset[0].user_fare : null,
			date: fareResult.recordset.length > 0 ? fareResult.recordset[0].update_time : null,
			fareCount: fareCountResult.recordset.map(fareCount => ({
				id: fareCount.id,
				userFareCount: fareCount.user_fare_count,
				userRemark: fareCount.user_remark,
				date: fareCount.update_time
			}))
		};
	};
	// 乘客-加入匯款紀錄
	router.post('/fare/add_fare', authenticateToken, async (req, res) => {
		try {
			const { email, userFare } = req.body;

			if (!email || !userFare) {
				return res.status(400).json({ message: '缺少必要的資訊' });
			}

			const userResult = await executeSQL(pool, "SELECT line_id FROM users_by_pick_time WHERE email = @email", { email });
			if (userResult.recordset && userResult.recordset.length > 0) {
				const line_id = userResult.recordset[0].line_id;

				// 獲得台灣時間的當前月份
				const currentDateTime = new Date(); // 取得當前時間
				currentDateTime.setHours(currentDateTime.getHours() + 8); // 轉換為台灣時間 (UTC+8)
				const currentMonth = currentDateTime.toISOString().slice(0, 7); // 格式為 'YYYY-MM'

				const fareResult = await executeSQL(pool, "SELECT * FROM fare WHERE line_user_id = @line_user_id AND FORMAT(update_time, 'yyyy-MM') = @currentMonth", { line_user_id: line_id, currentMonth });

				if (fareResult.recordset && fareResult.recordset.length > 0) {
					// 更新現有記錄
					await executeSQL(pool, "UPDATE fare SET user_fare = @userFare, update_time = DATEADD(HOUR, 8, GETDATE()) WHERE line_user_id = @line_user_id AND FORMAT(update_time, 'yyyy-MM') = @currentMonth", { userFare, line_user_id: line_id, currentMonth });
					res.status(200).json({ message: '本月金額已更新' });
				} else {
					// 插入新記錄
					await executeSQL(pool, "INSERT INTO fare (line_user_id, user_fare, update_time) VALUES (@line_user_id, @userFare, DATEADD(HOUR, 8, GETDATE()))", { line_user_id: line_id, userFare });
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
	// 乘客-獲取開車時間
	router.get('/driver_dates', authenticateToken, async (req, res) => {
		try {
			const { email } = req.user;
			const month = req.query.month; // 從查詢參數中獲取月份類型

			const userResult = await executeSQL(pool, "SELECT * FROM users_by_pick_time WHERE email = @email", { email });
			if (userResult.recordset && userResult.recordset.length > 0) {
				const line_id = userResult.recordset[0].line_id;
				const response = { drive: null, notDrive: null };

				const driverResult = await executeSQL(pool, "SELECT * FROM users WHERE line_user_id = @line_user_id", { line_user_id: line_id });

				if (driverResult.recordset && driverResult.recordset[0]) {
					let line_user_id = driverResult.recordset[0].line_user_driver || driverResult.recordset[0].line_user_id;
					const currentDate = new Date();
					currentDate.setHours(currentDate.getHours() + 8); // 轉換為台灣時間 (UTC+8)

					let queryDate = currentDate;
					if (month === 'last') {
						queryDate = new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1);
					}

					const queryDateString = queryDate.toISOString().slice(0, 7);
					const params = { line_user_driver: line_user_id, queryDate: `${queryDateString}-01` };
					const query = `
                    SELECT * FROM driver_dates
                    WHERE line_user_driver = @line_user_driver
                    AND start_date BETWEEN @queryDate AND EOMONTH(@queryDate)
                `;

					const driverDatesResult = await executeSQL(pool, query, params);
					if (driverDatesResult.recordset && driverDatesResult.recordset.length > 0) {
						response.drive = driverDatesResult.recordset.filter(record => record.reverse_type === 1);
						response.notDrive = driverDatesResult.recordset.filter(record => record.reverse_type === 0);

						response.drive = response.drive.length > 0 ? response.drive : null;
						response.notDrive = response.notDrive.length > 0 ? response.notDrive : null;
					}
				} else {
					response.message = '找不到對應的用戶';
				}
				res.json(response);
			} else {
				res.status(404).json({ message: '找不到對應的用戶' });
			}
		} catch (err) {
			console.error('查詢 driver_dates 錯誤:', err);
			res.status(500).json({ message: '查詢 driver_dates 過程中出現錯誤' });
		}
	});
	// 乘客-獲取搭乘時間
	router.get('/passenger_dates', authenticateToken, async (req, res) => {
		try {
			const { email } = req.user;
			const month = req.query.month; // 從查詢參數中獲取月份類型

			const userResult = await executeSQL(pool, "SELECT line_id FROM users_by_pick_time WHERE email = @email", { email });

			const response = { takeRide: null, notTakeRide: null };

			if (userResult.recordset && userResult.recordset.length > 0) {
				const line_id = userResult.recordset[0].line_id;
				const currentDate = new Date();
				currentDate.setHours(currentDate.getHours() + 8); // 轉換為台灣時間 (UTC+8)

				let queryDate = currentDate;
				if (month === 'last') {
					queryDate = new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1);
				}

				const queryDateString = queryDate.toISOString().slice(0, 7);
				const params = { line_user_id: line_id, queryDate: `${queryDateString}-01` };
				const query = `
                SELECT * FROM passenger_dates
                WHERE line_user_id = @line_user_id
                AND start_date BETWEEN @queryDate AND EOMONTH(@queryDate)
            `;

				const passengerDatesResult = await executeSQL(pool, query, params);

				if (passengerDatesResult.recordset && passengerDatesResult.recordset.length > 0) {
					response.takeRide = passengerDatesResult.recordset.filter(record => record.reverse_type === 1);
					response.notTakeRide = passengerDatesResult.recordset.filter(record => record.reverse_type === 0);

					response.takeRide = response.takeRide.length > 0 ? response.takeRide : null;
					response.notTakeRide = response.notTakeRide.length > 0 ? response.notTakeRide : null;
				}
			} else {
				response.message = '找不到對應的用戶';
			}

			res.json(response);
		} catch (err) {
			console.error('查詢 passenger_dates 錯誤:', err);
			res.status(500).json({ message: '查詢 passenger_dates 過程中出現錯誤' });
		}
	});
	// 司機-預約開車
	router.post('/driver_reserve', authenticateToken, async (req, res) => {
		try {
			const { email } = req.user;
			const { start_date, end_date, reverse_type, note, pass_limit } = req.body;
			const userResult = await executeSQL(pool, "SELECT line_id FROM users_by_pick_time WHERE email = @email", { email });

			if (!userResult.recordset.length || !start_date || !end_date || reverse_type === undefined) {
				return res.status(400).json({ message: '缺少必要的預約資訊' });
			}

			const line_user_id = userResult.recordset[0].line_id;
			const currentMonth = new Date(start_date).toISOString().slice(0, 7);

			if (reverse_type === 1) {
				const params = { line_user_driver: line_user_id, currentMonth: `${currentMonth}%` };
				const checkResult = await executeSQL(pool, `
                SELECT id FROM driver_dates 
                WHERE line_user_driver = @line_user_driver AND reverse_type = 1 
                AND start_date LIKE @currentMonth
            `, params);

				if (checkResult.recordset.length) {
					const updateId = checkResult.recordset[0].id;
					await executeSQL(pool, `
                    UPDATE driver_dates 
                    SET start_date = @start_date, end_date = @end_date, reverse_type = @reverse_type, note = @note, pass_limit = @pass_limit
                    WHERE id = @updateId
                `, { start_date, end_date, reverse_type, note, pass_limit, updateId });
					res.json({ message: '當月搭乘時間已更新', id: updateId });
				} else {
					await executeSQL(pool, `
                    INSERT INTO driver_dates (line_user_driver, start_date, end_date, reverse_type, note, pass_limit)
                    VALUES (@line_user_driver, @start_date, @end_date, @reverse_type, @note, @pass_limit)
                `, { line_user_driver: line_user_id, start_date, end_date, reverse_type, note, pass_limit });
					// 回傳新增記錄的ID
					res.json({ message: '新的搭乘時間已添加', status: 'success' });
				}
			} else if (reverse_type === 0) {
				const params = { line_user_driver: line_user_id, start_date, end_date };
				const checkResult = await executeSQL(pool, `
                SELECT id FROM driver_dates 
                WHERE line_user_driver = @line_user_driver AND reverse_type = 0 
                AND NOT (end_date < @start_date OR start_date > @end_date)
            `, params);

				for (const record of checkResult.recordset) {
					await executeSQL(pool, `DELETE FROM driver_dates WHERE id = @id`, { id: record.id });
				}

				await executeSQL(pool, `
                INSERT INTO driver_dates (line_user_driver, start_date, end_date, reverse_type, note)
                VALUES (@line_user_driver, @start_date, @end_date, @reverse_type, @note)
            `, { line_user_driver: line_user_id, start_date, end_date, reverse_type, note });
				// 回傳新增記錄的ID
				res.json({ message: '新的不搭乘時間已添加', status: 'success' });
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

			const deleteQuery = `DELETE FROM fare_count WHERE id = @id`;
			const deleteResult = await executeSQL(pool, deleteQuery, { id });

			// 判斷是否成功刪除
			if (deleteResult.rowsAffected > 0) {
				res.json({ message: '費用調整記錄已成功刪除' });
			} else {
				res.status(404).json({ message: '未找到該費用調整記錄，無法刪除' });
			}
		} catch (err) {
			console.error('刪除費用調整記錄錯誤:', err);
			res.status(500).json({ message: '刪除費用調整記錄時發生錯誤' });
		}
	});
	// 司機-取得司機名下乘客費用
	router.post('/fare/get_driver_passenger_fares', authenticateToken, async (req, res) => {
		try {
			const { email } = req.user;

			let driverResult = await executeSQL(pool, "SELECT line_id FROM users_by_pick_time WHERE email = @email", { email });
			if (driverResult.recordset && driverResult.recordset.length > 0) {
				const { line_id } = driverResult.recordset[0];

				let passengersResult = await executeSQL(pool, "SELECT line_user_id, line_user_name FROM users WHERE line_user_driver = @line_user_driver", { line_user_driver: line_id });

				let currentMonthFares = [];
				let previousMonthFares = [];

				for (const passenger of passengersResult.recordset) {
					let currentMonthFare = await getMonthlyFare(passenger, true); // 獲取當月 fare
					let previousMonthFare = await getMonthlyFare(passenger, false); // 獲取上月 fare

					currentMonthFares.push(currentMonthFare);
					previousMonthFares.push(previousMonthFare);
				}

				res.json({
					found: true,
					message: '資料查找成功',
					passengersResult: passengersResult.recordset,
					currentMonthFares: currentMonthFares,
					previousMonthFares: previousMonthFares
				});
			} else {
				res.status(404).json({ found: false, message: 'Email 不存在或未綁定 Line ID' });
			}
		} catch (err) {
			console.error('SQL Error:', err);
			res.status(500).send('伺服器錯誤');
		}
	});
	// 司機-刪除費用調整記錄
	router.delete('/fare_count/:id', authenticateToken, async (req, res) => {
		try {
			const { id } = req.params;
			// 從 fare_count 表中刪除對應的紀錄
			const deleteQuery = `DELETE FROM fare_count WHERE id = @id`;
			const deleteResult = await executeSQL(pool, deleteQuery, { id });

			// 判斷是否成功刪除
			if (deleteResult.rowsAffected > 0) {
				res.json({ message: '費用調整記錄已成功刪除' });
			} else {
				res.status(404).json({ message: '未找到該費用調整記錄，無法刪除' });
			}
		} catch (err) {
			console.error('刪除費用調整記錄錯誤:', err);
			res.status(500).json({ message: '刪除費用調整記錄時發生錯誤' });
		}
	});
	// 司機-新增搭乘費用紀錄
	router.post('/fare/add_fare_count', authenticateToken, async (req, res) => {
		try {
			const { userId, userRemark, fareAmount, date } = req.body;

			// 向 fare_count 表中插入數據
			const insertQuery = `INSERT INTO fare_count (line_user_id, user_fare_count, user_remark, update_time) VALUES (@userId, @fareAmount, @userRemark, @date)`;
			await executeSQL(pool, insertQuery, { userId, fareAmount, userRemark, date });

			res.json({ message: '搭乘費用紀錄已成功新增' });
		} catch (err) {
			console.error('新增搭乘費用紀錄錯誤:', err);
			res.status(500).json({ message: '新增搭乘費用紀錄時發生錯誤' });
		}
	});
	// 司機-刪除開車紀錄
	router.delete('/driver_dates/:id', authenticateToken, async (req, res) => {
		try {
			const { id } = req.params;
			// 從 driver_dates 表中刪除對應的紀錄
			const deleteQuery = `DELETE FROM driver_dates WHERE id = @id`;
			const deleteResult = await executeSQL(pool, deleteQuery, { id });

			// 判斷是否成功刪除
			if (deleteResult.rowsAffected > 0) {
				res.json({ message: '登記時間記錄已成功刪除' });
			} else {
				res.status(404).json({ message: '未找到該登記時間記錄，無法刪除' });
			}
		} catch (err) {
			console.error('刪除登記時間記錄錯誤:', err);
			res.status(500).json({ message: '刪除登記時間記錄時發生錯誤' });
		}
	});
	// 司機-取得名下乘客搭乘紀錄
	// 司機-取得名下乘客搭乘紀錄
	router.get('/driver_passenger_dates', authenticateToken, async (req, res) => {
		try {
			const { email } = req.user;

			const driverResult = await executeSQL(pool, "SELECT line_id FROM users_by_pick_time WHERE email = @email", { email });
			if (driverResult.recordset.length > 0) {
				const line_user_driver = driverResult.recordset[0].line_id;
				const passengersResult = await executeSQL(pool, "SELECT line_user_id, line_user_name FROM users WHERE line_user_driver = @line_user_driver", { line_user_driver });

				const passengerData = [];
				const currentDate = new Date();
				currentDate.setHours(currentDate.getHours() + 8); // 轉換為台灣時間 (UTC+8)
				const currentMonth = currentDate.toISOString().slice(0, 7);

				for (const passenger of passengersResult.recordset) {
					const params = { line_user_id: passenger.line_user_id, currentMonth: `${currentMonth}-01` };
					const query = `
                    SELECT * FROM passenger_dates
                    WHERE line_user_id = @line_user_id
                    AND start_date BETWEEN @currentMonth AND EOMONTH(@currentMonth)
                `;
					const datesResult = await executeSQL(pool, query, params);

					const takeRide = datesResult.recordset.filter(record => record.reverse_type === 1);
					const notTakeRide = datesResult.recordset.filter(record => record.reverse_type === 0);

					passengerData.push({
						name: passenger.line_user_name,
						takeRide: takeRide.length > 0 ? takeRide : null,
						notTakeRide: notTakeRide.length > 0 ? notTakeRide : null
					});
				}

				res.json({
					found: true,
					message: '資料查找成功',
					passengerData: passengerData
				});
			} else {
				res.status(404).json({ found: false, message: 'Email 不存在或未綁定 Line ID' });
			}
		} catch (err) {
			console.error('查詢司機名下乘客搭乘時間錯誤:', err);
			res.status(500).json({ message: '查詢過程中出現錯誤' });
		}
	});

	return router;
};
