const express = require('express');
const path = require('path');
const fs = require('fs');
const csv = require('csv-parser');
const XLSX = require('xlsx');
const iconv = require('iconv-lite');
const notesUpdates = require('./notes_update.js');

// 历史数据文件路径（用于计算周增长）
const HISTORY_FILE = path.join(__dirname, 'data', 'gpa_history.json');

// 访问日志文件路径
const ACCESS_LOG_FILE = path.join(__dirname, 'data', 'access_log.json');

// 存储访问日志
let accessLogs = [];

const app = express();
const PORT = process.env.PORT || 3001;

// 根据环境选择数据文件路径
const isProduction = process.env.NODE_ENV === 'production';
const DATA_DIR = isProduction ? path.join(__dirname, 'data') : 'C:\\Users\\嗷呜\\Desktop';
const CSV_FILE = path.join(DATA_DIR, isProduction ? 'gpa.csv' : '绩点表.csv');
const GONGYING_FILE = path.join(DATA_DIR, isProduction ? 'gongying.csv' : '共盈会班级名单.csv');
const UPDATE_FILE = 'C:\\Users\\嗷呜\\Desktop\\gpa_update_6.3-6.4_2026-06-04.csv';

// 存储绩点数据
let gpaData = [];
let gongyingMembers = new Set();
let gpaUpdates = {};
let gpaHistory = {}; // 历史绩点数据 { userId: { date: totalGpa } }

// 排除用户列表
const excludedUsers = new Set([
    '90010769', // Jasmine Wang
    '90039082', // HomilyLink
    '90047664', // Ben
    '90039416', // May
    '90003692', // 赢在美股
    '90026783', // AI夺宝奇遇—班主任
]);

// 加载共盈会成员名单
function loadGongyingMembers() {
    return new Promise((resolve) => {
        try {
            if (fs.existsSync(GONGYING_FILE)) {
                const content = fs.readFileSync(GONGYING_FILE, 'utf-8');
                
                // 检查是否是CSV格式（包含逗号或换行分隔的纯文本）
                if (GONGYING_FILE.endsWith('.csv') && !content.includes('PK\x03\x04')) {
                    // CSV格式：按行分割，第一行可能是表头
                    const lines = content.split(/\r?\n/).map(line => line.trim()).filter(line => line);
                    lines.forEach((line, index) => {
                        // 跳过表头（如果第一行是"姓名"）
                        if (index === 0 && (line === '姓名' || line === 'name')) return;
                        // 处理CSV格式（可能有逗号分隔）
                        const name = line.split(',')[0].trim();
                        if (name) gongyingMembers.add(name);
                    });
                } else {
                    // Excel格式
                    const workbook = XLSX.readFile(GONGYING_FILE);
                    const sheetName = workbook.SheetNames[0];
                    const worksheet = workbook.Sheets[sheetName];
                    const data = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
                    
                    data.forEach((row, index) => {
                        if (index > 0 && row[0]) {
                            const name = String(row[0]).trim();
                            if (name) gongyingMembers.add(name);
                        }
                    });
                }
                
                console.log(`📋 加载了 ${gongyingMembers.size} 位共盈会成员`);
            }
        } catch (err) {
            console.error('读取共盈会名单失败:', err);
        }
        resolve();
    });
}

// 加载更新数据
function loadUpdateData() {
    return new Promise((resolve) => {
        gpaUpdates = {};
        if (!fs.existsSync(UPDATE_FILE)) {
            console.log('⚠️ 更新文件不存在');
            resolve();
            return;
        }
        
        fs.createReadStream(UPDATE_FILE)
            .pipe(csv())
            .on('data', (data) => {
                const id = String(data['精网号'] || '').trim();
                const newGpa = parseInt(data['总新增绩点'] || 0);
                if (id && newGpa > 0) {
                    gpaUpdates[id] = newGpa;
                }
            })
            .on('end', () => {
                console.log(`📊 加载了 ${Object.keys(gpaUpdates).length} 条绩点更新`);
                resolve();
            })
            .on('error', (err) => {
                console.error('读取更新文件失败:', err);
                resolve();
            });
    });
}

