// ============================================================
//  口算塔防 - 激活码服务器（支持最大绑定设备数 + 有效期）
//  每个激活码可自定义绑定设备数及过期时间
// ============================================================

const express = require('express');
const crypto = require('crypto');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static('./'));

// ---------- 数据存储（内存） ----------
const codes = {};

// 默认激活码（每个可用 1 次，有效期 365 天）
function initDefaultCodes() {
    const defaultCodes = ['ABC123', 'DEF456', 'GHI789', 'TD2024', 'PLAY2024', 'GAME888'];
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 365);

    for (const code of defaultCodes) {
        if (!codes[code]) {
            codes[code] = {
                max_devices: 1,               // 最大绑定设备数
                used_count: 0,                // 已绑定设备数
                used_by: [],                  // 已绑定的设备ID列表
                status: 'active',             // active / revoked / expired
                activated_at: null,           // 首次激活时间
                expires_at: expiresAt.toISOString(),
                created_at: new Date().toISOString()
            };
        }
    }
}
initDefaultCodes();

// ---------- 工具函数 ----------
function generateCode() {
    return Math.random().toString(36).substring(2, 6).toUpperCase() +
           Math.random().toString(36).substring(2, 6).toUpperCase();
}

// ---------- API：验证激活码 ----------
app.post('/api/verify', (req, res) => {
    const { code, device_id } = req.body;
    if (!code || !device_id) {
        return res.json({ success: false, message: '缺少激活码或设备ID' });
    }

    const upperCode = code.toUpperCase().trim();
    const info = codes[upperCode];

    if (!info) {
        return res.json({ success: false, message: '❌ 激活码不存在' });
    }

    // 检查状态
    if (info.status === 'revoked') {
        return res.json({ success: false, message: '❌ 该激活码已被作废' });
    }
    if (info.expires_at && new Date(info.expires_at) < new Date()) {
        info.status = 'expired';
        return res.json({ success: false, message: '❌ 激活码已过期' });
    }

    // 检查设备是否已绑定此码
    if (info.used_by.includes(device_id)) {
        return res.json({
            success: true,
            message: '✅ 已绑定（当前设备）',
            code: upperCode,
            is_new: false
        });
    }

    // 检查是否达到最大绑定数
    if (info.used_count >= info.max_devices) {
        return res.json({
            success: false,
            message: `❌ 已达最大绑定数（${info.max_devices}台设备）`
        });
    }

    // 绑定新设备
    info.used_count += 1;
    info.used_by.push(device_id);
    if (!info.activated_at) {
        info.activated_at = new Date().toISOString();
    }

    return res.json({
        success: true,
        message: `✅ 激活成功！已绑定 ${info.used_count}/${info.max_devices} 台设备`,
        code: upperCode,
        is_new: true,
        bound_devices: info.used_count,
        max_devices: info.max_devices
    });
});

// ---------- API：检查设备状态 ----------
app.post('/api/check', (req, res) => {
    const { device_id } = req.body;
    if (!device_id) {
        return res.json({ success: false, activated: false, message: '缺少设备ID' });
    }

    for (const [code, info] of Object.entries(codes)) {
        if (info.used_by.includes(device_id)) {
            // 检查激活码状态
            if (info.status === 'revoked') {
                return res.json({ success: false, activated: false, message: '❌ 激活码已被作废' });
            }
            if (info.expires_at && new Date(info.expires_at) < new Date()) {
                info.status = 'expired';
                return res.json({ success: false, activated: false, message: '❌ 激活码已过期' });
            }
            return res.json({
                success: true,
                activated: true,
                code: code,
                activated_at: info.activated_at,
                bound_devices: info.used_count,
                max_devices: info.max_devices,
                message: '✅ 已激活'
            });
        }
    }

    return res.json({ success: false, activated: false, message: '未激活' });
});

