// ============================================================
//  口算塔防 - 激活码服务器（一码一设备版）
//  一个激活码只能绑定一台设备，绑定后立即失效
// ============================================================

const express = require('express');
const crypto = require('crypto');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static('./'));

// ---------- 数据存储（内存） ----------
const codes = {};        // { 'CODE': { status, used_by, activated_at, expires_at } }
// status: 'active' | 'used' | 'revoked' | 'expired'

// 默认内置激活码（每个只能用一次）
function initDefaultCodes() {
    const defaultCodes = ['ABC123', 'DEF456', 'GHI789', 'TD2024', 'PLAY2024', 'GAME888'];
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 365);
    
    for (const code of defaultCodes) {
        if (!codes[code]) {
            codes[code] = {
                status: 'active',           // active / used / revoked / expired
                used_by: null,              // 绑定的设备ID
                activated_at: null,         // 激活时间
                expires_at: expiresAt.toISOString(),
                created_at: new Date().toISOString()
            };
        }
    }
}
initDefaultCodes();

// ---------- API：验证激活码 ----------
app.post('/api/verify', (req, res) => {
    const { code, device_id } = req.body;
    if (!code || !device_id) {
        return res.json({ success: false, message: '缺少激活码或设备ID' });
    }

    const upperCode = code.toUpperCase().trim();
    const codeInfo = codes[upperCode];
    
    // 1. 检查激活码是否存在
    if (!codeInfo) {
        return res.json({ success: false, message: '❌ 激活码不存在' });
    }

    // 2. 检查是否过期
    if (codeInfo.expires_at && new Date(codeInfo.expires_at) < new Date()) {
        codeInfo.status = 'expired';
        return res.json({ success: false, message: '❌ 激活码已过期' });
    }

    // 3. 检查是否被作废
    if (codeInfo.status === 'revoked') {
        return res.json({ success: false, message: '❌ 该激活码已被作废' });
    }

    // 4. 🔥 核心修复：检查是否已被使用
    if (codeInfo.status === 'used') {
        // 如果已被使用，检查是不是同一台设备（防止重复绑定）
        if (codeInfo.used_by === device_id) {
            return res.json({
                success: true,
                message: '✅ 已激活（当前设备）',
                code: upperCode,
                is_new: false
            });
        } else {
            // 已被其他设备使用
            return res.json({
                success: false,
                message: '❌ 该激活码已被其他设备使用，无法再次激活'
            });
        }
    }

    // 5. 🔥 激活码是 active 状态，执行绑定
    // 标记为已使用
    codeInfo.status = 'used';
    codeInfo.used_by = device_id;
    codeInfo.activated_at = new Date().toISOString();

    return res.json({
        success: true,
        message: '✅ 激活成功！该激活码已绑定当前设备',
        code: upperCode,
        is_new: true,
        is_first_use: true
    });
});

// ---------- API：检查设备状态 ----------
app.post('/api/check', (req, res) => {
    const { device_id } = req.body;
    if (!device_id) {
        return res.json({ success: false, activated: false, message: '缺少设备ID' });
    }

    // 遍历所有激活码，查找该设备是否已绑定
    let found = false;
    let foundCode = null;
    let foundInfo = null;

    for (const [code, info] of Object.entries(codes)) {
        if (info.status === 'used' && info.used_by === device_id) {
            found = true;
            foundCode = code;
            foundInfo = info;
            break;
        }
    }

    if (!found) {
        return res.json({ success: false, activated: false, message: '未激活' });
    }

    // 检查激活码是否被作废或过期
    if (foundInfo.status === 'revoked') {
        return res.json({ success: false, activated: false, message: '❌ 激活码已被作废' });
    }
    if (foundInfo.expires_at && new Date(foundInfo.expires_at) < new Date()) {
        foundInfo.status = 'expired';
        return res.json({ success: false, activated: false, message: '❌ 激活码已过期' });
    }

    return res.json({
        success: true,
        activated: true,
        code: foundCode,
        activated_at: foundInfo.activated_at,
        message: '✅ 已激活'
    });
});

// ---------- API：管理员 - 生成激活码 ----------
app.get('/admin/generate', (req, res) => {
    const password = req.query.password;
    const adminPass = process.env.ADMIN_PASSWORD || 'admin123';
    
    if (password !== adminPass) {
        return res.json({ success: false, message: '❌ 管理员密码错误' });
    }

    const count = parseInt(req.query.count) || 1;
    const expireDays = parseInt(req.query.expire_days) || 365;
    
    const newCodes = [];
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + expireDays);

    for (let i = 0; i < count; i++) {
        let code = generateCode();
        while (codes[code]) {
            code = generateCode();
        }
        codes[code] = {
            status: 'active',
            used_by: null,
            activated_at: null,
            expires_at: expiresAt.toISOString(),
            created_at: new Date().toISOString()
        };
        newCodes.push(code);
    }

    res.json({
        success: true,
        codes: newCodes,
        expire_days: expireDays,
        count: newCodes.length,
        message: `成功生成 ${newCodes.length} 个激活码（每个仅限一台设备使用）`
    });
});

// ---------- API：管理员 - 查看激活码状态 ----------
app.get('/admin/list', (req, res) => {
    const password = req.query.password;
    const adminPass = process.env.ADMIN_PASSWORD || 'admin123';
    
    if (password !== adminPass) {
        return res.json({ success: false, message: '❌ 管理员密码错误' });
    }

    const result = [];
    for (const [code, info] of Object.entries(codes)) {
        result.push({
            code: code,
            status: info.status,
            used_by: info.used_by || '未使用',
            activated_at: info.activated_at || '未激活',
            expires_at: info.expires_at,
            created_at: info.created_at
        });
    }

    res.json({
        success: true,
        total: result.length,
        data: result
    });
});

// ---------- API：管理员 - 作废激活码 ----------
app.post('/admin/revoke', (req, res) => {
    const { code, password } = req.body;
    const adminPass = process.env.ADMIN_PASSWORD || 'admin123';
    
    if (password !== adminPass) {
        return res.json({ success: false, message: '❌ 管理员密码错误' });
    }

    const upperCode = code.toUpperCase().trim();
    if (!codes[upperCode]) {
        return res.json({ success: false, message: '激活码不存在' });
    }

    codes[upperCode].status = 'revoked';
    res.json({
        success: true,
        code: upperCode,
        message: `✅ 激活码 ${upperCode} 已作废`
    });
});

// ---------- 工具函数 ----------
function generateCode() {
    return Math.random().toString(36).substring(2, 6).toUpperCase() +
           Math.random().toString(36).substring(2, 6).toUpperCase();
}// 添加一个轻量级健康检查接口，供 Cron-job 使用
app.get('/health', (req, res) => {
    res.send('OK');
});

// ---------- 启动服务器 ----------
app.listen(PORT, () => {
    console.log(`🚀 服务器运行在 http://localhost:${PORT}`);
    console.log('📋 内置激活码（每码仅限一台设备）:');
    console.log('   ABC123, DEF456, GHI789, TD2024, PLAY2024, GAME888');
    console.log('🔑 管理员密码: admin123');
    console.log('📊 查看所有激活码: /admin/list?password=admin123');
});