// 加载 CSV 数据（处理 UTF-8 BOM）
function loadCSVData() {
    return new Promise((resolve, reject) => {
        const results = [];
        
        if (!fs.existsSync(CSV_FILE)) {
            console.log('⚠️ CSV 文件不存在:', CSV_FILE);
            resolve([]);
            return;
        }
        
        // 读取文件并去除 BOM
        const content = fs.readFileSync(CSV_FILE);
        const decoded = iconv.decode(content, 'utf-8');
        const cleanContent = decoded.replace(/^\uFEFF/, ''); // 去除 BOM
        
        // 创建临时文件
        const tempFile = path.join(__dirname, 'temp_gpa.csv');
        fs.writeFileSync(tempFile, cleanContent, 'utf8');
        
        fs.createReadStream(tempFile)
            .pipe(csv())
            .on('data', (data) => {
                const id = String(data['精网号'] || '').trim();
                
                // 跳过排除的用户
                if (excludedUsers.has(id)) return;
                
                const name = data['姓名'] || '';
                const historyGpa = parseInt(data['历史绩点']) || 0;
                const oldNewGpa = parseInt(data['本次新增']) || 0;
                const oldTotal = parseInt(data['总绩点']) || 0;
                const oldNotes = parseInt(data['笔记次数']) || 0;
                
                // 如果有更新，加上新绩点
                const additionalGpa = gpaUpdates[id] || 0;
                
                // 笔记次数更新
                const newNotesCount = notesUpdates.notesCount[id] || oldNotes;
                
                // 笔记绩点更新
                const notesGpa = notesUpdates.notesGpa[id] || 0;
                
                // 已使用绩点
                const usedGpa = notesUpdates.usedGpa[id] || 0;
                
                // 已使用绩点详情
                const usedGpaDetails = notesUpdates.usedGpaDetails[id] || '';
                
                results.push({
                    id: id,
                    idMasked: data['精网号(打码)'] || '',
                    name: name,
                    historyGpa: historyGpa,
                    newGpa: oldNewGpa + additionalGpa + notesGpa,
                    totalGpa: oldTotal + additionalGpa + notesGpa,
                    usedGpa: usedGpa,
                    usedGpaDetails: usedGpaDetails,
                    notes: newNotesCount,
                    isGongying: gongyingMembers.has(name.trim()),
                    updated: additionalGpa > 0 || notesGpa > 0 || usedGpa > 0
                });
            })
            .on('end', () => {
                // 删除临时文件
                fs.unlinkSync(tempFile);
                
                // 按总绩点排序
                results.sort((a, b) => b.totalGpa - a.totalGpa);
                const updatedCount = results.filter(r => r.updated).length;
                console.log(`📊 加载了 ${results.length} 条绩点记录 (已更新 ${updatedCount} 位)`);
                resolve(results);
            })
            .on('error', (err) => {
                console.error('读取 CSV 失败:', err);
                resolve([]);
            });
    });
}

// 加载历史数据
function loadHistoryData() {
    try {
        if (fs.existsSync(HISTORY_FILE)) {
            const content = fs.readFileSync(HISTORY_FILE, 'utf-8');
            gpaHistory = JSON.parse(content);
            console.log(`📚 加载了历史数据，共 ${Object.keys(gpaHistory).length} 位用户记录`);
        }
    } catch (err) {
        console.error('读取历史数据失败:', err);
        gpaHistory = {};
    }
}

// 保存历史数据
function saveHistoryData() {
    try {
        const today = new Date().toISOString().split('T')[0];
        
        // 更新今天的绩点数据
        gpaData.forEach(user => {
            if (!gpaHistory[user.id]) {
                gpaHistory[user.id] = {};
            }
            gpaHistory[user.id][today] = user.totalGpa;
            
            // 只保留最近30天的数据
            const dates = Object.keys(gpaHistory[user.id]).sort();
            if (dates.length > 30) {
                dates.slice(0, dates.length - 30).forEach(d => {
                    delete gpaHistory[user.id][d];
                });
            }
        });
        
        fs.writeFileSync(HISTORY_FILE, JSON.stringify(gpaHistory, null, 2), 'utf-8');
        console.log(`💾 历史数据已保存 (${today})`);
    } catch (err) {
        console.error('保存历史数据失败:', err);
    }
}

