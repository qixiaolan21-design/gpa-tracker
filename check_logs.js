const fs = require('fs');
const path = require('path');

// 读取操作日志
const logsFile = path.join(__dirname, 'data', 'operation_logs.json');
if (fs.existsSync(logsFile)) {
    const logs = JSON.parse(fs.readFileSync(logsFile, 'utf-8'));
    console.log('总日志数:', logs.length);
    
    // 筛选今天的兑换记录
    const today = new Date().toISOString().split('T')[0];
    const todayLogs = logs.filter(log => {
        const logDate = log.time ? log.time.split('T')[0] : '';
        return logDate === today && log.operation === '兑换绩点';
    });
    
    console.log('\n今天的兑换记录:', todayLogs.length);
    todayLogs.forEach((log, i) => {
        console.log(`${i+1}. ${log.userName} (${log.userId}): ${log.details}`);
    });
    
    // 显示所有兑换记录（不限于今天）
    console.log('\n\n所有兑换记录（最近10条）:');
    const redeemLogs = logs.filter(log => log.operation === '兑换绩点').slice(-10);
    redeemLogs.forEach((log, i) => {
        const date = log.time ? log.time.split('T')[0] : '未知';
        console.log(`${date} - ${log.userName} (${log.userId}): ${log.details}`);
    });
} else {
    console.log('日志文件不存在');
}
