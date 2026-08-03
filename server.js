// ============================================================
//  口算塔防 - 激活码服务器（Render 部署版）
//  使用内存存储（适合小规模测试），重启后数据重置
// ============================================================

const express = require('express');
const crypto = require('crypto');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static('./'));

// ---------- 数据存储（内存） ----------
// 注意：重启后数据会重置，适合测试。正式使用请换数据库
const codes = {};        // { 'CODE': { max_devices, used_count, status, created_at, expires_at } }
const devices = {};      // { 'device_id': { code, activated_at } }
const deviceLists = {};  // { 'CODE': ['device_id1', 'device_id2'] }

// 默认内置一些激活码
function initDefaultCodes() {
    const defaultCodes = ['ABC123', 'DEF456', 'GHI789', 'TD2024'];
    const now = new Date().toISOString();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 365);
    
    for (const code of defaultCodes) {
        if (!codes[code]) {
            codes[code] = {
                max_devices: 3,
                used_count: 0,
                status: 'active',
                created_at: now,
                expires_at: expiresAt.toISOString()
            };
            deviceLists[code] = [];
        }
    }
}
initDefaultCodes();

// ---------- API ----------
app.post('/api/verify', (req, res) => {
    const { code, device_id } = req.body;
    if (!code || !device_id) {
        return res.json({ success: false, message: '缺少激活码或设备ID' });
    }

    const upperCode = code.toUpperCase().trim();
    const codeInfo = codes[upperCode];
    
    if (!codeInfo) {
        return res.json({ success: false, message: '❌ 激活码不存在' });
    }

    if (codeInfo.status === 'revoked') {
        return res.json({ success: false, message: '❌ 该激活码已被作废' });
    }

    if (codeInfo.expires_at && new Date(codeInfo.expires_at) < new Date()) {
        return res.json({ success: false, message: '❌ 激活码已过期' });
    }

    // 检查设备是否已绑定
    if (devices[device_id]) {
        if (devices[device_id].code === upperCode) {
            return res.json({
                success: true,
                message: '✅ 已绑定（当前设备）',
                code: upperCode,
                is_new: false
            });
        } else {
            return res.json({ success: false, message: '❌ 该设备已绑定其他激活码' });
        }
    }

    const list = deviceLists[upperCode] || [];
    if (list.length >= codeInfo.max_devices) {
        return res.json({
            success: false,
            message: `❌ 已达最大绑定数（${codeInfo.max_devices}台设备）`
        });
    }

    // 绑定新设备
    const now = new Date().toISOString();
    devices[device_id] = {
        code: upperCode,
        activated_at: now,
        last_check: now
    };
    list.push(device_id);
    deviceLists[upperCode] = list;
    codeInfo.used_count = (codeInfo.used_count || 0) + 1;

    return res.json({
        success: true,
        message: `✅ 激活成功！已绑定 ${list.length}/${codeInfo.max_devices} 台设备`,
        code: upperCode,
        is_new: true,
        bound_devices: list.length,
        max_devices: codeInfo.max_devices
    });
});

app.post('/api/check', (req, res) => {
    const { device_id } = req.body;
    if (!device_id) {
        return res.json({ success: false, activated: false, message: '缺少设备ID' });
    }

    const device = devices[device_id];
    if (!device) {
        return res.json({ success: false, activated: false, message: '未激活' });
    }

    const codeInfo = codes[device.code];
    if (codeInfo) {
        if (codeInfo.status === 'revoked') {
            return res.json({ success: false, activated: false, message: '❌ 激活码已被作废' });
        }
        if (codeInfo.expires_at && new Date(codeInfo.expires_at) < new Date()) {
            return res.json({ success: false, activated: false, message: '❌ 激活码已过期' });
        }
    }

    device.last_check = new Date().toISOString();
    return res.json({
        success: true,
        activated: true,
        code: device.code,
        activated_at: device.activated_at,
        message: '✅ 已激活'
    });
});

// 管理员接口：生成激活码
app.get('/admin/generate', (req, res) => {
    const password = req.query.password;
    const adminPass = process.env.ADMIN_PASSWORD || 'admin123';
    
    if (password !== adminPass) {
        return res.json({ success: false, message: '❌ 管理员密码错误' });
    }

    const count = parseInt(req.query.count) || 1;
    const maxDevices = parseInt(req.query.max_devices) || 3;
    const expireDays = parseInt(req.query.expire_days) || 365;
    
    const newCodes = [];
    const now = new Date().toISOString();
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
            status: 'active',
            created_at: now,
            expires_at: expiresAt.toISOString()
        };
        deviceLists[code] = [];
        newCodes.push(code);
    }

    res.json({
        success: true,
        codes: newCodes,
        max_devices: maxDevices,
        expire_days: expireDays,
        count: newCodes.length,
        message: `成功生成 ${newCodes.length} 个激活码`
    });
});

function generateCode() {
    return Math.random().toString(36).substring(2, 6).toUpperCase() +
           Math.random().toString(36).substring(2, 6).toUpperCase();
}

app.listen(PORT, () => {
    console.log(`🚀 服务器运行在 http://localhost:${PORT}`);
    console.log('📋 内置激活码: ABC123, DEF456, GHI789, TD2024');
    console.log('🔑 管理员密码: admin123（可在环境变量 ADMIN_PASSWORD 修改）');
});