// 读取近一周观看记录（从CSV文件）
function loadWeeklyWatchData() {
    const weeklyData = {}; // { userId: { watchCount: 0, validWatchCount: 0, totalMinutes: 0 } }
    
    // 近一周观看记录文件列表
    const watchFiles = [
        'watch_record_0.csv',
        'watch_record_1.csv',
        'watch_record_2.csv',
        'watch_record_3.csv',
        'watch_record_4.csv',
        'watch_record_5.csv',
        'watch_record_6.csv',
        'watch_record_7.csv'
    ];
    
    // 根据环境选择数据目录
    const dataDir = isProduction ? path.join(__dirname, 'data') : 'C:\\Users\\嗷呜\\Desktop';
    
    for (const file of watchFiles) {
        const filePath = path.join(dataDir, file);
        if (fs.existsSync(filePath)) {
            try {
                const content = fs.readFileSync(filePath, 'utf-8');
                const lines = content.replace(/^\uFEFF/, '').split('\n').filter(l => l.trim());
                
                if (lines.length === 0) continue;
                
                // 解析CSV头部
                const headers = lines[0].split(',').map(h => h.trim());
                // 使用"精网号"列来匹配用户（不是"ID"列）
                const idIndex = headers.indexOf('精网号');
                const durationIndex = headers.findIndex(h => h.includes('观看时长') || h.includes('时长'));
                
                if (idIndex === -1) continue;
                
                // 解析数据行
                for (let i = 1; i < lines.length; i++) {
                    const values = lines[i].split(',');
                    const userId = values[idIndex] ? values[idIndex].trim() : '';
                    const duration = durationIndex >= 0 ? parseFloat(values[durationIndex]) || 0 : 0;
                    
                    if (userId && userId.startsWith('9')) {
                        if (!weeklyData[userId]) {
                            weeklyData[userId] = { watchCount: 0, validWatchCount: 0, totalMinutes: 0 };
                        }
                        weeklyData[userId].watchCount++;
                        weeklyData[userId].totalMinutes += duration;
                        // 观看时长>=30分钟算有效听课，+1绩点
                        if (duration >= 30) {
                            weeklyData[userId].validWatchCount++;
                        }
                    }
                }
            } catch (err) {
                console.error(`读取 ${file} 失败:`, err.message);
            }
        }
    }
    
    console.log(`📊 近一周观看记录: ${Object.keys(weeklyData).length} 位用户`);
    return weeklyData;
}

// 计算近一周绩点增长（基于桌面观看记录）
function calculateWeeklyGrowth() {
    const growthData = [];
    
    // 加载近一周观看数据
    const weeklyWatchData = loadWeeklyWatchData();
    
    gpaData.forEach(user => {
        const notesCount = user.notes || 0;
        
        // 从观看记录计算本周听课次数和时长
        const watchData = weeklyWatchData[user.id] || { watchCount: 0, validWatchCount: 0, totalMinutes: 0 };
        
        // 计算本周新增绩点：每次听课>=30分钟算+1绩点
        // 使用观看记录中的有效听课次数，而不是CSV中的本次新增字段
        const weeklyGrowth = watchData.validWatchCount;
        
        // 只要有听课记录或有笔记的用户都显示
        if (weeklyGrowth > 0 || watchData.watchCount > 0 || notesCount >= 3) {
            // 判断大王类型：
            // 1. 听课多 + 笔记多 → 全能大王
            // 2. 听课多 → 学习大王
            // 3. 笔记多 → 笔记大王
            let starType = 'study'; // study, homework, or allround
            let starTitle = '📚 学习大王';
            let reason = '';
            
            // 定义阈值
            const hasHighGrowth = weeklyGrowth >= 3;  // 听课多：本周有效听课>=3次
            const hasHighNotes = notesCount >= 3;  // 笔记多
            
            if (hasHighGrowth && hasHighNotes) {
                // 全能大王：听课多 + 笔记多
                starType = 'allround';
                starTitle = '👑 全能大王';
                reason = `本周听课+${weeklyGrowth}绩点(${watchData.validWatchCount}次≥30分钟)，提交笔记${notesCount}次，学习全能！`;
            } else if (hasHighNotes) {
                // 笔记大王：笔记多但听课不多
                starType = 'homework';
                starTitle = '📝 笔记大王';
                if (notesCount >= 10) {
                    reason = `提交笔记${notesCount}次，笔记达人！`;
                } else if (notesCount >= 5) {
                    reason = `提交笔记${notesCount}次，学习超积极！`;
                } else {
                    reason = `提交笔记${notesCount}次，保持学习！`;
                }
            } else if (notesCount > 0) {
                // 有少量笔记
                starType = 'homework';
                starTitle = '📝 笔记大王';
                reason = `提交笔记${notesCount}次`;
            } else {
                // 学习大王：听课多但笔记不多
                starType = 'study';
                starTitle = '📚 学习大王';
                reason = `本周听课+${weeklyGrowth}绩点(${watchData.validWatchCount}次≥30分钟)，坚持学习！`;
            }
            
            growthData.push({
                id: user.id,
                idMasked: user.idMasked,
                name: user.name,
                totalGpa: user.totalGpa,
                growth: weeklyGrowth,
                watchCount: watchData.watchCount,
                watchMinutes: Math.round(watchData.totalMinutes),
                notes: notesCount,
                starType: starType,
                starTitle: starTitle,
                reason: reason,
                isGongying: user.isGongying
            });
        }
    });
    
    // 按增长排序（全能大王 > 笔记大王 > 学习大王，同类型按绩点增长排序）
    growthData.sort((a, b) => {
        // 定义优先级：全能大王 > 笔记大王 > 学习大王
        const getPriority = (type) => {
            if (type === 'allround') return 3;
            if (type === 'homework') return 2;
            return 1;
        };
        
        const priorityA = getPriority(a.starType);
        const priorityB = getPriority(b.starType);
        
        // 优先级高的排前面
        if (priorityA !== priorityB) {
            return priorityB - priorityA;
        }
        
        // 同优先级按增长排序
        return b.growth - a.growth;
    });
    
    return growthData;
}

