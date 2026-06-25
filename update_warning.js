const fs = require('fs');
const path = require('path');

const DESKTOP_DIR = 'C:\\Users\\嗷呜\\Desktop';
const DATA_DIR = 'C:\\Users\\嗷呜\\.openclaw\\workspace\\gpa-tracker\\data';

// 简单的CSV解析函数
function parseCSV(content) {
    const lines = content.replace(/^\uFEFF/, '').split('\n').filter(l => l.trim());
    if (lines.length === 0) return [];
    
    const headers = lines[0].split(',').map(h => h.trim());
    const records = [];
    
    for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(',');
        const record = {};
        headers.forEach((h, idx) => {
            record[h] = values[idx] ? values[idx].trim() : '';
        });
        records.push(record);
    }
    
    return records;
}

// 读取所有观看记录CSV文件
function getRecentUsers() {
    const recentUsers = new Set();
    
    // 读取观看记录.csv 和 观看记录1-7.csv
    const files = [
        '观看记录.csv',
        '观看记录1.csv',
        '观看记录2.csv',
        '观看记录3.csv',
        '观看记录4.csv',
        '观看记录5.csv',
        '观看记录6.csv',
        '观看记录7.csv'
    ];
    
    for (const file of files) {
        const filePath = path.join(DESKTOP_DIR, file);
        if (fs.existsSync(filePath)) {
            try {
                const content = fs.readFileSync(filePath, 'utf-8');
                const records = parseCSV(content);
                
                for (const record of records) {
                    const userId = record['精网号'] || record['ID'] || '';
                    if (userId && userId.toString().startsWith('9')) {
                        recentUsers.add(userId.toString().trim());
                    }
                }
                console.log(`✅ 读取 ${file}: ${records.length} 条记录`);
            } catch (err) {
                console.error(`❌ 读取失败 ${file}:`, err.message);
            }
        } else {
            console.log(`⚠️ 文件不存在: ${file}`);
        }
    }
    
    return recentUsers;
}

// 读取绩点表数据
function loadGpaData() {
    const gpaFile = path.join(DESKTOP_DIR, '绩点表.csv');
    if (!fs.existsSync(gpaFile)) {
        console.error('❌ 绩点表.csv 不存在');
        return [];
    }
    
    try {
        const content = fs.readFileSync(gpaFile, 'utf-8');
        const records = parseCSV(content);
        
        return records.map(r => ({
            id: r['精网号'] || '',
            name: r['姓名'] || '',
            totalGpa: parseInt(r['总绩点'] || r['绩点'] || '0'),
            historyGpa: parseInt(r['历史总绩点'] || r['总绩点'] || '0'),
            usedGpa: parseInt(r['已使用绩点'] || '0'),
            notes: parseInt(r['笔记数'] || '0'),
            isGongying: r['是否共盈会'] === 'TRUE' || r['是否共盈会'] === 'true' || r['是否共盈会'] === '1'
        })).filter(u => u.id && u.id.startsWith('9'));
    } catch (err) {
        console.error('❌ 读取绩点表失败:', err.message);
        return [];
    }
}

// 主函数
function main() {
    console.log('🔍 开始分析近一周听课数据...\n');
    
    // 获取近一周有听课记录的用户
    const recentUsers = getRecentUsers();
    console.log(`\n📊 近一周活跃用户数: ${recentUsers.size}`);
    
    // 获取所有用户数据
    const allUsers = loadGpaData();
    console.log(`📊 绩点表总用户数: ${allUsers.length}`);
    
    // 筛选预警用户（近一周没有听课记录的用户，且绩点<=10）
    // 排除示例用户和特定账号
    const excludedUsers = ['90003692', '90000000'];
    const MAX_GPA = 10; // 只展示绩点<=10的用户
    
    const warningUsers = allUsers.filter(user => {
        // 排除特定用户
        if (excludedUsers.includes(user.id)) return false;
        if (user.id.startsWith('900000')) return false;
        
        // 只展示绩点较低的用户
        if (user.totalGpa > MAX_GPA) return false;
        
        // 检查是否在近一周听课记录中
        return !recentUsers.has(user.id);
    });
    
    // 按总绩点排序（从低到高）
    warningUsers.sort((a, b) => a.totalGpa - b.totalGpa);
    
    console.log(`\n⚠️ 预警用户数: ${warningUsers.length}`);
    console.log('\n📋 预警名单：');
    console.log('='.repeat(80));
    
    warningUsers.forEach((user, index) => {
        const gongyingTag = user.isGongying ? ' [共盈会]' : '';
        console.log(`${index + 1}. ${user.name}${gongyingTag} (ID: ${user.id}) - 总绩点: ${user.totalGpa}, 笔记: ${user.notes}`);
    });
    
    // 保存预警名单到JSON文件供服务器使用
    const warningData = warningUsers.map(user => {
        // 根据绩点计算危险等级
        let dangerLevel = 'low';
        let dangerTag = '⚠️ 注意';
        let dangerClass = 'warning-low';
        
        if (user.totalGpa <= 2) {
            dangerLevel = 'critical';
            dangerTag = '🚨 危险';
            dangerClass = 'warning-critical';
        } else if (user.totalGpa <= 5) {
            dangerLevel = 'high';
            dangerTag = '🔥 高危';
            dangerClass = 'warning-high';
        } else if (user.totalGpa <= 8) {
            dangerLevel = 'medium';
            dangerTag = '⚡ 警告';
            dangerClass = 'warning-medium';
        }
        
        return {
            id: user.id,
            idMasked: user.id.slice(0, 3) + '****' + user.id.slice(-2),
            name: user.name,
            totalGpa: user.totalGpa,
            historyGpa: user.historyGpa,
            isGongying: user.isGongying,
            dangerLevel: dangerLevel,
            dangerTag: dangerTag,
            dangerClass: dangerClass
        };
    });
    
    const warningFile = path.join(DATA_DIR, 'warning_list.json');
    fs.writeFileSync(warningFile, JSON.stringify(warningData, null, 2));
    console.log(`\n💾 预警名单已保存到: ${warningFile}`);
    
    return warningUsers;
}

main();
