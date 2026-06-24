const express = require('express');
const path = require('path');
const fs = require('fs');
const csv = require('csv-parser');
const XLSX = require('xlsx');
const iconv = require('iconv-lite');
const notesUpdates = require('./notes_update.js');

// 历史数据文件路径（用于计算周增长）
const HISTORY_FILE = path.join(__dirname, 'data', 'gpa_history.json');

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

// 计算近一周绩点增长（使用本次新增字段）
function calculateWeeklyGrowth() {
    const growthData = [];
    
    gpaData.forEach(user => {
        // 使用本次新增作为本周增长
        const growth = user.newGpa || 0;
        
        if (growth > 0) {
            const notesCount = user.notes || 0;
            
            // 判断是笔记大王还是学习大王
            // 笔记次数 >= 3 认为是笔记大王，否则是学习大王
            let starType = 'study'; // study 或 homework
            let starTitle = '📚 学习大王';
            let reason = '';
            
            if (notesCount >= 3) {
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
                starType = 'homework';
                starTitle = '📝 笔记大王';
                reason = `提交笔记${notesCount}次`;
            } else {
                reason = '坚持听课学习，积极参与！';
            }
            
            growthData.push({
                id: user.id,
                idMasked: user.idMasked,
                name: user.name,
                totalGpa: user.totalGpa,
                growth: growth,
                notes: notesCount,
                starType: starType,
                starTitle: starTitle,
                reason: reason,
                isGongying: user.isGongying
            });
        }
    });
    
    // 按增长排序
    growthData.sort((a, b) => b.growth - a.growth);
    
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
    const limit = parseInt(req.query.limit) || 10;
    const growthData = calculateWeeklyGrowth();
    res.json(growthData.slice(0, limit));
});

// 获取预警榜单（近一周没有出现在听课记录中的用户）
app.get('/api/gpa/warning', (req, res) => {
    const warningData = [];
    
    // 读取最近一周的听课记录
    const recentUsers = new Set();
    const today = new Date();
    
    // 检查最近7天的CSV文件
    for (let i = 0; i < 7; i++) {
        const date = new Date(today);
        date.setDate(today.getDate() - i);
        const month = date.getMonth() + 1;
        const day = date.getDate();
        
        // 尝试不同的文件名格式
        const possibleFiles = [
            path.join(DATA_DIR, `${month}.${day}.csv`),
            path.join(DATA_DIR, `${month}.${day}1.csv`),
            path.join(DATA_DIR, `${month}.${day}2.csv`)
        ];
        
        possibleFiles.forEach(file => {
            if (fs.existsSync(file)) {
                try {
                    const content = fs.readFileSync(file, 'utf-8');
                    const lines = content.split('\n');
                    lines.forEach(line => {
                        const parts = line.split(',');
                        if (parts.length >= 3) {
                            const userId = parts[2] ? parts[2].trim() : '';
                            if (userId && userId.startsWith('9')) {
                                recentUsers.add(userId);
                            }
                        }
                    });
                } catch (err) {
                    console.error('读取听课记录失败:', file, err.message);
                }
            }
        });
    }
    
    console.log(`📊 最近一周活跃用户数: ${recentUsers.size}`);
    
    gpaData.forEach(user => {
        // 如果用户最近一周没有出现在听课记录中，加入预警
        // 排除示例用户和特定账号
        if (!recentUsers.has(user.id) && !user.id.startsWith('900000') && user.id !== '90003692') {
            warningData.push({
                id: user.id,
                idMasked: user.idMasked,
                name: user.name,
                totalGpa: user.totalGpa,
                historyGpa: user.historyGpa,
                isGongying: user.isGongying
            });
        }
    });
    
    // 按总绩点排序（从低到高，优先显示绩点低的）
    warningData.sort((a, b) => a.totalGpa - b.totalGpa);
    
    console.log(`⚠️ 预警用户数: ${warningData.length}`);
    
    res.json(warningData);
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