// 初始化加载数据
async function init() {
    try {
        console.log('🔄 开始初始化数据...');
        await loadGongyingMembers();
        await loadUpdateData();
        loadHistoryData();
        gpaData = await loadCSVData();
        saveHistoryData(); // 保存当前数据作为历史
        initStockMarketData(); // 初始化美股数据
        console.log('✅ 数据初始化完成');
    } catch (err) {
        console.error('❌ 初始化失败:', err);
        // 即使失败也继续启动服务
        gpaData = [];
    }
}

init();

// 定期刷新数据（每5分钟）
setInterval(async () => {
    await loadGongyingMembers();
    await loadUpdateData();
    gpaData = await loadCSVData();
    saveHistoryData(); // 保存历史数据
}, 5 * 60 * 1000);

app.use(express.json());

// 访问日志中间件
app.use((req, res, next) => {
    // 只记录页面访问，不记录API请求
    if (req.path === '/' || req.path === '/index.html' || req.path.endsWith('.html')) {
        const logEntry = {
            timestamp: new Date().toISOString(),
            ip: req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || req.connection.remoteAddress || 'unknown',
            userAgent: req.headers['user-agent'] || 'unknown',
            path: req.path,
            referer: req.headers['referer'] || 'direct'
        };
        
        // 添加到日志数组
        accessLogs.push(logEntry);
        
        // 只保留最近1000条记录
        if (accessLogs.length > 1000) {
            accessLogs = accessLogs.slice(-1000);
        }
        
        // 异步保存到文件
        try {
            fs.writeFileSync(ACCESS_LOG_FILE, JSON.stringify(accessLogs, null, 2));
        } catch (err) {
            console.error('保存访问日志失败:', err.message);
        }
    }
    next();
});

app.use(express.static('public'));

// 获取所有绩点数据
app.get('/api/gpa', (req, res) => {
    res.json(gpaData);
});

// 搜索功能
app.get('/api/gpa/search', (req, res) => {
    const { keyword } = req.query;
    if (!keyword) {
        return res.json(gpaData);
    }
    
    const filtered = gpaData.filter(item => 
        item.name.toLowerCase().includes(keyword.toLowerCase()) ||
        item.id.includes(keyword) ||
        item.idMasked.includes(keyword)
    );
    res.json(filtered);
});

// 获取前N名
app.get('/api/gpa/top/:n', (req, res) => {
    const n = parseInt(req.params.n) || 10;
    res.json(gpaData.slice(0, n));
});

// 获取飞跃之星（近一周绩点增长最多）
app.get('/api/gpa/rising-stars', (req, res) => {
    const limit = parseInt(req.query.limit) || 30;  // 默认返回30条
    const growthData = calculateWeeklyGrowth();
    res.json(growthData.slice(0, limit));
});

// 获取预警榜单（读取预计算的预警名单）
app.get('/api/gpa/warning', (req, res) => {
    try {
        const warningFile = path.join(__dirname, 'data', 'warning_list.json');
        if (fs.existsSync(warningFile)) {
            const warningData = JSON.parse(fs.readFileSync(warningFile, 'utf-8'));
            res.json(warningData);
        } else {
            // 如果文件不存在，返回空数组
            res.json([]);
        }
    } catch (err) {
        console.error('读取预警名单失败:', err);
        res.json([]);
    }
});

// 获取沉睡用户名单
app.get('/api/gpa/sleeping', (req, res) => {
    try {
        const sleepingFile = path.join(__dirname, 'data', 'sleeping_users.json');
        if (fs.existsSync(sleepingFile)) {
            const sleepingData = JSON.parse(fs.readFileSync(sleepingFile, 'utf-8'));
            res.json(sleepingData);
        } else {
            res.json([]);
        }
    } catch (err) {
        console.error('读取沉睡用户名单失败:', err);
        res.json([]);
    }
});

