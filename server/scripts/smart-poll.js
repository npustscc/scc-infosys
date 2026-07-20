#!/usr/bin/env node
// server/scripts/smart-poll.js — 以 root 定期收集硬碟 SMART 健康度，寫成 JSON 供 app 唯讀。
//
// 設計（2026-07-20 硬碟健康度 feature）：
//   - smartctl 需要 root 才能讀 SMART；本腳本由 root 的 systemd timer（scc-smart-poll.timer，
//     系統全域單一實例，非 @dev/@prod 模板——硬體是兩實例共用的）執行，app 程序（scc-s-admin）
//     完全不需要提權，只透過 adminGetDiskHealth action 唯讀輸出檔。
//   - 輸出：SMART_OUT 環境變數或預設 /var/lib/scc-smart/smart.json（0644，SMART 數據非個資）。
//     寫入採 tmp+rename 原子替換，app 讀到的永遠是完整 JSON。
//   - 零 npm 依賴（只用 node 內建模組）：root 執行時不需要 node_modules，也避免供應鏈面。
//   - 只收集 smartctl --scan 掃得到的實體碟；讀卡機（0B）/光碟機掃描不會列入。單顆失敗不影響
//     其他顆（記在該顆的 error 欄位）。
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const SMARTCTL = process.env.SMARTCTL_PATH || 'smartctl';
const OUT = process.env.SMART_OUT || '/var/lib/scc-smart/smart.json';

function smartctlJson(args) {
  // smartctl 有資訊性非零 exit code（bit flags），JSON 仍會完整輸出——所以吞 exit code、只要
  // stdout 能 parse 就採用。
  let stdout = '';
  try {
    stdout = execFileSync(SMARTCTL, [...args, '-j'], { encoding: 'utf8', timeout: 30000 });
  } catch (e) {
    stdout = (e && e.stdout) ? String(e.stdout) : '';
    if (!stdout) throw new Error(`smartctl ${args.join(' ')} 執行失敗：${e.message}`);
  }
  return JSON.parse(stdout);
}

function scanDevices() {
  const scan = smartctlJson(['--scan']);
  return (scan.devices || []).map(d => ({ name: d.name, type: d.type }));
}

// 從完整 smartctl 輸出萃取前端要顯示的欄位（原始 ata 屬性表太大，只留關鍵項；NVMe 另有
// nvme_smart_health_information_log）。
function summarizeDisk(dev, info) {
  const attrs = {};
  const table = (info.ata_smart_attributes && info.ata_smart_attributes.table) || [];
  const WANTED = {
    5: 'reallocated_sectors',      // 重配置磁區
    9: 'power_on_hours',
    187: 'reported_uncorrect',
    194: 'temperature',
    197: 'pending_sectors',        // 待處理磁區
    198: 'offline_uncorrectable',
  };
  for (const row of table) {
    const key = WANTED[row.id];
    if (key) attrs[key] = { value: row.value, worst: row.worst, thresh: row.thresh, raw: row.raw && row.raw.value };
  }
  const nvme = info.nvme_smart_health_information_log || null;
  return {
    device: dev.name,
    model: info.model_name || (info.device && info.device.name) || dev.name,
    serial: info.serial_number || null,
    capacityBytes: (info.user_capacity && info.user_capacity.bytes) || null,
    rotationRate: info.rotation_rate ?? null, // 0=SSD
    smartPassed: info.smart_status ? info.smart_status.passed === true : null,
    temperatureC: (info.temperature && info.temperature.current) ?? (attrs.temperature && attrs.temperature.raw) ?? null,
    powerOnHours: (info.power_on_time && info.power_on_time.hours) ?? (attrs.power_on_hours && attrs.power_on_hours.raw) ?? null,
    ataAttrs: Object.keys(attrs).length ? attrs : null,
    nvme: nvme ? {
      percentageUsed: nvme.percentage_used ?? null,
      availableSpare: nvme.available_spare ?? null,
      mediaErrors: nvme.media_errors ?? null,
    } : null,
    selfTestStatus: (info.ata_smart_data && info.ata_smart_data.self_test && info.ata_smart_data.self_test.status && info.ata_smart_data.self_test.status.string) || null,
  };
}

function main() {
  const disks = [];
  for (const dev of scanDevices()) {
    try {
      const info = smartctlJson(['-i', '-H', '-A', dev.name]);
      disks.push(summarizeDisk(dev, info));
    } catch (e) {
      disks.push({ device: dev.name, error: e.message, smartPassed: null });
    }
  }
  const out = { generatedAt: new Date().toISOString(), host: require('os').hostname(), disks };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const tmp = OUT + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(out, null, 1), { mode: 0o644 });
  fs.renameSync(tmp, OUT);
  console.log(`smart-poll: 已寫入 ${OUT}（${disks.length} 顆碟）`);
}

main();