// ---------- API：管理员 - 生成激活码（支持自定义设备数和有效期） ----------
app.get('/admin/generate', (req, res) => {
    const password = req.query.password;
    const adminPass = process.env.ADMIN_PASSWORD || 'admin123';

    if (password !== adminPass) {
        return res.json({ success: false, message: '❌ 管理员密码错误' });
    }

    const count = parseInt(req.query.count) || 1;
    const maxDevices = parseInt(req.query.max_devices) || 1;      // 默认 1 台
    const expireDays = parseInt(req.query.expire_days) || 365;    // 默认 365 天

    const newCodes = [];
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + expireDays);

    for (let i = 0; i < count; i++) {
        let code = generateCode();
        while (codes[code]) {
            code = generateCode();
        }
        codes[code] = {
            max_devices: maxDevices,
            used_count: 0,
            used_by: [],
            status: 'active',
            activated_at: null,
            expires_at: expiresAt.toISOString(),
            created_at: new Date().toISOString()
        };
        newCodes.push(code);
    }

    res.json({
        success: true,
        codes: newCodes,
        max_devices: maxDevices,
        expire_days: expireDays,
        count: newCodes.length,
        message: `成功生成 ${newCodes.length} 个激活码，每个可绑定 ${maxDevices} 台设备，有效期 ${expireDays} 天`
    });
});

// ---------- API：管理员 - 查看所有激活码状态 ----------
app.get('/admin/list', (req, res) => {
    const password = req.query.password;
    const adminPass = process.env.ADMIN_PASSWORD || 'admin123';

    if (password !== adminPass) {
        return res.json({ success: false, message: '❌ 管理员密码错误' });
    }

    const result = Object.entries(codes).map(([code, info]) => ({
        code,
        max_devices: info.max_devices,
        used_count: info.used_count,
        used_by: info.used_by,
        status: info.status,
        activated_at: info.activated_at || '未激活',
        expires_at: info.expires_at,
        created_at: info.created_at
    }));

    res.json({
        success: true,
        total: result.length,
        data: result
    });
});

// ---------- API：管理员 - 查询单个激活码详情 ----------
app.get('/admin/info', (req, res) => {
    const password = req.query.password;
    const adminPass = process.env.ADMIN_PASSWORD || 'admin123';

    if (password !== adminPass) {
        return res.json({ success: false, message: '❌ 管理员密码错误' });
    }

    const code = req.query.code?.toUpperCase().trim();
    if (!code || !codes[code]) {
        return res.json({ success: false, message: '激活码不存在' });
    }

    const info = codes[code];
    res.json({
        success: true,
        code,
        max_devices: info.max_devices,
        used_count: info.used_count,
        used_by: info.used_by,
        status: info.status,
        activated_at: info.activated_at || '未激活',
        expires_at: info.expires_at,
        created_at: info.created_at
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

    if (codes[upperCode].status === 'revoked') {
        return res.json({ success: false, message: '激活码已处于作废状态' });
    }

    codes[upperCode].status = 'revoked';
    res.json({
        success: true,
        code: upperCode,
        message: `✅ 激活码 ${upperCode} 已作废`
    });
});

// ---------- API：管理员 - 重新激活已作废的激活码 ----------
app.post('/admin/reactivate', (req, res) => {
    const { code, password } = req.body;
    const adminPass = process.env.ADMIN_PASSWORD || 'admin123';

    if (password !== adminPass) {
        return res.json({ success: false, message: '❌ 管理员密码错误' });
    }

    const upperCode = code.toUpperCase().trim();
    if (!codes[upperCode]) {
        return res.json({ success: false, message: '激活码不存在' });
    }

    if (codes[upperCode].status !== 'revoked') {
        return res.json({ success: false, message: '只有已作废的激活码才能重新激活' });
    }

    codes[upperCode].status = 'active';
    // 可选：重置有效期
    const expireDays = parseInt(req.query.expire_days) || 365;
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + expireDays);
    codes[upperCode].expires_at = expiresAt.toISOString();

    res.json({
        success: true,
        code: upperCode,
        message: `✅ 激活码 ${upperCode} 已重新激活，有效期延长至 ${expiresAt.toISOString().slice(0,10)}`
    });
});

// ---------- 健康检查（供 Cron-job 使用） ----------
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
    console.log('📝 生成激活码示例:');
    console.log(`   http://localhost:${PORT}/admin/generate?password=admin123&count=5&max_devices=3&expire_days=90`);
    console.log('❤️  健康检查接口: /health');
});