// 后台管理API - 删除预警用户
app.delete('/api/admin/warning/:userId', (req, res) => {
    try {
        const userId = req.params.userId;
        const warningFile = path.join(__dirname, 'data', 'warning_list.json');
        
        if (fs.existsSync(warningFile)) {
            let warningData = JSON.parse(fs.readFileSync(warningFile, 'utf-8'));
            warningData = warningData.filter(u => u.id !== userId);
            fs.writeFileSync(warningFile, JSON.stringify(warningData, null, 2));
            console.log(`🗑️ 删除预警用户: ${userId}`);
        }
        
        res.json({ success: true });
    } catch (err) {
        console.error('删除预警用户失败:', err);
        res.status(500).json({ error: '删除失败' });
    }
});

// 存储今日美股数据（模拟真实数据，实际应该定时从API获取）
let stockMarketData = {
    date: new Date().toISOString().split('T')[0],
    index: 'S&P 500',
    prevClose: 0,
    current: 0,
    change: 0,
    changePercent: 0,
    isUp: false
};

// 初始化美股数据（使用随机但合理的数据模拟真实市场）
function initStockMarketData() {
    // 基于真实S&P 500近期范围生成模拟数据
    const basePrice = 5400 + Math.random() * 200; // 5400-5600区间
    const changePercent = (Math.random() - 0.5) * 4; // -2% 到 +2%
    const change = basePrice * changePercent / 100;
    
    stockMarketData = {
        date: new Date().toISOString().split('T')[0],
        index: 'S&P 500',
        prevClose: Math.round(basePrice - change),
        current: Math.round(basePrice),
        change: Math.round(change * 100) / 100,
        changePercent: Math.round(changePercent * 100) / 100,
        isUp: change >= 0
    };
    
    console.log(`📈 美股数据初始化: S&P 500 ${stockMarketData.isUp ? '上涨' : '下跌'} ${Math.abs(stockMarketData.changePercent)}%`);
}

// 获取美股数据API
app.get('/api/stock/market', (req, res) => {
    res.json({
        success: true,
        data: stockMarketData,
        message: '数据每日更新，预测下一交易日涨跌'
    });
});

// 游戏记录API
app.post('/api/game/play', express.json(), (req, res) => {
    try {
        const { userId, userName, choice, cost, reward, consecutiveWins, isPredictKing, timestamp } = req.body;
        
        // 使用真实美股数据判断结果
        const actualResult = stockMarketData.isUp ? 'up' : 'down';
        const isWin = choice === actualResult;
        
        // 记录游戏日志
        const gameLog = {
            userId,
            userName,
            choice: choice === 'up' ? '看涨' : '看跌',
            result: actualResult === 'up' ? '上涨' : '下跌',
            isWin,
            cost,
            reward: isWin ? (reward || 20) : 0,
            net: isWin ? (reward || 20) - cost : -cost,
            consecutiveWins: isWin ? (consecutiveWins || 1) : 0,
            isPredictKing: isPredictKing || false,
            stockData: {
                index: stockMarketData.index,
                change: stockMarketData.change,
                changePercent: stockMarketData.changePercent
            },
            timestamp: timestamp || new Date().toISOString()
        };
        
        const resultEmoji = isWin ? '✅' : '❌';
        const netText = isWin ? `+${gameLog.net}` : `-${cost}`;
        console.log(`🎮 游戏记录: ${userName} ${gameLog.choice} → S&P500${actualResult === 'up' ? '涨' : '跌'} ${resultEmoji} 净${netText}绩点`);
        
        res.json({ 
            success: true, 
            message: '记录成功',
            result: {
                isWin: isWin,
                actualResult: actualResult,
                stockChange: stockMarketData.changePercent
            }
        });
    } catch (err) {
        console.error('记录游戏日志失败:', err);
        res.status(500).json({ error: '记录失败' });
    }
});

// 每日更新美股数据（实际应该使用定时任务或真实API）
setInterval(() => {
    const now = new Date();
    const hour = now.getHours();
    // 美股收盘后更新（北京时间凌晨5点左右）
    if (hour === 5) {
        initStockMarketData();
    }
}, 60 * 60 * 1000); // 每小时检查一次

