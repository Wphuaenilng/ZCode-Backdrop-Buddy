import fs from 'node:fs';
import path from 'node:path';
import { METHODS } from '../../shared/protocol/constants.mjs';
import { METHOD_SCHEMAS } from '../schema/methods.mjs';
import { AppError } from '../protocol/errors.mjs';
import { detectMime, extensionForMime, kindForMime, mimeFromExtension } from '../media/mime.mjs';
import { findSteamLibraries, workshopRoots, scanWorkshop, resolveMediaFile } from '../workshop/discover.mjs';

const PREVIEW_MAX_BYTES = 5 * 1024 * 1024;
const PREVIEW_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const IMPORT_TAGS = ['动态'];

// 预览文件名不承接条目 id 原文：统一收敛成 [a-z0-9-] 后，不同 id（如只差
// 分隔符的 a_b 与 a-b）可能映射到同一个封面文件，互相覆盖。只影响封面缓存
// 展示，不影响条目与导入，可接受。
function previewFileName(id, mime) {
  const stem = String(id).toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 72);
  return `${stem}${extensionForMime(mime)}`;
}

export default function register(registry, ctx) {
  // 扫描结果只在内存里存活到下次扫描/内核重启：UI 导入时回传 id，
  // 这里拿它换回条目的 itemDir + 相对 file。第三方条目的真实路径永不过协议。
  let lastScan = null;

  registry.register(METHODS.WORKSHOP_SCAN, METHOD_SCHEMAS[METHODS.WORKSHOP_SCAN], async () => {
    const preferences = ctx.config.get();
    const discovery = await findSteamLibraries({
      appRoot: ctx.paths.appRoot,
      env: process.env,
      configured: preferences.steamPath || null
    });

    if (!discovery.steamPath) {
      lastScan = null;
      return { found: false, reason: '未检测到 Steam 安装', roots: 0, items: [], skipped: 0, truncated: false, cap: 0 };
    }

    const roots = workshopRoots(discovery);
    const scan = scanWorkshop({ roots });

    const previewDir = path.join(ctx.paths.cache, 'preview', 'workshop');
    fs.mkdirSync(previewDir, { recursive: true });
    const items = scan.items.map((item) => {
      const entry = {
        id: item.id,
        title: item.title,
        type: item.type,
        supported: item.supported,
        bytes: item.bytes
      };
      if (item.previewPath) {
        try {
          const mime = detectMime(item.previewPath);
          if (PREVIEW_MIMES.has(mime) && fs.statSync(item.previewPath).size <= PREVIEW_MAX_BYTES) {
            const fileName = previewFileName(item.id, mime);
            const target = path.join(previewDir, fileName);
            // 重扫不无条件重拷：目标已存在且比源新（拷贝不保源 mtime，目标只会更新）
            // 就跳过，避免每次扫描把几十 MB 封面重写一遍。
            let fresh = false;
            try {
              if (fs.existsSync(target)) {
                const source = fs.statSync(item.previewPath);
                const cached = fs.statSync(target);
                fresh = cached.size === source.size && cached.mtimeMs >= source.mtimeMs;
              }
            } catch { /* 保守起见落回重拷 */ }
            if (!fresh) fs.copyFileSync(item.previewPath, target);
            entry.previewUrl = `https://preview.backdropbuddy.invalid/workshop/${fileName}`;
          }
        } catch { /* 预览失败只降级为无封面，不影响条目本身 */ }
      }
      return entry;
    });

    lastScan = new Map();
    for (const item of scan.items) lastScan.set(item.id, item);

    return {
      found: true,
      steamPath: discovery.steamPath,
      source: discovery.source,
      roots: roots.length,
      items,
      skipped: scan.skipped,
      truncated: scan.truncated,
      cap: scan.cap
    };
  });

  registry.register(METHODS.WORKSHOP_IMPORT, METHOD_SCHEMAS[METHODS.WORKSHOP_IMPORT], async (params) => {
    const item = lastScan && lastScan.get(params.id);
    if (!item) {
      throw new AppError('WORKSHOP_ITEM_NOT_FOUND', '条目不在最近的扫描结果里，请重新扫描');
    }
    if (!item.supported || !item.file || !item.itemDir) {
      throw new AppError('WORKSHOP_ITEM_INVALID', '该类型只能由 Wallpaper Engine 本身渲染');
    }

    // scan→import 之间条目可能被篡改（TOCTOU）：导入前按缓存的 itemDir+file
    // 重新走一遍完整校验（realpath/nlink/扩展名），以新解析出的路径为准。
    const mediaPath = resolveMediaFile(item.itemDir, item.file);
    if (!mediaPath) {
      throw new AppError('WORKSHOP_ITEM_INVALID', '媒体文件已不可用或未通过安全校验');
    }
    // importTheme 会按扩展名先路由（.json/.zip/.bbskin 走主题包导入），
    // 这里强制只放行视频扩展名，杜绝走私主题记录。
    if (kindForMime(mimeFromExtension(mediaPath)) !== 'video') {
      throw new AppError('WORKSHOP_ITEM_INVALID', '媒体不是支持的视频格式');
    }

    // 同一段视频只入一次库：哈希在事务外先算，命中直接回传已有主题，
    // 重复导入的成本从"完整拷贝一次 200 MiB"降到"读一遍文件算哈希"。
    const sha256 = await ctx.media.hash(mediaPath);
    const existing = await ctx.library.findByMediaHash(sha256);
    if (existing) return { duplicate: true, theme: existing };

    try {
      const theme = await ctx.library.importTheme({
        path: mediaPath,
        name: item.title.slice(0, 24),
        kind: 'video',
        tags: IMPORT_TAGS,
        sha256
      });
      return { imported: true, theme };
    } catch (error) {
      // 单条失败不中断批量导入：错误作为普通结果回传，由 UI 逐卡片展示。
      if (error instanceof AppError) return { imported: false, code: error.code, message: error.message };
      throw error;
    }
  });
}
