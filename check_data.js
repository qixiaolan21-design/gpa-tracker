const fs = require('fs');
const path = require('path');

// 读取观看记录
const weeklyData = {};
const watchFiles = ['观看记录.csv','观看记录1.csv','观看记录2.csv','观看记录3.csv','观看记录4.csv','观看记录5.csv','观看记录6.csv','观看记录7.csv'];
const desktopDir = 'C:\\Users\\嗷呜\\Desktop';

for (const file of watchFiles) {
    const filePath = path.join(desktopDir, file);
    if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf-8');
        const lines = content.replace(/^\uFEFF/, '').split('\n').filter(l => l.trim());
        if (lines.length === 0) continue;
        const headers = lines[0].split(',').map(h => h.trim());
        // 使用"精网号"列，不是"ID"列
        const idIndex = headers.indexOf('精网号');
        const durationIndex = headers.findIndex(h => h.includes('观看时长') || h.includes('时长'));
        if (idIndex === -1) continue;
        for (let i = 1; i < lines.length; i++) {
            const values = lines[i].split(',');
            const userId = values[idIndex] ? values[idIndex].trim() : '';
            const duration = durationIndex >= 0 ? parseFloat(values[durationIndex]) || 0 : 0;
            if (userId && userId.startsWith('9')) {
                if (!weeklyData[userId]) weeklyData[userId] = { watchCount: 0, validWatchCount: 0, totalMinutes: 0 };
                weeklyData[userId].watchCount++;
                weeklyData[userId].totalMinutes += duration;
                if (duration >= 30) weeklyData[userId].validWatchCount++;
            }
        }
    }
}

// 读取绩点表
const gpaContent = fs.readFileSync(path.join(desktopDir, '绩点表.csv'), 'utf-8');
const lines = gpaContent.replace(/^\uFEFF/, '').split('\n').filter(l => l.trim());
const headers = lines[0].split(',').map(h => h.trim());
const idIndex = headers.indexOf('精网号');
const nameIndex = headers.indexOf('姓名');
const notesIndex = headers.indexOf('笔记次数');

console.log('前20名用户分析：');
console.log('='.repeat(100));

let allroundCount = 0;
let studyCount = 0;
let homeworkCount = 0;
let noneCount = 0;

for (let i = 1; i <= 30 && i < lines.length; i++) {
    const values = lines[i].split(',');
    const userId = values[idIndex] ? values[idIndex].trim() : '';
    const name = values[nameIndex] || '';
    const notes = parseInt(values[notesIndex]) || 0;
    const watchData = weeklyData[userId] || { validWatchCount: 0 };
    
    const hasHighGrowth = watchData.validWatchCount >= 5;
    const hasHighNotes = notes >= 3;
    
    let tag = '';
    if (hasHighGrowth && hasHighNotes) {
        tag = '👑 全能大王';
        allroundCount++;
    } else if (hasHighNotes) {
        tag = '📝 笔记大王';
        homeworkCount++;
    } else if (watchData.validWatchCount > 0) {
        tag = '📚 学习大王';
        studyCount++;
    } else {
        tag = '❌ 无';
        noneCount++;
    }
    
    console.log(`${i}. ${name} (${userId}): 听课${watchData.validWatchCount}次, 笔记${notes}次 → ${tag}`);
}

console.log('');
console.log(`统计：全能大王=${allroundCount}, 学习大王=${studyCount}, 笔记大王=${homeworkCount}, 无=${noneCount}`);
console.log(`总计：${Object.keys(weeklyData).length} 位用户有观看记录`);