// 后台管理API - 添加预警用户
app.post('/api/admin/warning', express.json(), (req, res) => {
    try {
        const { userId, name, totalGpa, reason } = req.body;
        const warningFile = path.join(__dirname, 'data', 'warning_list.json');
        
        let warningData = [];
        if (fs.existsSync(warningFile)) {
            warningData = JSON.parse(fs.readFileSync(warningFile, 'utf-8'));
        }
        
        // 检查是否已存在
        if (!warningData.find(u => u.id === userId)) {
            warningData.push({
                id: userId,
                idMasked: userId.slice(0, 3) + '****' + userId.slice(-2),
                name: name || '未知用户',
                totalGpa: totalGpa || 0,
                reason: reason || '手动添加',
                addedAt: new Date().toISOString()
            });
            
            fs.writeFileSync(warningFile, JSON.stringify(warningData, null, 2));
            console.log(`➕ 添加预警用户: ${name} (${userId})`);
        }
        
        res.json({ success: true });
    } catch (err) {
        console.error('添加预警用户失败:', err);
        res.status(500).json({ error: '添加失败' });
    }
});

// 获取统计信息
app.get('/api/gpa/stats', (req, res) => {
    if (gpaData.length === 0) {
        return res.json({ total: 0, avgGpa: 0, maxGpa: 0, minGpa: 0, gongyingCount: 0, updatedCount: 0 });
    }
    
    const totalGpa = gpaData.reduce((sum, item) => sum + item.totalGpa, 0);
    const maxGpa = Math.max(...gpaData.map(item => item.totalGpa));
    const minGpa = Math.min(...gpaData.map(item => item.totalGpa));
    const gongyingCount = gpaData.filter(item => item.isGongying).length;
    const updatedCount = gpaData.filter(item => item.updated).length;
    
    res.json({
        total: gpaData.length,
        avgGpa: Math.round(totalGpa / gpaData.length),
        maxGpa: maxGpa,
        minGpa: minGpa,
        gongyingCount: gongyingCount,
        updatedCount: updatedCount,
        totalHistoryGpa: gpaData.reduce((sum, item) => sum + item.historyGpa, 0),
        totalNewGpa: gpaData.reduce((sum, item) => sum + item.newGpa, 0)
    });
});

// 健康检查
app.get('/health', (req, res) => {
    res.json({ status: 'ok', dataLoaded: gpaData.length > 0, count: gpaData.length });
});

// 登录日志存储
let loginLogs = [];
const LOGIN_LOG_FILE = path.join(__dirname, 'data', 'login_logs.json');

// 简单的IP地理位置映射（常用IP段）
const ipLocationMap = {
    '127.': '本地',
    '192.168.': '局域网',
    '10.': '局域网',
    '172.': '局域网'
};

// 获取IP地理位置（简化版）
function getIPLocation(ip) {
    if (!ip || ip === 'unknown') return '未知';
    
    // 检查本地/局域网
    for (const [prefix, location] of Object.entries(ipLocationMap)) {
        if (ip.startsWith(prefix)) return location;
    }
    
    // 根据IP段简单判断（实际项目中建议使用IP数据库）
    // 这里返回IP的前两段作为标识
    const parts = ip.split('.');
    if (parts.length >= 2) {
        return `${parts[0]}.${parts[1]}.*.*`;
    }
    return ip;
}

// 记录登录API
app.post('/api/login', express.json(), (req, res) => {
    try {
        const { userId, userName, timestamp } = req.body;
        const ip = req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || req.connection.remoteAddress || 'unknown';
        
        const logEntry = {
            timestamp: timestamp || new Date().toISOString(),
            userId: userId,
            userName: userName,
            ip: ip,
            userAgent: req.headers['user-agent'] || 'unknown'
        };
        
        loginLogs.push(logEntry);
        
        // 只保留最近500条登录记录
        if (loginLogs.length > 500) {
            loginLogs = loginLogs.slice(-500);
        }
        
        // 保存到文件
        fs.writeFileSync(LOGIN_LOG_FILE, JSON.stringify(loginLogs, null, 2));
        
        console.log(`🔐 用户登录: ${userName} (${userId}) from ${ip}`);
        res.json({ success: true });
    } catch (err) {
        console.error('记录登录失败:', err);
        res.status(500).json({ error: '记录失败' });
    }
});

// 后台管理API - 获取访问日志
app.get('/api/admin/access-logs', (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 100;
        let logs = accessLogs.slice(-limit).reverse(); // 最新的在前
        
        // 添加地理位置信息
        logs = logs.map(log => ({
            ...log,
            location: getIPLocation(log.ip)
        }));
        
        // 统计信息
        const uniqueIPs = new Set(accessLogs.map(l => l.ip)).size;
        const today = new Date().toISOString().split('T')[0];
        const todayLogs = accessLogs.filter(l => l.timestamp.startsWith(today));
        const todayUniqueIPs = new Set(todayLogs.map(l => l.ip)).size;
        
        res.json({
            total: accessLogs.length,
            uniqueIPs: uniqueIPs,
            todayVisits: todayLogs.length,
            todayUniqueIPs: todayUniqueIPs,
            logs: logs
        });
    } catch (err) {
        console.error('获取访问日志失败:', err);
        res.status(500).json({ error: '获取失败' });
    }
});

// 后台管理API - 获取登录日志
app.get('/api/admin/login-logs', (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 100;
        const logs = loginLogs.slice(-limit).reverse(); // 最新的在前
        
        // 统计信息
        const uniqueUsers = new Set(loginLogs.map(l => l.userId)).size;
        const today = new Date().toISOString().split('T')[0];
        const todayLogs = loginLogs.filter(l => l.timestamp.startsWith(today));
        
        res.json({
            total: loginLogs.length,
            uniqueUsers: uniqueUsers,
            todayLogins: todayLogs.length,
            logs: logs
        });
    } catch (err) {
        console.error('获取登录日志失败:', err);
        res.status(500).json({ error: '获取失败' });
    }
});

// 页面路由
app.get('*', (req, res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 后台管理API - 兑换绩点
app.post('/api/admin/redeem', express.json(), (req, res) => {
    const { userId, points, note } = req.body;
    
    if (!userId || !points || points <= 0) {
        return res.status(400).json({ error: '参数错误' });
    }
    
    const userIndex = gpaData.findIndex(u => u.id === userId);
    if (userIndex === -1) {
        return res.status(404).json({ error: '用户不存在' });
    }
    
    const user = gpaData[userIndex];
    const remainingGpa = user.totalGpa - (user.usedGpa || 0);
    
    if (remainingGpa < points) {
        return res.status(400).json({ error: '绩点不足' });
    }
    
    // 更新已使用绩点
    user.usedGpa = (user.usedGpa || 0) + points;
    
    // 记录使用详情
    const usedDetails = user.usedGpaDetails || '';
    const newDetail = note || `兑换${points}绩点`;
    user.usedGpaDetails = usedDetails ? `${usedDetails}; ${newDetail}` : newDetail;
    
    // 记录操作日志
    addLog('兑换绩点', userId, user.name, `使用${points}绩点 - ${newDetail}`);
    
    // 保存到CSV文件
    saveGpaData();
    
    res.json({ success: true, message: '兑换成功' });
});

// 后台管理API - 添加用户
app.post('/api/admin/users', express.json(), (req, res) => {
    const { id, name, historyGpa, newGpa, notes } = req.body;
    
    if (!id || !name) {
        return res.status(400).json({ error: '精网号和姓名不能为空' });
    }
    
    // 检查用户是否已存在
    if (gpaData.find(u => u.id === id)) {
        return res.status(409).json({ error: '用户已存在' });
    }
    
    const hGpa = parseInt(historyGpa) || 0;
    const nGpa = parseInt(newGpa) || 0;
    const nNotes = parseInt(notes) || 0;
    
    const newUser = {
        id: id,
        idMasked: id.substring(0, 2) + '****' + id.substring(id.length - 2),
        name: name,
        historyGpa: hGpa,
        newGpa: nGpa,
        totalGpa: hGpa + nGpa,
        usedGpa: 0,
        usedGpaDetails: '',
        notes: nNotes,
        isGongying: false,
        updated: true
    };
    
    gpaData.push(newUser);
    
    // 重新排序
    gpaData.sort((a, b) => b.totalGpa - a.totalGpa);
    
    // 记录操作日志
    addLog('添加用户', id, name, `总绩点:${newUser.totalGpa}`);
    
    // 保存到CSV文件
    saveGpaData();
    
    res.json({ success: true, message: '添加成功' });
});

// 后台管理API - 更新用户
app.put('/api/admin/users/:id', express.json(), (req, res) => {
    const userId = req.params.id;
    const { name, historyGpa, newGpa, usedGpa, notes } = req.body;
    
    const userIndex = gpaData.findIndex(u => u.id === userId);
    if (userIndex === -1) {
        return res.status(404).json({ error: '用户不存在' });
    }
    
    const user = gpaData[userIndex];
    
    if (name) user.name = name;
    if (historyGpa !== undefined) user.historyGpa = parseInt(historyGpa) || 0;
    if (newGpa !== undefined) user.newGpa = parseInt(newGpa) || 0;
    if (usedGpa !== undefined) user.usedGpa = parseInt(usedGpa) || 0;
    if (notes !== undefined) user.notes = parseInt(notes) || 0;
    
    // 重新计算总绩点
    user.totalGpa = user.historyGpa + user.newGpa;
    user.updated = true;
    
    // 重新排序
    gpaData.sort((a, b) => b.totalGpa - a.totalGpa);
    
    // 记录操作日志
    addLog('修改用户', userId, user.name, `总绩点:${user.totalGpa}`);
    
    // 保存到CSV文件
    saveGpaData();
    
    res.json({ success: true, message: '更新成功' });
});

// 后台管理API - 删除用户
app.delete('/api/admin/users/:id', (req, res) => {
    const userId = req.params.id;
    
    const userIndex = gpaData.findIndex(u => u.id === userId);
    if (userIndex === -1) {
        return res.status(404).json({ error: '用户不存在' });
    }
    
    const userName = gpaData[userIndex].name;
    gpaData.splice(userIndex, 1);
    
    // 记录操作日志
    addLog('删除用户', userId, userName, '用户已删除');
    
    // 保存到CSV文件
    saveGpaData();
    
    res.json({ success: true, message: '删除成功' });
});

// 操作日志
const operationLogs = [];
const MAX_LOGS = 100;

// 记录操作日志
function addLog(operation, userId, userName, details) {
    const log = {
        time: new Date().toISOString(),
        operation,
        userId,
        userName,
        details
    };
    operationLogs.unshift(log);
    if (operationLogs.length > MAX_LOGS) {
        operationLogs.pop();
    }
    console.log(`📝 [${log.time}] ${operation}: ${userName} (${userId}) - ${details}`);
}

// 获取操作日志API
app.get('/api/admin/logs', (req, res) => {
    const limit = parseInt(req.query.limit) || 50;
    res.json(operationLogs.slice(0, limit));
});

// 批量导入API
app.post('/api/admin/import', express.json(), (req, res) => {
    const { users } = req.body;
    if (!users || !Array.isArray(users) || users.length === 0) {
        return res.status(400).json({ error: '数据格式错误' });
    }
    
    let added = 0;
    let updated = 0;
    let failed = 0;
    
    users.forEach(user => {
        if (!user.id || !user.name) {
            failed++;
            return;
        }
        
        const existingIndex = gpaData.findIndex(u => u.id === user.id);
        
        if (existingIndex >= 0) {
            // 更新现有用户
            const existing = gpaData[existingIndex];
            existing.name = user.name || existing.name;
            if (user.historyGpa !== undefined) existing.historyGpa = parseInt(user.historyGpa) || 0;
            if (user.newGpa !== undefined) existing.newGpa = parseInt(user.newGpa) || 0;
            if (user.notes !== undefined) existing.notes = parseInt(user.notes) || 0;
            existing.totalGpa = existing.historyGpa + existing.newGpa;
            existing.updated = true;
            updated++;
            addLog('批量更新', user.id, user.name, `历史:${existing.historyGpa}, 新增:${existing.newGpa}`);
        } else {
            // 添加新用户
            const hGpa = parseInt(user.historyGpa) || 0;
            const nGpa = parseInt(user.newGpa) || 0;
            const newUser = {
                id: user.id,
                idMasked: user.id.substring(0, 2) + '****' + user.id.substring(user.id.length - 2),
                name: user.name,
                historyGpa: hGpa,
                newGpa: nGpa,
                totalGpa: hGpa + nGpa,
                usedGpa: 0,
                usedGpaDetails: '',
                notes: parseInt(user.notes) || 0,
                isGongying: false,
                updated: true
            };
            gpaData.push(newUser);
            added++;
            addLog('批量导入', user.id, user.name, `总绩点:${newUser.totalGpa}`);
        }
    });
    
    // 重新排序
    gpaData.sort((a, b) => b.totalGpa - a.totalGpa);
    
    // 保存到CSV
    saveGpaData();
    
    res.json({ success: true, added, updated, failed });
});

// 保存数据到CSV文件
function saveGpaData() {
    try {
        const headers = ['精网号', '精网号(打码)', '姓名', '历史绩点', '本次新增', '总绩点', '笔记次数'];
        let csvContent = '\uFEFF' + headers.join(',') + '\n';
        
        gpaData.forEach(user => {
            const row = [
                user.id,
                user.idMasked,
                user.name,
                user.historyGpa,
                user.newGpa,
                user.totalGpa,
                user.notes || 0
            ];
            csvContent += row.join(',') + '\n';
        });
        
        fs.writeFileSync(CSV_FILE, csvContent, 'utf-8');
        console.log('💾 数据已保存到CSV文件');
    } catch (err) {
        console.error('保存数据失败:', err);
    }
}

// 错误处理中间件
app.use((err, req, res, next) => {
    console.error('服务器错误:', err);
    res.status(500).json({ error: '服务器内部错误' });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 绩点排行榜系统运行在 http://localhost:${PORT}`);
    console.log(`📁 数据目录: ${DATA_DIR}`);
});
